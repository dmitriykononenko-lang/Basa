<?php

declare(strict_types=1);

namespace DealDist\Tests\Unit\AmoCRM;

use DealDist\AmoCRM\ApiClient;
use DealDist\AmoCRM\Connector;
use DealDist\AmoCRM\OAuthConfig;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use Monolog\Handler\NullHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * Backwards-compatibility regression tests for the ApiClient facade,
 * which is still used directly by DistributionService, WebhookController,
 * and DistributeController.
 *
 * @covers \DealDist\AmoCRM\ApiClient
 */
final class ApiClientFacadeTest extends TestCase
{
    private InMemoryTokenStorage $storage;
    /** @var list<array{request: \GuzzleHttp\Psr7\Request, options: array<string,mixed>}> */
    private array $history;
    private Logger $logger;

    protected function setUp(): void
    {
        $this->storage = new InMemoryTokenStorage();
        $this->storage->save('acc', [
            'access_token'  => 'AT',
            'refresh_token' => 'RT',
            'expires_at'    => time() + 3600,
            'token_type'    => 'Bearer',
            'base_domain'   => 'acme.amocrm.ru',
        ]);
        $this->history = [];
        $this->logger  = new Logger('t');
        $this->logger->pushHandler(new NullHandler());
    }

    public function testGetLeadDelegatesToLeadsResource(): void
    {
        $client = $this->makeApiClient([new Response(200, [], '{"id":42}')]);

        $result = $client->getLead('acc', 42, ['contacts']);

        $this->assertSame(['id' => 42], $result);
        $this->assertSame('/api/v4/leads/42', $this->history[0]['request']->getUri()->getPath());
    }

    public function testUpdateLeadResponsibleDelegates(): void
    {
        $client = $this->makeApiClient([new Response(200, [], '{}')]);

        $client->updateLeadResponsible('acc', 42, 7);

        $body = json_decode((string) $this->history[0]['request']->getBody(), true);
        $this->assertSame([['responsible_user_id' => 7, 'id' => 42]], $body);
    }

    public function testGetExistingResponsibleFindsContactMatch(): void
    {
        $leadData = [
            '_embedded' => [
                'contacts'  => [['id' => 100]],
                'companies' => [],
            ],
        ];
        $client = $this->makeApiClient([
            // Contact lookup with leads expanded
            new Response(200, [], (string) json_encode([
                '_embedded' => [
                    'leads' => [
                        ['id' => 9999, 'responsible_user_id' => 7],  // a different lead
                    ],
                ],
            ])),
        ]);

        $responsible = $client->getExistingResponsible('acc', 42, $leadData);

        $this->assertSame(7, $responsible);
        $this->assertSame('/api/v4/contacts/100', $this->history[0]['request']->getUri()->getPath());
    }

    public function testGetExistingResponsibleSkipsCurrentLead(): void
    {
        $leadData = [
            '_embedded' => [
                'contacts' => [['id' => 100]],
            ],
        ];
        $client = $this->makeApiClient([
            new Response(200, [], (string) json_encode([
                '_embedded' => [
                    'leads' => [['id' => 42, 'responsible_user_id' => 7]],  // same lead — must skip
                ],
            ])),
        ]);

        $this->assertNull($client->getExistingResponsible('acc', 42, $leadData));
    }

    public function testGetExistingResponsibleFallsBackToCompanies(): void
    {
        $leadData = [
            '_embedded' => [
                'contacts'  => [['id' => 100]],
                'companies' => [['id' => 200]],
            ],
        ];
        $client = $this->makeApiClient([
            // Contact has no other leads
            new Response(200, [], (string) json_encode(['_embedded' => ['leads' => []]])),
            // Company has another lead
            new Response(200, [], (string) json_encode([
                '_embedded' => [
                    'leads' => [['id' => 7777, 'responsible_user_id' => 9]],
                ],
            ])),
        ]);

        $this->assertSame(9, $client->getExistingResponsible('acc', 42, $leadData));
    }

    public function testGetOpenLeadsCountByUser(): void
    {
        $client = $this->makeApiClient([
            new Response(200, [], (string) json_encode([
                '_embedded' => ['leads' => [['id' => 1], ['id' => 2], ['id' => 3]]],
                '_links'    => [],
            ])),
            new Response(200, [], (string) json_encode([
                '_embedded' => ['leads' => []],
                '_links'    => [],
            ])),
        ]);

        $counts = $client->getOpenLeadsCountByUser('acc', [10, 20]);

        $this->assertSame([10 => 3, 20 => 0], $counts);
    }

    public function testSaveTokensAndLoadTokens(): void
    {
        $client = $this->makeApiClient([]);

        $client->saveTokens('new-acc', 'foo.amocrm.ru', [
            'access_token'  => 'AAA',
            'refresh_token' => 'BBB',
            'expires_in'    => 3600,
        ]);

        $loaded = $client->loadTokens('new-acc');
        $this->assertNotNull($loaded);
        $this->assertSame('AAA', $loaded['access_token']);
        $this->assertSame('BBB', $loaded['refresh_token']);
        $this->assertSame('foo.amocrm.ru', $loaded['base_domain']);
    }

    public function testLoadTokensReturnsNullForUnknownAccount(): void
    {
        $client = $this->makeApiClient([]);
        $this->assertNull($client->loadTokens('unknown'));
    }

    /** @param array<int,Response> $responses */
    private function makeApiClient(array $responses): ApiClient
    {
        $mock  = new MockHandler($responses);
        $stack = HandlerStack::create($mock);
        $stack->push(Middleware::history($this->history));

        $connector = new Connector(
            new OAuthConfig('cid', 'csec', 'https://example/cb'),
            $this->storage,
            new Client(['handler' => $stack]),
            $this->logger,
        );

        return new ApiClient($this->logger, $connector);
    }
}
