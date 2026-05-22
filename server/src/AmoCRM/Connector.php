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
use GuzzleHttp\Client;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\ClientException;
use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\Exception\ServerException;
use Monolog\Handler\NullHandler;
use Monolog\Logger;

/**
 * Stateful connection to AmoCRM for one or more accounts.
 *
 * The Connector owns:
 *   - OAuth handshake (authorization URL, code exchange, token refresh)
 *   - Token persistence via TokenStorage
 *   - Authenticated HTTP requests with automatic refresh on 401
 *
 * Resource classes (Leads, Contacts, …) wrap the connector and expose
 * the AmoCRM REST API v4 in a domain-oriented way.
 */
class Connector
{
    private const API_BASE_PATH       = '/api/v4';
    private const TOKEN_REFRESH_SKEW  = 60;   // seconds before exp to refresh proactively
    private const OAUTH_TOKEN_PATH    = '/oauth2/access_token';
    private const OAUTH_AUTHORIZE_URL = 'https://www.amocrm.ru/oauth';

    public function __construct(
        private readonly OAuthConfig     $config,
        private readonly TokenStorage    $storage,
        private readonly ClientInterface $http,
        private readonly Logger          $logger,
    ) {
    }

    public static function fromEnv(
        ?Logger          $logger  = null,
        ?ClientInterface $http    = null,
        ?TokenStorage    $storage = null,
    ): self {
        $logger ??= self::nullLogger();
        return new self(
            OAuthConfig::fromEnv(),
            $storage ?? FileTokenStorage::fromEnv(),
            $http    ?? new Client(['timeout' => 15, 'connect_timeout' => 5]),
            $logger,
        );
    }

    // ── OAuth ────────────────────────────────────────────────────────────────

    /**
     * Build the URL to which the user should be redirected to grant access.
     * Used when the integration is installed outside of the AmoCRM widget flow.
     */
    public function authorizationUrl(?string $state = null, string $mode = 'post_message'): string
    {
        $params = [
            'client_id' => $this->config->clientId,
            'mode'      => $mode,
        ];
        if ($state !== null) {
            $params['state'] = $state;
        }
        return self::OAUTH_AUTHORIZE_URL . '?' . http_build_query($params);
    }

    /**
     * Exchange an authorization code for tokens, fetch the AmoCRM account id,
     * persist the token, and return both.
     *
     * @return array{account_id: string, token: Token}
     */
    public function exchangeAuthorizationCode(string $baseDomain, string $code): array
    {
        $response = $this->postTokenEndpoint($baseDomain, [
            'grant_type' => 'authorization_code',
            'code'       => $code,
        ]);

        $issuedAt  = time();
        $accountId = $this->fetchAccountId($baseDomain, (string) $response['access_token']);
        $token     = Token::fromTokenEndpointResponse($response, $baseDomain, $issuedAt);

        $this->storage->save($accountId, $token->toArray());
        $this->logger->info('OAuth tokens saved', [
            'account_id' => $accountId,
            'domain'     => $baseDomain,
        ]);

        return ['account_id' => $accountId, 'token' => $token];
    }

    public function refreshAccessToken(string $accountId): Token
    {
        $current  = $this->loadTokenOrFail($accountId);
        $response = $this->postTokenEndpoint($current->baseDomain, [
            'grant_type'    => 'refresh_token',
            'refresh_token' => $current->refreshToken,
        ]);

        $token = Token::fromTokenEndpointResponse($response, $current->baseDomain, time());
        $this->storage->save($accountId, $token->toArray());
        $this->logger->info('Refreshed tokens', ['account_id' => $accountId]);
        return $token;
    }

    public function isConnected(string $accountId): bool
    {
        return $this->storage->load($accountId) !== null;
    }

    public function disconnect(string $accountId): void
    {
        $this->storage->delete($accountId);
        $this->logger->info('Disconnected account', ['account_id' => $accountId]);
    }

    public function getToken(string $accountId): ?Token
    {
        $data = $this->storage->load($accountId);
        return $data ? Token::fromArray($data) : null;
    }

    /**
     * Store an externally obtained token (e.g. from a custom OAuth flow).
     */
    public function saveToken(string $accountId, Token $token): void
    {
        $this->storage->save($accountId, $token->toArray());
    }

    // ── Resource accessors ───────────────────────────────────────────────────

    public function account(string $accountId):  Account   { return new Account($this, $accountId);   }
    public function leads(string $accountId):    Leads     { return new Leads($this, $accountId);     }
    public function contacts(string $accountId): Contacts  { return new Contacts($this, $accountId);  }
    public function companies(string $accountId):Companies { return new Companies($this, $accountId); }
    public function users(string $accountId):    Users     { return new Users($this, $accountId);     }
    public function pipelines(string $accountId):Pipelines { return new Pipelines($this, $accountId); }
    public function notes(string $accountId):    Notes     { return new Notes($this, $accountId);     }
    public function tasks(string $accountId):    Tasks     { return new Tasks($this, $accountId);     }
    public function webhooks(string $accountId): Webhooks  { return new Webhooks($this, $accountId);  }

