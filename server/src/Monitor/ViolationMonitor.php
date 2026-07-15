<?php

declare(strict_types=1);

namespace DealDist\Monitor;

use DealDist\AmoCRM\ApiClient;
use DealDist\Monitor\ActivityLogger;
use Psr\Log\LoggerInterface;

class ViolationMonitor
{
    private ApiClient $apiClient;
    private ViolationStorage $storage;
    private ActivityLogger $activityLogger;
    private LoggerInterface $logger;

    public function __construct(
        ApiClient $apiClient,
        ViolationStorage $storage,
        ActivityLogger $activityLogger,
        LoggerInterface $logger
    ) {
        $this->apiClient = $apiClient;
        $this->storage = $storage;
        $this->activityLogger = $activityLogger;
        $this->logger = $logger;
    }

    public function checkForViolations(string $accountId, int $leadId): ?array
    {
        try {
            $lead = $this->apiClient->getLead($leadId);
            if (!$lead) {
                return null;
            }

            $violations = [];

            // Check for delayed KP (custom field)
            $kpViolation = $this->checkDelayedKP($lead);
            if ($kpViolation) {
                $violations[] = $kpViolation;
            }

            // Check for delayed response
            $responseViolation = $this->checkDelayedResponse($lead);
            if ($responseViolation) {
                $violations[] = $responseViolation;
            }

            return count($violations) > 0 ? $violations[0] : null; // Return first violation
        } catch (\Exception $e) {
            $this->logger->error('Error checking violations: ' . $e->getMessage());
            return null;
        }
    }

    private function checkDelayedKP(array $lead): ?array
    {
        $customFields = $lead['custom_fields_values'] ?? [];
        $kpDateField = null;

        // Find KP date custom field (you may need to adjust field ID)
        foreach ($customFields as $field) {
            if (in_array($field['field_id'], [123456, 654321])) { // Example field IDs
                $kpDateField = $field;
                break;
            }
        }

        if (!$kpDateField || !isset($kpDateField['values'][0]['value'])) {
            return null;
        }

        $promisedDate = strtotime($kpDateField['values'][0]['value']);
        $currentTime = time();

        if ($promisedDate && $currentTime > $promisedDate) {
            $delayDays = ceil(($currentTime - $promisedDate) / 86400);

            return [
                'type' => 'delay_kp',
                'lead_id' => $lead['id'],
                'lead_title' => $lead['name'] ?? '',
                'manager_id' => $lead['responsible_user_id'] ?? null,
                'manager_name' => $this->getManagerName($lead['responsible_user_id'] ?? 0),
                'message' => "КП обещали на " . date('d.m.Y', $promisedDate) . ", а сегодня уже " . $delayDays . " дн.",
            ];
        }

        return null;
    }

    private function checkDelayedResponse(array $lead): ?array
    {
        $notes = $lead['notes'] ?? [];
        $lastClientNote = null;

        foreach (array_reverse($notes) as $note) {
            // 0 = created by client/system, 1 = created by manager
            if (($note['entity_type'] ?? '') === 'note' && !isset($note['created_by'])) {
                $lastClientNote = $note;
                break;
            }
        }

        if (!$lastClientNote) {
            return null;
        }

        $noteTime = $lastClientNote['created_at'] ?? 0;
        $currentTime = time();
        $delayHours = ceil(($currentTime - $noteTime) / 3600);

        if ($delayHours > 24) { // More than 24 hours
            return [
                'type' => 'delay_response',
                'lead_id' => $lead['id'],
                'lead_title' => $lead['name'] ?? '',
                'manager_id' => $lead['responsible_user_id'] ?? null,
                'manager_name' => $this->getManagerName($lead['responsible_user_id'] ?? 0),
                'message' => "Клиент ожидает ответ уже " . $delayHours . " часов.",
            ];
        }

        return null;
    }

    private function getManagerName(int $managerId): string
    {
        if (!$managerId) {
            return 'Неизвестен';
        }

        try {
            $user = $this->apiClient->getUser($managerId);
            return $user['name'] ?? 'Manager #' . $managerId;
        } catch (\Exception $e) {
            $this->logger->error('Error getting manager name: ' . $e->getMessage());
            return 'Manager #' . $managerId;
        }
    }

