<?php

declare(strict_types=1);

namespace DealDist\Tests\Unit\AmoCRM;

use DealDist\AmoCRM\AmoCrmException;
use DealDist\AmoCRM\Connector;
use DealDist\AmoCRM\OAuthConfig;
use DealDist\AmoCRM\Token;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use Monolog\Handler\NullHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/** @covers \DealDist\AmoCRM\Connector */
final class ConnectorTest extends TestCase
{
    private OAuthConfig $config;
    private InMemoryTokenStorage $storage;
    /** @var list<array{request: Request, options: array<string,mixed>}> */
    private array $history;
    private Logger $logger;

    protected function setUp(): void
    {
        $this->config  = new OAuthConfig('cid', 'csec', 'https://app.example/oauth/callback');
        $this->storage = new InMemoryTokenStorage();
        $this->history = [];
        $this->logger  = new Logger('test');
        $this->logger->pushHandler(new NullHandler());
    }

    public function testAuthorizationUrlContainsClientIdAndState(): void
    {
        $connector = $this->makeConnector(new MockHandler());
        $url       = $connector->authorizationUrl('csrf-123');

        $this->assertStringContainsString('client_id=cid', $url);
        $this->assertStringContainsString('state=csrf-123', $url);
        $this->assertStringContainsString('mode=post_message', $url);
    }

    public function testExchangeAuthorizationCodePersistsTokenAndResolvesAccountId(): void
    {
        $mock = new MockHandler([
            new Response(200, [], (string) json_encode([
                'access_token'  => 'NEW_ACCESS',
                'refresh_token' => 'NEW_REFRESH',
                'expires_in'    => 3600,
                'token_type'    => 'Bearer',
            ])),
            new Response(200, [], (string) json_encode(['id' => 12345, 'name' => 'Acme'])),
        ]);
        $connector = $this->makeConnector($mock);

        $result = $connector->exchangeAuthorizationCode('acme.amocrm.ru', 'AUTH_CODE');

        $this->assertSame('12345', $result['account_id']);
        $this->assertInstanceOf(Token::class, $result['token']);
        $this->assertSame('NEW_ACCESS', $result['token']->accessToken);
        $this->assertSame('acme.amocrm.ru', $result['token']->baseDomain);

        $stored = $this->storage->load('12345');
        $this->assertNotNull($stored);
        $this->assertSame('NEW_ACCESS', $stored['access_token']);

        // First call hits the OAuth token endpoint with the correct grant
        $tokenRequest = $this->history[0]['request'];
        $this->assertSame('POST', $tokenRequest->getMethod());
        $this->assertSame('acme.amocrm.ru', $tokenRequest->getUri()->getHost());
        $this->assertSame('/oauth2/access_token', $tokenRequest->getUri()->getPath());
        $body = json_decode((string) $tokenRequest->getBody(), true);
        $this->assertSame('authorization_code', $body['grant_type']);
        $this->assertSame('AUTH_CODE', $body['code']);
        $this->assertSame('cid', $body['client_id']);
        $this->assertSame('csec', $body['client_secret']);
        $this->assertSame('https://app.example/oauth/callback', $body['redirect_uri']);

        // Second call resolves the account id
        $accountRequest = $this->history[1]['request'];
        $this->assertSame('GET', $accountRequest->getMethod());
        $this->assertSame('/api/v4/account', $accountRequest->getUri()->getPath());
        $this->assertSame('Bearer NEW_ACCESS', $accountRequest->getHeaderLine('Authorization'));
    }

    public function testExchangeFallsBackToDomainHashWhenAccountEndpointFails(): void
    {
        $mock = new MockHandler([
            new Response(200, [], (string) json_encode([
                'access_token'  => 'A',
                'refresh_token' => 'R',
                'expires_in'    => 3600,
            ])),
            new ConnectException('boom', new Request('GET', '/api/v4/account')),
        ]);
        $connector = $this->makeConnector($mock);

        $result = $connector->exchangeAuthorizationCode('acme.amocrm.ru', 'CODE');

        $this->assertSame(md5('acme.amocrm.ru'), $result['account_id']);
        $this->assertNotNull($this->storage->load($result['account_id']));
    }

    public function testRequestAttachesAuthHeaderAndTargetsCorrectUrl(): void
    {
        $this->seedToken('acc-1', accessToken: 'CURRENT', expiresIn: 3600);

        $mock      = new MockHandler([new Response(200, [], '{"id":1}')]);
        $connector = $this->makeConnector($mock);

        $result = $connector->request('acc-1', 'GET', '/leads/1?with=contacts');

        $this->assertSame(['id' => 1], $result);
        $req = $this->history[0]['request'];
        $this->assertSame('GET', $req->getMethod());
        $this->assertSame('acme.amocrm.ru', $req->getUri()->getHost());
        $this->assertSame('/api/v4/leads/1', $req->getUri()->getPath());
        $this->assertSame('with=contacts', $req->getUri()->getQuery());
        $this->assertSame('Bearer CURRENT', $req->getHeaderLine('Authorization'));
        $this->assertSame('application/json', $req->getHeaderLine('Accept'));
    }

    public function testRequestRefreshesTokenOn401AndRetries(): void
    {
        $this->seedToken('acc-1', accessToken: 'OLD', refreshToken: 'OLD_R', expiresIn: 3600);

        $mock = new MockHandler([
            // first attempt → 401
            new Response(401, [], '{"detail":"expired"}'),
            // refresh token endpoint
            new Response(200, [], (string) json_encode([
                'access_token'  => 'NEW',
                'refresh_token' => 'NEW_R',
                'expires_in'    => 3600,
            ])),
            // retried request succeeds
            new Response(200, [], '{"ok":true}'),
        ]);
        $connector = $this->makeConnector($mock);

        $result = $connector->request('acc-1', 'GET', '/leads/1');

        $this->assertSame(['ok' => true], $result);
        $this->assertCount(3, $this->history);

        // The retry must use the new bearer token
        $retry = $this->history[2]['request'];
        $this->assertSame('Bearer NEW', $retry->getHeaderLine('Authorization'));

        // Storage is updated
        $stored = $this->storage->load('acc-1');
        $this->assertSame('NEW', $stored['access_token']);
        $this->assertSame('NEW_R', $stored['refresh_token']);
    }

