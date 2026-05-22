<?php

declare(strict_types=1);

namespace DealDist\AmoCRM;

interface TokenStorage
{
    public function save(string $accountId, array $tokenData): void;

    /** @return array<string,mixed>|null */
    public function load(string $accountId): ?array;

    public function delete(string $accountId): void;
}
