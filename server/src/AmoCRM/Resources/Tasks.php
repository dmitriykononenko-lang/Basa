<?php

declare(strict_types=1);

namespace DealDist\AmoCRM\Resources;

final class Tasks extends Resource
{
    public function get(int $id): array
    {
        return $this->request('GET', "/tasks/{$id}");
    }

    public function list(array $params = []): array
    {
        return $this->request('GET', '/tasks' . $this->buildQuery($params));
    }

    /**
     * @param array<int,array<string,mixed>> $tasks
     */
    public function create(array $tasks): array
    {
        return $this->request('POST', '/tasks', ['json' => $tasks]);
    }

    public function update(int $id, array $data): array
    {
        $data['id'] = $id;
        return $this->request('PATCH', '/tasks', ['json' => [$data]]);
    }

    public function complete(int $id, string $result = ''): array
    {
        return $this->update($id, [
            'is_completed' => true,
            'result'       => ['text' => $result],
        ]);
    }
}
