<?php

declare(strict_types=1);

namespace DealDist\Tests\Unit\AmoCRM;

use DealDist\AmoCRM\TokenStorage;

final class InMemoryTokenStorage implements TokenStorage
{
    /** @var array<string,array<string,mixed>> */
    private array $tokens = [];

    public function save(string $accountId, array $tokenData): void
    {
        $this->tokens[$accountId] = $tokenData;
    }

    public function load(string $accountId): ?array
    {
        return $this->tokens[$accountId] ?? null;
    }

    public function delete(string $accountId): void
    {
        unset($this->tokens[$accountId]);
    }

    public function all(): array
    {
        return $this->tokens;
    }
}
