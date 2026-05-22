<?php

declare(strict_types=1);

namespace DealDist\AmoCRM\Resources;

final class Webhooks extends Resource
{
    /** GET /api/v4/webhooks */
    public function list(): array
    {
        return $this->request('GET', '/webhooks');
    }

    /**
     * POST /api/v4/webhooks — subscribe to events at the given destination.
     *
     * @param array<string> $settings list of event codes
     *                       (e.g. 'add_lead', 'status_lead', 'update_lead', 'restore_lead')
     */
    public function subscribe(string $destination, array $settings): array
    {
        return $this->request('POST', '/webhooks', [
            'json' => [
                'destination' => $destination,
                'settings'    => $settings,
            ],
        ]);
    }

    /** DELETE /api/v4/webhooks */
    public function unsubscribe(string $destination): array
    {
        return $this->request('DELETE', '/webhooks', [
            'json' => ['destination' => $destination],
        ]);
    }
}
