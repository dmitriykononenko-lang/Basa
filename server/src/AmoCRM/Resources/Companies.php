<?php

declare(strict_types=1);

namespace DealDist\AmoCRM\Resources;

final class Companies extends Resource
{
    public function get(int $id, array $with = []): array
    {
        $query = $with ? '?' . http_build_query(['with' => implode(',', $with)]) : '';
        return $this->request('GET', "/companies/{$id}{$query}");
    }

    public function list(array $params = []): array
    {
        return $this->request('GET', '/companies' . $this->buildQuery($params));
    }

    /** @return iterable<array<string,mixed>> */
    public function iterate(array $params = []): iterable
    {
        yield from $this->paginate('/companies', 'companies', $params);
    }

    /**
     * @param array<int,array<string,mixed>> $companies
     */
    public function create(array $companies): array
    {
        return $this->request('POST', '/companies', ['json' => $companies]);
    }

    public function update(int $id, array $data): array
    {
        $data['id'] = $id;
        return $this->request('PATCH', '/companies', ['json' => [$data]]);
    }

    public function findResponsibleFromLeads(int $companyId, int $excludeLeadId): ?int
    {
        $data = $this->get($companyId, ['leads']);
        foreach ($data['_embedded']['leads'] ?? [] as $lead) {
            if ((int) $lead['id'] !== $excludeLeadId) {
                return isset($lead['responsible_user_id']) ? (int) $lead['responsible_user_id'] : null;
            }
        }
        return null;
    }
}
