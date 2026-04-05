<?php

declare(strict_types=1);

namespace DealDist\AmoCRM;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use Monolog\Logger;

/**
 * Thin wrapper around the AmoCRM REST API v4.
 *
 * Each account has its own access/refresh tokens stored in the filesystem
 * (STORAGE_PATH/tokens/{accountId}.json). The client automatically refreshes
 * the access token when it receives a 401 response.
 */
class ApiClient
{
    private const API_VERSION = 'v4';
    private Client $http;
    private string $storagePath;

    public function __construct(
        private readonly Logger $logger,
    ) {
        $this->storagePath = rtrim($_ENV['STORAGE_PATH'] ?? sys_get_temp_dir(), '/');
        $this->http        = new Client(['timeout' => 15, 'connect_timeout' => 5]);
    }

    // ── Token management ─────────────────────────────────────────────────────

    public function saveTokens(string $accountId, string $baseDomain, array $tokens): void
    {
        $dir = $this->storagePath . '/tokens';
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $tokens['base_domain']  = $baseDomain;
        $tokens['saved_at']     = time();

        file_put_contents(
            $dir . '/' . $accountId . '.json',
            json_encode($tokens, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT)
        );
    }

    public function loadTokens(string $accountId): ?array
    {
        $file = $this->storagePath . '/tokens/' . $accountId . '.json';
        if (!file_exists($file)) {
            return null;
        }
        return json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
    }

    private function refreshTokens(string $accountId, array $tokens): array
    {
        $response = $this->http->post('https://' . $tokens['base_domain'] . '/oauth2/access_token', [
            'json' => [
                'client_id'     => $_ENV['AMO_CLIENT_ID'],
                'client_secret' => $_ENV['AMO_CLIENT_SECRET'],
                'grant_type'    => 'refresh_token',
                'refresh_token' => $tokens['refresh_token'],
                'redirect_uri'  => $_ENV['AMO_REDIRECT_URI'],
            ],
        ]);

        $new = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
        $this->saveTokens($accountId, $tokens['base_domain'], $new);
        $this->logger->info('Refreshed tokens', ['account_id' => $accountId]);
        return $new;
    }

    // ── Generic request helper ────────────────────────────────────────────────

    private function request(string $accountId, string $method, string $path, array $options = []): array
    {
        $tokens = $this->loadTokens($accountId);
        if (!$tokens) {
            throw new \RuntimeException("No tokens for account $accountId");
        }

        $url = 'https://' . $tokens['base_domain'] . '/api/' . self::API_VERSION . $path;
        $options['headers']['Authorization'] = 'Bearer ' . $tokens['access_token'];

        try {
            $response = $this->http->request($method, $url, $options);
        } catch (\GuzzleHttp\Exception\ClientException $e) {
            if ($e->getResponse()->getStatusCode() === 401) {
                // Token expired — refresh and retry once
                $tokens = $this->refreshTokens($accountId, $tokens);
                $options['headers']['Authorization'] = 'Bearer ' . $tokens['access_token'];
                $response = $this->http->request($method, $url, $options);
            } else {
                throw $e;
            }
        }

        $body = (string) $response->getBody();
        return $body ? json_decode($body, true, 512, JSON_THROW_ON_ERROR) : [];
    }

    // ── Lead ──────────────────────────────────────────────────────────────────

    public function getLead(string $accountId, int $leadId, array $with = []): array
    {
        $query = $with ? '?with=' . implode(',', $with) : '';
        $data  = $this->request($accountId, 'GET', "/leads/$leadId$query");
        return $data;
    }

    public function updateLeadResponsible(string $accountId, int $leadId, int $responsibleUserId): void
    {
        $this->request($accountId, 'PATCH', '/leads', [
            'json' => [
                [
                    'id'                  => $leadId,
                    'responsible_user_id' => $responsibleUserId,
                ],
            ],
        ]);
        $this->logger->info('Lead responsible updated', [
            'account_id'   => $accountId,
            'lead_id'      => $leadId,
            'new_user_id'  => $responsibleUserId,
        ]);
    }

    // ── Contacts / Companies ──────────────────────────────────────────────────

