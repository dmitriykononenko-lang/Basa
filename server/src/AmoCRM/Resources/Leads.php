<?php

declare(strict_types=1);

namespace DealDist\AmoCRM\Resources;

final class Leads extends Resource
{
    /**
     * GET /api/v4/leads/{id}
     *
     * @param array<string> $with e.g. ['contacts', 'companies', 'tags']
     */
    public function get(int $id, array $with = []): array
    {
        $query = $with ? '?' . http_build_query(['with' => implode(',', $with)]) : '';
        return $this->request('GET', "/leads/{$id}{$query}");
    }

    /**
     * GET /api/v4/leads
     *
     * @param array{
     *     filter?: array<string,mixed>,
     *     with?: array<string>,
     *     order?: array<string,string>,
     *     limit?: int,
     *     page?: int,
     *     query?: string
     * } $params
     */
    public function list(array $params = []): array
    {
        return $this->request('GET', '/leads' . $this->buildQuery($params));
    }

    /**
     * Iterate over every lead matching the filter, transparently walking pagination.
     *
     * @return iterable<array<string,mixed>>
     */
    public function iterate(array $params = []): iterable
    {
        yield from $this->paginate('/leads', 'leads', $params);
    }

    /**
     * POST /api/v4/leads — create one or many leads.
     *
     * @param array<int,array<string,mixed>> $leads
     */
    public function create(array $leads): array
    {
        return $this->request('POST', '/leads', ['json' => $leads]);
    }

    /**
     * PATCH /api/v4/leads — update a single lead.
     */
    public function update(int $id, array $data): array
    {
        $data['id'] = $id;
        return $this->request('PATCH', '/leads', ['json' => [$data]]);
    }

    /**
     * PATCH /api/v4/leads — batch-update multiple leads.
     *
     * @param array<int,array<string,mixed>> $leads each item must contain 'id'
     */
    public function batchUpdate(array $leads): array
    {
        return $this->request('PATCH', '/leads', ['json' => $leads]);
    }

    public function setResponsibleUser(int $id, int $userId): void
    {
        $this->update($id, ['responsible_user_id' => $userId]);
    }

    public function moveToStatus(int $id, int $statusId, ?int $pipelineId = null): void
    {
        $payload = ['status_id' => $statusId];
        if ($pipelineId !== null) {
            $payload['pipeline_id'] = $pipelineId;
        }
        $this->update($id, $payload);
    }

    /**
     * Count open (not deleted) leads per user.
     *
     * @param array<int> $userIds
     * @return array<int,int>  [userId => count]
     */
    public function countOpenByUser(array $userIds): array
    {
        $counts = array_fill_keys($userIds, 0);
        foreach ($userIds as $userId) {
            $count = 0;
            foreach ($this->iterate([
                'filter' => [
                    'responsible_user_id' => $userId,
                    'is_deleted'          => 'false',
                ],
            ]) as $_) {
                $count++;
            }
            $counts[$userId] = $count;
        }
        return $counts;
    }
}
