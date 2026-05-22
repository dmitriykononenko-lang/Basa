<?php

declare(strict_types=1);

namespace DealDist\AmoCRM;

use DealDist\AmoCRM\Resources\Account;
use DealDist\AmoCRM\Resources\Companies;
use DealDist\AmoCRM\Resources\Contacts;
use DealDist\AmoCRM\Resources\Leads;
use DealDist\AmoCRM\Resources\Notes;
use DealDist\AmoCRM\Resources\Pipelines;
use DealDist\AmoCRM\Resources\Tasks;
use DealDist\AmoCRM\Resources\Users;
use DealDist\AmoCRM\Resources\Webhooks;
use Monolog\Logger;

/**
 * Domain-oriented facade over the AmoCRM Connector + Resources.
 *
 * Kept for backwards compatibility with controllers that instantiate it as
 * `new ApiClient($logger)`. New code is encouraged to use Connector and the
 * Resource classes directly via $apiClient->connector() or by constructing
 * a Connector explicitly.
 */
class ApiClient
{
    private Connector $connector;

    public function __construct(Logger $logger, ?Connector $connector = null)
    {
        $this->connector = $connector ?? Connector::fromEnv($logger);
    }

    public function connector(): Connector
    {
        return $this->connector;
    }

    // ── Resource accessors ───────────────────────────────────────────────────

    public function account(string $accountId):   Account   { return $this->connector->account($accountId);   }
    public function leads(string $accountId):     Leads     { return $this->connector->leads($accountId);     }
    public function contacts(string $accountId):  Contacts  { return $this->connector->contacts($accountId);  }
    public function companies(string $accountId): Companies { return $this->connector->companies($accountId); }
    public function users(string $accountId):     Users     { return $this->connector->users($accountId);     }
    public function pipelines(string $accountId): Pipelines { return $this->connector->pipelines($accountId); }
    public function notes(string $accountId):     Notes     { return $this->connector->notes($accountId);     }
    public function tasks(string $accountId):     Tasks     { return $this->connector->tasks($accountId);     }
    public function webhooks(string $accountId):  Webhooks  { return $this->connector->webhooks($accountId);  }

    // ── Backwards-compatible high-level operations ──────────────────────────

    public function getLead(string $accountId, int $leadId, array $with = []): array
    {
        return $this->leads($accountId)->get($leadId, $with);
    }

    public function updateLeadResponsible(string $accountId, int $leadId, int $responsibleUserId): void
    {
        $this->leads($accountId)->setResponsibleUser($leadId, $responsibleUserId);
    }

    /**
     * Returns the responsible_user_id from any deal linked to the same
     * contact or company, if one exists.
     */
    public function getExistingResponsible(string $accountId, int $leadId, ?array $leadData = null): ?int
    {
        $lead = $leadData ?? $this->leads($accountId)->get($leadId, ['contacts', 'companies']);

        foreach ($lead['_embedded']['contacts'] ?? [] as $contact) {
            $userId = $this->contacts($accountId)->findResponsibleFromLeads((int) $contact['id'], $leadId);
            if ($userId !== null) {
                return $userId;
            }
        }

        foreach ($lead['_embedded']['companies'] ?? [] as $company) {
            $userId = $this->companies($accountId)->findResponsibleFromLeads((int) $company['id'], $leadId);
            if ($userId !== null) {
                return $userId;
            }
        }

        return null;
    }

    /**
     * @param array<int> $userIds
     * @return array<int,int> [userId => leadCount]
     */
    public function getOpenLeadsCountByUser(string $accountId, array $userIds): array
    {
        return $this->leads($accountId)->countOpenByUser($userIds);
    }

    /**
     * @deprecated Prefer Connector::exchangeAuthorizationCode() which also
     *             resolves the account_id from the AmoCRM API.
     */
    public function saveTokens(string $accountId, string $baseDomain, array $tokens): void
    {
        $token = Token::fromTokenEndpointResponse($tokens, $baseDomain, time());
        $this->connector->saveToken($accountId, $token);
    }

    /**
     * @deprecated Use Connector::getToken().
     */
    public function loadTokens(string $accountId): ?array
    {
        $token = $this->connector->getToken($accountId);
        return $token?->toArray();
    }
}
