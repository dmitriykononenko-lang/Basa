<?php

declare(strict_types=1);

namespace DealDist\AmoCRM\Resources;

final class Account extends Resource
{
    /**
     * GET /api/v4/account
     *
     * @param array<string> $with  e.g. ['amojo_id', 'users_groups', 'task_types']
     */
    public function get(array $with = []): array
    {
        $query = $with ? '?' . http_build_query(['with' => implode(',', $with)]) : '';
        return $this->request('GET', '/account' . $query);
    }
}