    public function testRequestRefreshesProactivelyWhenTokenIsAboutToExpire(): void
    {
        // Expires in 10s → within the 60s refresh skew
        $this->seedToken('acc-1', accessToken: 'OLD', refreshToken: 'OLD_R', expiresIn: 10);

        $mock = new MockHandler([
            // proactive refresh — no failing attempt first
            new Response(200, [], (string) json_encode([
                'access_token'  => 'NEW',
                'refresh_token' => 'NEW_R',
                'expires_in'    => 3600,
            ])),
            // actual API request
            new Response(200, [], '{"ok":true}'),
        ]);
        $connector = $this->makeConnector($mock);

        $connector->request('acc-1', 'GET', '/leads');

        $this->assertCount(2, $this->history);
        $this->assertSame('/oauth2/access_token', $this->history[0]['request']->getUri()->getPath());
        $this->assertSame('Bearer NEW', $this->history[1]['request']->getHeaderLine('Authorization'));
    }

    public function testRequestWrapsClientErrorAsAmoCrmException(): void
    {
        $this->seedToken('acc-1', expiresIn: 3600);
        $mock      = new MockHandler([new Response(404, [], '{"error":"not found"}')]);
        $connector = $this->makeConnector($mock);

        $this->expectException(AmoCrmException::class);
        $this->expectExceptionMessage('HTTP 404');
        $connector->request('acc-1', 'GET', '/leads/999');
    }

    public function testRequestWrapsServerErrorAsAmoCrmException(): void
    {
        $this->seedToken('acc-1', expiresIn: 3600);
        $mock      = new MockHandler([new Response(503, [], 'upstream down')]);
        $connector = $this->makeConnector($mock);

        $this->expectException(AmoCrmException::class);
        $this->expectExceptionMessage('HTTP 503');
        $connector->request('acc-1', 'GET', '/leads');
    }

    public function testRequestFailsWhenNoTokenStored(): void
    {
        $connector = $this->makeConnector(new MockHandler());

        $this->expectException(AmoCrmException::class);
        $this->expectExceptionMessage('No tokens stored for account unknown');
        $connector->request('unknown', 'GET', '/leads');
    }

    public function testRefreshAccessTokenUpdatesStorage(): void
    {
        $this->seedToken('acc-1', accessToken: 'A', refreshToken: 'R', expiresIn: 3600);

        $mock = new MockHandler([
            new Response(200, [], (string) json_encode([
                'access_token'  => 'A2',
                'refresh_token' => 'R2',
                'expires_in'    => 7200,
            ])),
        ]);
        $connector = $this->makeConnector($mock);

        $newToken = $connector->refreshAccessToken('acc-1');

        $this->assertSame('A2', $newToken->accessToken);
        $this->assertSame('R2', $this->storage->load('acc-1')['refresh_token']);

        // Refresh hits the OAuth endpoint with refresh_token grant
        $body = json_decode((string) $this->history[0]['request']->getBody(), true);
        $this->assertSame('refresh_token', $body['grant_type']);
        $this->assertSame('R', $body['refresh_token']);
    }

    public function testIsConnectedAndDisconnect(): void
    {
        $connector = $this->makeConnector(new MockHandler());

        $this->assertFalse($connector->isConnected('acc-1'));

        $this->seedToken('acc-1');
        $this->assertTrue($connector->isConnected('acc-1'));

        $connector->disconnect('acc-1');
        $this->assertFalse($connector->isConnected('acc-1'));
    }

    public function testGetTokenReturnsNullWhenAbsent(): void
    {
        $connector = $this->makeConnector(new MockHandler());
        $this->assertNull($connector->getToken('missing'));
    }

    public function testSaveTokenStoresExternalToken(): void
    {
        $connector = $this->makeConnector(new MockHandler());
        $token     = new Token('a', 'r', time() + 3600, 'Bearer', 'x.amocrm.ru');

        $connector->saveToken('acc-9', $token);

        $loaded = $connector->getToken('acc-9');
        $this->assertNotNull($loaded);
        $this->assertSame('a', $loaded->accessToken);
    }

    public function testEmptyResponseBodyReturnsEmptyArray(): void
    {
        $this->seedToken('acc-1', expiresIn: 3600);
        $mock      = new MockHandler([new Response(204, [], '')]);
        $connector = $this->makeConnector($mock);

        $this->assertSame([], $connector->request('acc-1', 'DELETE', '/leads/1'));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function makeConnector(MockHandler $mock): Connector
    {
        $stack = HandlerStack::create($mock);
        $stack->push(Middleware::history($this->history));
        $client = new Client(['handler' => $stack]);

        return new Connector($this->config, $this->storage, $client, $this->logger);
    }

    private function seedToken(
        string $accountId,
        string $accessToken = 'A',
        string $refreshToken = 'R',
        int $expiresIn = 3600,
        string $baseDomain = 'acme.amocrm.ru',
    ): void {
        $this->storage->save($accountId, [
            'access_token'  => $accessToken,
            'refresh_token' => $refreshToken,
            'expires_at'    => time() + $expiresIn,
            'token_type'    => 'Bearer',
            'base_domain'   => $baseDomain,
        ]);
    }
}
