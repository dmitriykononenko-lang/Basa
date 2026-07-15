<?php

declare(strict_types=1);

namespace DealDist\Monitor;

class ActivityLogger
{
    private string $storagePath;

    public function __construct(string $storagePath)
    {
        $this->storagePath = rtrim($storagePath, '/');
        $this->ensureDirectories();
    }

    private function ensureDirectories(): void
    {
        $dir = $this->storagePath . '/activities';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
    }

    private function getActivitiesFile(string $accountId): string
    {
        return $this->storagePath . '/activities/' . $accountId . '_activities.json';
    }

    public function log(string $accountId, array $activity): void
    {
        $activity['id'] = uniqid('act_');
        $activity['created_at'] = $activity['created_at'] ?? date('c');
        $activity['account_id'] = $accountId;

        $file = $this->getActivitiesFile($accountId);
        $activities = [];

        if (file_exists($file)) {
            $content = file_get_contents($file);
            if ($content) {
                $activities = json_decode($content, true) ?? [];
            }
        }

        $activities[$activity['id']] = $activity;

        // Keep last 1000 activities per account
        if (count($activities) > 1000) {
            $activities = array_slice($activities, -1000, 1000, true);
        }

        file_put_contents($file, json_encode($activities, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }

    public function getActivities(string $accountId, array $filters = []): array
    {
        $file = $this->getActivitiesFile($accountId);
        if (!file_exists($file)) {
            return [];
        }

        $content = file_get_contents($file);
        if (!$content) {
            return [];
        }

        $activities = json_decode($content, true) ?? [];

        // Apply filters
        if (!empty($filters['manager_id'])) {
            $activities = array_filter($activities, fn($a) => ($a['manager_id'] ?? null) == $filters['manager_id']);
        }

        if (!empty($filters['lead_id'])) {
            $activities = array_filter($activities, fn($a) => ($a['lead_id'] ?? null) == $filters['lead_id']);
        }

        if (!empty($filters['event_type'])) {
            $activities = array_filter($activities, fn($a) => ($a['event_type'] ?? null) === $filters['event_type']);
        }

        if (!empty($filters['since'])) {
            $sinceTime = strtotime($filters['since']);
            $activities = array_filter($activities, fn($a) => strtotime($a['created_at'] ?? '0') >= $sinceTime);
        }

        return array_values($activities);
    }

    public function getLastActivity(string $accountId, int $managerId): ?array
    {
        $activities = $this->getActivities($accountId, ['manager_id' => $managerId]);
        if (empty($activities)) {
            return null;
        }

        // Return last activity
        return end($activities);
    }

    public function getLeadHistory(string $accountId, int $leadId): array
    {
        return $this->getActivities($accountId, ['lead_id' => $leadId]);
    }
}
