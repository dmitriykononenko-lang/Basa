<?php

declare(strict_types=1);

namespace DealDist\Monitor;

class ViolationStorage
{
    private string $storagePath;

    public function __construct(string $storagePath)
    {
        $this->storagePath = rtrim($storagePath, '/');
        $this->ensureDirectories();
    }

    private function ensureDirectories(): void
    {
        $dir = $this->storagePath . '/violations';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
    }

    private function getViolationsFile(string $accountId): string
    {
        return $this->storagePath . '/violations/' . $accountId . '_violations.json';
    }

    public function save(string $accountId, array $violation): void
    {
        $file = $this->getViolationsFile($accountId);
        $violations = [];

        if (file_exists($file)) {
            $content = file_get_contents($file);
            if ($content) {
                $violations = json_decode($content, true) ?? [];
            }
        }

        $violations[$violation['id']] = $violation;
        file_put_contents($file, json_encode($violations, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }

    public function getById(string $accountId, string $violationId): ?array
    {
        $violations = $this->getAll($accountId);
        return $violations[$violationId] ?? null;
    }

    public function getAll(string $accountId): array
    {
        $file = $this->getViolationsFile($accountId);
        if (!file_exists($file)) {
            return [];
        }

        $content = file_get_contents($file);
        if (!$content) {
            return [];
        }

        return json_decode($content, true) ?? [];
    }

    public function delete(string $accountId, string $violationId): void
    {
        $violations = $this->getAll($accountId);
        unset($violations[$violationId]);
        $file = $this->getViolationsFile($accountId);
        file_put_contents($file, json_encode($violations, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
}