    /**
     * Returns the responsible_user_id from any deal related to the same
     * contact or company, if one exists.
     *
     * @param array|null $leadData  Already-loaded lead data (avoids an extra API call)
     */
    public function getExistingResponsible(string $accountId, int $leadId, ?array $leadData = null): ?int
    {
        // Reuse already-loaded lead data when available
        $lead = $leadData ?? $this->getLead($accountId, $leadId, ['contacts', 'companies']);

        $contactIds = array_column($lead['_embedded']['contacts'] ?? [], 'id');
        $companyIds = array_column($lead['_embedded']['companies'] ?? [], 'id');

        // Check contacts
        foreach ($contactIds as $contactId) {
            $userId = $this->getResponsibleFromContactLeads($accountId, (int) $contactId, $leadId);
            if ($userId !== null) {
                return $userId;
            }
        }

        // Check companies
        foreach ($companyIds as $companyId) {
            $userId = $this->getResponsibleFromCompanyLeads($accountId, (int) $companyId, $leadId);
            if ($userId !== null) {
                return $userId;
            }
        }

        return null;
    }

    private function getResponsibleFromContactLeads(string $accountId, int $contactId, int $excludeLeadId): ?int
    {
        $data = $this->request($accountId, 'GET', "/contacts/$contactId?with=leads");
        foreach ($data['_embedded']['leads'] ?? [] as $lead) {
            if ((int) $lead['id'] !== $excludeLeadId) {
                return (int) $lead['responsible_user_id'];
            }
        }
        return null;
    }

    private function getResponsibleFromCompanyLeads(string $accountId, int $companyId, int $excludeLeadId): ?int
    {
        $data = $this->request($accountId, 'GET', "/companies/$companyId?with=leads");
        foreach ($data['_embedded']['leads'] ?? [] as $lead) {
            if ((int) $lead['id'] !== $excludeLeadId) {
                return (int) $lead['responsible_user_id'];
            }
        }
        return null;
    }

    // ── Lead lists & notes ────────────────────────────────────────────────────

    /**
     * Fetches a page of leads, optionally filtered by pipeline/stage.
     *
     * @param  array<string,mixed> $filters  e.g. ['filter[pipeline_id]' => 123]
     * @return array<int,array>
     */
    public function getLeads(string $accountId, array $filters = [], int $page = 1, int $limit = 50): array
    {
        $query = http_build_query(array_merge($filters, [
            'page'  => $page,
            'limit' => $limit,
            'with'  => 'tags,contacts,companies',
        ]));
        $data = $this->request($accountId, 'GET', '/leads?' . $query);
        return $data['_embedded']['leads'] ?? [];
    }

    /**
     * Returns notes (calls, comments, system events) for a lead, newest last.
     *
     * @return array<int,array>
     */
    public function getLeadNotes(string $accountId, int $leadId): array
    {
        try {
            $data = $this->request($accountId, 'GET', "/leads/$leadId/notes?limit=50&order[id]=asc");
            return $data['_embedded']['notes'] ?? [];
        } catch (\Throwable $e) {
            $this->logger->warning('Failed to fetch lead notes', [
                'lead_id'   => $leadId,
                'exception' => $e->getMessage(),
            ]);
            return [];
        }
    }

    /**
     * Returns open tasks attached to a lead.
     *
     * @return array<int,array>
     */
    public function getLeadTasks(string $accountId, int $leadId): array
    {
        try {
            $data = $this->request($accountId, 'GET', "/tasks?filter[entity_id]=$leadId&filter[entity_type]=leads&filter[is_completed]=false");
            return $data['_embedded']['tasks'] ?? [];
        } catch (\Throwable $e) {
            $this->logger->warning('Failed to fetch lead tasks', [
                'lead_id'   => $leadId,
                'exception' => $e->getMessage(),
            ]);
            return [];
        }
    }

    // ── Users ──────────────────────────────────────────────────────────────────

    /**
     * Returns open (active) leads count per user.
     *
     * @return array<int, int>  [userId => leadCount]
     */
    public function getOpenLeadsCountByUser(string $accountId, array $userIds): array
    {
        $counts = array_fill_keys($userIds, 0);

        foreach ($userIds as $userId) {
            $data = $this->request($accountId, 'GET',
                '/leads?filter[responsible_user_id]=' . $userId . '&filter[is_deleted]=false&limit=1&page=1');
            // AmoCRM returns total count in the pagination meta
            $counts[$userId] = (int) ($data['_page_count'] ?? 0);
        }

        return $counts;
    }
}
