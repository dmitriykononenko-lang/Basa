<?php

declare(strict_types=1);

namespace DealDist\AmoCRM\Resources;

final class Users extends Resource
{
    public function get(int $id, array $with = []): array
    {
        $query = $with ? '?' . http_build_query(['with' => implode(',', $with)]) : '';
        return $this->request('GET', "/users/{$id}{$query}");
    }

    public function list(array $params = []): array
    {
        return $this->request('GET', '/users' . $this->buildQuery($params));
    }

    /** @return iterable<array<string,mixed>> */
    public function iterate(array $params = []): iterable
    {
        yield from $this->paginate('/users', 'users', $params);
    }
}
