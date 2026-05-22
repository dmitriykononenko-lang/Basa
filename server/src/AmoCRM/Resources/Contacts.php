<?php

declare(strict_types=1);

namespace DealDist\AmoCRM\Resources;

final class Contacts extends Resource
{
    /**
     * GET /api/v4/contacts/{id}
     *
     * @param array<string> $with e.g. ['leads', 'customers', 'catalog_elements']
     */
    public function get(int $id, array $with = []): array
    {
        $query = $with ? '?' . http_build_query(['with' => implode(',', $with)]) : '';
        return $this->request('GET', "/contacts/{$id}{$query}");
    }

    public function list(array $params = []): array
    {
        return $this->request('GET', '/contacts' . $this->buildQuery($params));
    }

    /** @return iterable<array<string,mixed>> */
    public function iterate(array $params = []): iterable
    {
        yield from $this->paginate('/contacts', 'contacts', $params);
    }

    /**
     * @param array<int,array<string,mixed>> $contacts
     */
    public function create(array $contacts): array
    {
        return $this->request('POST', '/contacts', ['json' => $contacts]);
    }

    public function update(int $id, array $data): array
    {
        $data['id'] = $id;
        return $this->request('PATCH', '/contacts', ['json' => [$data]]);
    }

    /**
     * Return responsible_user_id of any lead linked to the contact, excluding $excludeLeadId.
     */
    public function findResponsibleFromLeads(int $contactId, int $excludeLeadId): ?int
    {
        $data = $this->get($contactId, ['leads']);
        foreach ($data['_embedded']['leads'] ?? [] as $lead) {
            if ((int) $lead['id'] !== $excludeLeadId) {
                return isset($lead['responsible_user_id']) ? (int) $lead['responsible_user_id'] : null;
            }
        }
        return null;
    }
}