    public function checkForResponseTimeViolation(string $accountId, int $leadId): void
    {
        try {
            $lead = $this->apiClient->getLead($leadId);
            if (!$lead) {
                return;
            }

            $notes = $lead['notes'] ?? [];
            if (empty($notes)) {
                return;
            }

            // Find last client note
            $lastClientNote = null;
            foreach (array_reverse($notes) as $note) {
                // If note_type is 0 or created_by is 0, it's from client/system
                if (($note['entity_type'] ?? '') === 'note' && isset($note['created_by']) && (int)$note['created_by'] === 0) {
                    $lastClientNote = $note;
                    break;
                }
            }

            if (!$lastClientNote) {
                return;
            }

            $noteTime = $lastClientNote['created_at'] ?? $lastClientNote['date'] ?? 0;
            if (!$noteTime) {
                return;
            }

            // Check if manager has replied
            $hasReply = false;
            $currentTime = time();
            $clientNoteTime = is_numeric($noteTime) ? $noteTime : strtotime($noteTime);

            foreach ($notes as $note) {
                $noteCreatedTime = is_numeric($note['created_at'] ?? $note['date'] ?? 0)
                    ? ($note['created_at'] ?? $note['date'] ?? 0)
                    : strtotime($note['created_at'] ?? $note['date'] ?? '0');

                // If note was created after client note and by manager
                if ($noteCreatedTime > $clientNoteTime && isset($note['created_by']) && (int)$note['created_by'] > 0) {
                    $hasReply = true;
                    break;
                }
            }

            if (!$hasReply) {
                $delaySeconds = $currentTime - $clientNoteTime;
                $delayMinutes = ceil($delaySeconds / 60);

                // 15 minutes default threshold
                if ($delayMinutes > 15) {
                    $this->createViolation($accountId, [
                        'type' => 'slow_answer',
                        'manager_id' => $lead['responsible_user_id'] ?? null,
                        'lead_id' => $leadId,
                        'lead_title' => $lead['name'] ?? '',
                        'message' => "Клиент ждёт ответ уже $delayMinutes минут",
                    ]);
                }
            }
        } catch (\Exception $e) {
            $this->logger->error('Error checking response time: ' . $e->getMessage());
        }
    }

    public function checkForInactivity(string $accountId, int $managerId, int $thresholdMinutes = 60): ?array
    {
        try {
            $lastActivity = $this->activityLogger->getLastActivity($accountId, $managerId);

            if (!$lastActivity) {
                // No activity at all - check if manager has any leads
                return null;
            }

            $lastActivityTime = strtotime($lastActivity['created_at'] ?? '0');
            $currentTime = time();
            $inactiveMinutes = ceil(($currentTime - $lastActivityTime) / 60);

            if ($inactiveMinutes > $thresholdMinutes) {
                return [
                    'type' => 'idle',
                    'manager_id' => $managerId,
                    'lead_id' => null,
                    'lead_title' => '',
                    'message' => "Менеджер неактивен $inactiveMinutes минут",
                ];
            }

            return null;
        } catch (\Exception $e) {
            $this->logger->error('Error checking inactivity: ' . $e->getMessage());
            return null;
        }
    }

    public function createViolation(string $accountId, array $violationData): void
    {
        // Check if similar violation already exists (avoid duplicates)
        $existingViolations = $this->storage->getAll($accountId);

        foreach ($existingViolations as $existing) {
            if (
                $existing['status'] === 'new' &&
                $existing['type'] === $violationData['type'] &&
                $existing['lead_id'] === $violationData['lead_id'] &&
                $existing['manager_id'] === $violationData['manager_id']
            ) {
                // Duplicate found, skip
                return;
            }
        }

        $violation = [
            'id' => uniqid('v_'),
            'account_id' => $accountId,
            'manager_id' => $violationData['manager_id'] ?? null,
            'manager_name' => $this->getManagerName($violationData['manager_id'] ?? 0),
            'lead_id' => $violationData['lead_id'] ?? null,
            'lead_title' => $violationData['lead_title'] ?? '',
            'type' => $violationData['type'],
            'message' => $violationData['message'] ?? '',
            'created_at' => date('c'),
            'status' => 'new',
            'resolved_by' => null,
            'resolved_action' => null,
            'resolved_at' => null,
        ];

        $this->storage->save($accountId, $violation);
        $this->logger->info('Violation created: ' . $violation['type'] . ' for manager ' . $violation['manager_id']);
    }
}
