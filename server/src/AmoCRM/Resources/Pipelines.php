<?php

declare(strict_types=1);

namespace DealDist\AmoCRM\Resources;

final class Pipelines extends Resource
{
    /** GET /api/v4/leads/pipelines */
    public function list(): array
    {
        return $this->request('GET', '/leads/pipelines');
    }

    /** GET /api/v4/leads/pipelines/{id} */
    public function get(int $id): array
    {
        return $this->request('GET', "/leads/pipelines/{$id}");
    }

    /** GET /api/v4/leads/pipelines/{pipelineId}/statuses */
    public function statuses(int $pipelineId): array
    {
        return $this->request('GET', "/leads/pipelines/{$pipelineId}/statuses");
    }

    /** GET /api/v4/leads/pipelines/{pipelineId}/statuses/{statusId} */
    public function status(int $pipelineId, int $statusId): array
    {
        return $this->request('GET', "/leads/pipelines/{$pipelineId}/statuses/{$statusId}");
    }
}
