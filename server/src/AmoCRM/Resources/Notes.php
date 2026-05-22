<?php

declare(strict_types=1);

namespace DealDist\AmoCRM\Resources;

final class Notes extends Resource
{
    private const ALLOWED_ENTITIES = ['leads', 'contacts', 'companies', 'customers'];

    public function listFor(string $entityType, int $entityId, array $params = []): array
    {
        $entityType = $this->assertEntityType($entityType);
        return $this->request('GET', "/{$entityType}/{$entityId}/notes" . $this->buildQuery($params));
    }

    /**
     * Create one or many notes attached to an entity.
     *
     * @param array<int,array<string,mixed>> $notes  each note must include note_type and params
     */
    public function createFor(string $entityType, int $entityId, array $notes): array
    {
        $entityType = $this->assertEntityType($entityType);
        return $this->request('POST', "/{$entityType}/{$entityId}/notes", ['json' => $notes]);
    }

    public function addCommonNote(string $entityType, int $entityId, string $text): array
    {
        return $this->createFor($entityType, $entityId, [[
            'note_type' => 'common',
            'params'    => ['text' => $text],
        ]]);
    }

    private function assertEntityType(string $entityType): string
    {
        if (!in_array($entityType, self::ALLOWED_ENTITIES, true)) {
            throw new \InvalidArgumentException(
                "Unsupported entity type '$entityType'. Allowed: " . implode(', ', self::ALLOWED_ENTITIES)
            );
        }
        return $entityType;
    }
}