    // ── Authenticated request ────────────────────────────────────────────────

    /**
     * Perform an authenticated request against the AmoCRM REST API v4.
     *
     * Automatically:
     *   - prepends https://{base_domain}/api/v4
     *   - attaches the Bearer access token
     *   - refreshes the token proactively when it is near expiry
     *   - retries once after a 401 by refreshing the token
     *
     * @return array<string,mixed>
     */
    public function request(string $accountId, string $method, string $path, array $options = []): array
    {
        $token = $this->loadTokenOrFail($accountId);

        if ($token->isExpired(self::TOKEN_REFRESH_SKEW)) {
            $token = $this->refreshAccessToken($accountId);
        }

        $url     = 'https://' . $token->baseDomain . self::API_BASE_PATH . $path;
        $options = $this->withAuthHeaders($options, $token->accessToken);

        try {
            $response = $this->http->request($method, $url, $options);
        } catch (ClientException $e) {
            $status = $e->getResponse()->getStatusCode();
            if ($status !== 401) {
                throw $this->wrapHttpError($e, $status);
            }
            $token   = $this->refreshAccessToken($accountId);
            $options = $this->withAuthHeaders($options, $token->accessToken);
            try {
                $response = $this->http->request($method, $url, $options);
            } catch (GuzzleException $retry) {
                throw $this->wrapHttpError($retry, $retry instanceof ClientException ? $retry->getResponse()->getStatusCode() : 0);
            }
        } catch (ServerException $e) {
            throw $this->wrapHttpError($e, $e->getResponse()->getStatusCode());
        } catch (GuzzleException $e) {
            throw new AmoCrmException('AmoCRM network error: ' . $e->getMessage(), 0, $e);
        }

        $body = (string) $response->getBody();
        if ($body === '') {
            return [];
        }

        try {
            /** @var array<string,mixed> $decoded */
            $decoded = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new AmoCrmException('AmoCRM returned non-JSON body: ' . $e->getMessage(), 0, $e);
        }

        return $decoded;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    private function loadTokenOrFail(string $accountId): Token
    {
        $token = $this->getToken($accountId);
        if ($token === null) {
            throw new AmoCrmException("No tokens stored for account $accountId — complete the OAuth flow first.");
        }
        return $token;
    }

    /**
     * @return array<string,mixed>
     */
    private function postTokenEndpoint(string $baseDomain, array $grantPayload): array
    {
        $payload = $grantPayload + [
            'client_id'     => $this->config->clientId,
            'client_secret' => $this->config->clientSecret,
            'redirect_uri'  => $this->config->redirectUri,
        ];

        try {
            $response = $this->http->request('POST', 'https://' . $baseDomain . self::OAUTH_TOKEN_PATH, [
                'json'    => $payload,
                'headers' => ['Accept' => 'application/json'],
            ]);
        } catch (GuzzleException $e) {
            throw new AmoCrmException('AmoCRM token endpoint error: ' . $e->getMessage(), 0, $e);
        }

        try {
            /** @var array<string,mixed> $decoded */
            $decoded = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new AmoCrmException('Invalid JSON from token endpoint: ' . $e->getMessage(), 0, $e);
        }

        return $decoded;
    }

    private function fetchAccountId(string $baseDomain, string $accessToken): string
    {
        try {
            $response = $this->http->request('GET', 'https://' . $baseDomain . self::API_BASE_PATH . '/account', [
                'headers' => [
                    'Authorization' => 'Bearer ' . $accessToken,
                    'Accept'        => 'application/json',
                ],
            ]);
            /** @var array<string,mixed> $data */
            $data = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
            if (isset($data['id'])) {
                return (string) $data['id'];
            }
        } catch (GuzzleException | \JsonException $e) {
            $this->logger->warning('Could not resolve AmoCRM account id; falling back to domain hash', [
                'domain' => $baseDomain,
                'error'  => $e->getMessage(),
            ]);
        }
        return md5($baseDomain);
    }

    private function withAuthHeaders(array $options, string $accessToken): array
    {
        $options['headers']                   = $options['headers'] ?? [];
        $options['headers']['Authorization']  = 'Bearer ' . $accessToken;
        $options['headers']['Accept']         = $options['headers']['Accept'] ?? 'application/json';
        return $options;
    }

    private function wrapHttpError(\Throwable $e, int $status): AmoCrmException
    {
        $body = '';
        if ($e instanceof ClientException || $e instanceof ServerException) {
            $body = (string) $e->getResponse()->getBody();
        }
        $message = "AmoCRM API error (HTTP $status): " . $e->getMessage();
        if ($body !== '') {
            $message .= ' — ' . substr($body, 0, 500);
        }
        return new AmoCrmException($message, $status, $e);
    }

    private static function nullLogger(): Logger
    {
        $logger = new Logger('amocrm-connector');
        $logger->pushHandler(new NullHandler());
        return $logger;
    }
}
