<?php

declare(strict_types=1);

namespace DealDist\AmoCRM;

final class FileTokenStorage implements TokenStorage
{
    public function __construct(private readonly string $directory)
    {
    }

    public static function fromEnv(): self
    {
        $base = rtrim((string) ($_ENV['STORAGE_PATH'] ?? sys_get_temp_dir()), '/');
        return new self($base . '/tokens');
    }

    public function save(string $accountId, array $tokenData): void
    {
        if (!is_dir($this->directory) && !mkdir($this->directory, 0755, true) && !is_dir($this->directory)) {
            throw new AmoCrmException("Cannot create token storage directory: {$this->directory}");
        }

        $path = $this->path($accountId);
        $json = json_encode($tokenData, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT);
        if (file_put_contents($path, $json, LOCK_EX) === false) {
            throw new AmoCrmException("Failed to persist tokens to $path");
        }
        @chmod($path, 0600);
    }

    public function load(string $accountId): ?array
    {
        $path = $this->path($accountId);
        if (!is_file($path)) {
            return null;
        }
        $contents = file_get_contents($path);
        if ($contents === false || $contents === '') {
            return null;
        }
        /** @var array<string,mixed> $decoded */
        $decoded = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
        return $decoded;
    }

    public function delete(string $accountId): void
    {
        $path = $this->path($accountId);
        if (is_file($path)) {
            @unlink($path);
        }
    }

    private function path(string $accountId): string
    {
        $safe = preg_replace('/[^A-Za-z0-9_\-]/', '_', $accountId) ?? '';
        if ($safe === '') {
            throw new AmoCrmException('Empty or invalid accountId.');
        }
        return $this->directory . '/' . $safe . '.json';
    }
}
