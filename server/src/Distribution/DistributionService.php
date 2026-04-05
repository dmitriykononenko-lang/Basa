<?php

declare(strict_types=1);

namespace DealDist\Distribution;

use DealDist\AmoCRM\ApiClient;
use Monolog\Logger;

/**
 * Core deal distribution logic.
 *
 * Given a lead and a set of configured rules, the service:
 *   1. Finds the matching rule (pipeline + stage).
 *   2. Optionally checks contact/company history to reuse an existing manager.
 *   3. Filters out managers that are outside their working hours.
 *   4. Picks the next manager using the configured strategy (round-robin or workload).
 *   5. Updates the lead's responsible_user_id via the AmoCRM API.
 */
class DistributionService
{
    public function __construct(
        private readonly ApiClient       $apiClient,
        private readonly QueueStorage    $queueStorage,
        private readonly ScheduleChecker $scheduleChecker,
        private readonly Logger          $logger,
    ) {}

    /**
     * @param array $payload {
     *   account_id: string,
     *   lead_id: int,
     *   pipeline_id: int|null,
     *   stage_id: int|null,
     *   distribution_method: 'round_robin'|'workload',
     *   rules: array,
     *   dp_settings: array
     * }
     * @return array{assigned_to_id: int, assigned_to_name: string}|null
     */
    public function distribute(array $payload): ?array
    {
        $accountId          = (string) $payload['account_id'];
        $leadId             = (int)    $payload['lead_id'];
        $pipelineId         = isset($payload['pipeline_id'])  ? (int) $payload['pipeline_id']  : null;
        $stageId            = isset($payload['stage_id'])     ? (int) $payload['stage_id']      : null;
        $method             = $payload['distribution_method'] ?? 'round_robin';
        $rules              = $payload['rules']               ?? [];
        $dpSettings         = $payload['dp_settings']         ?? [];

        $this->logger->info('Distribute called', compact('accountId', 'leadId', 'pipelineId', 'stageId', 'method'));

        // ── 1. Find matching rule ──────────────────────────────────────────────
        $rule = $this->findMatchingRule($rules, $pipelineId, $stageId, $dpSettings);
        if ($rule === null) {
            $this->logger->info('No matching rule found', compact('leadId', 'pipelineId', 'stageId'));
            return null;
        }

        $managerIds = array_values(array_column($rule['managers'] ?? [], 'id'));
        if (empty($managerIds)) {
            $this->logger->warning('Rule matched but managers list is empty', ['rule' => $rule]);
            return null;
        }

        // ── 2. Check contact/company history ──────────────────────────────────
        if (!empty($rule['check_history'])) {
            $existingId = $this->apiClient->getExistingResponsible($accountId, $leadId);
            if ($existingId !== null && in_array($existingId, $managerIds)) {
                $this->logger->info('Assigning to existing responsible (history check)', [
                    'lead_id' => $leadId,
                    'user_id' => $existingId,
                ]);
                $this->apiClient->updateLeadResponsible($accountId, $leadId, $existingId);
                return ['assigned_to_id' => $existingId, 'assigned_to_name' => (string) $existingId];
            }
        }

        // ── 3. Filter by work schedule ────────────────────────────────────────
        $availableManagers = $managerIds;
        if (!empty($rule['check_schedule'])) {
            $availableManagers = array_values(array_filter(
                $managerIds,
                fn(int $id) => $this->scheduleChecker->isAvailable($accountId, $id)
            ));

            if (empty($availableManagers)) {
                $this->logger->warning('All managers are outside working hours; skipping distribution', [
                    'lead_id'     => $leadId,
                    'manager_ids' => $managerIds,
                ]);
                return null;
            }
        }

        // ── 4. Pick manager by strategy ────────────────────────────────────────
        $chosenId = match ($method) {
            'workload'   => $this->pickByWorkload($accountId, $availableManagers),
            default      => $this->pickRoundRobin($accountId, $rule, $availableManagers),
        };

        // ── 5. Assign ──────────────────────────────────────────────────────────
        $this->apiClient->updateLeadResponsible($accountId, $leadId, $chosenId);

        $this->logger->info('Deal distributed', [
            'lead_id' => $leadId,
            'user_id' => $chosenId,
            'method'  => $method,
        ]);

        return ['assigned_to_id' => $chosenId, 'assigned_to_name' => (string) $chosenId];
    }

    // ── Rule matching ─────────────────────────────────────────────────────────

    private function findMatchingRule(
        array  $rules,
        ?int   $pipelineId,
        ?int   $stageId,
        array  $dpSettings,
    ): ?array {
        // If digital pipeline settings passed with managers, treat them as a rule
        if (!empty($dpSettings['managers'])) {
            return $dpSettings;
        }

        foreach ($rules as $rule) {
            $rulePipelineId = isset($rule['pipeline_id']) ? (int) $rule['pipeline_id'] : null;
            $ruleStageId    = isset($rule['stage_id'])    ? (int) $rule['stage_id']    : null;

            if ($rulePipelineId !== null && $rulePipelineId !== $pipelineId) {
                continue;
            }
            if ($ruleStageId !== null && $ruleStageId !== $stageId) {
                continue;
            }

            return $rule;
        }

        return null;
    }

    // ── Strategies ────────────────────────────────────────────────────────────

    private function pickRoundRobin(string $accountId, array $rule, array $managerIds): int
    {
        $ruleHash = md5(json_encode([
            'pipeline_id' => $rule['pipeline_id'] ?? null,
            'stage_id'    => $rule['stage_id']    ?? null,
        ]));

        return $this->queueStorage->getNextManager($accountId, $ruleHash, $managerIds);
    }

    private function pickByWorkload(string $accountId, array $managerIds): int
    {
        $counts = $this->apiClient->getOpenLeadsCountByUser($accountId, $managerIds);

        // Return the manager with the fewest open deals
        asort($counts);
        return (int) array_key_first($counts);
    }
}
