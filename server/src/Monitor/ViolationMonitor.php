<?php

declare(strict_types=1);

namespace DealDist\Monitor;

use DealDist\AmoCRM\ApiClient;
use Psr\Log\LoggerInterface;

class ViolationMonitor
{
    private ApiClient $apiClient;
    private ViolationStorage $storage;
    private LoggerInterface $logger;

    public function __construct(ApiClient $apiClient, ViolationStorage $storage, LoggerInterface $logger)
    {
        $this->apiClient = $apiClient;
        $this->storage = $storage;
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
}
