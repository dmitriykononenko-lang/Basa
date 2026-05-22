<?php

declare(strict_types=1);

namespace DealDist\Tests\Unit\AmoCRM\Resources;

use DealDist\AmoCRM\Connector;
use DealDist\AmoCRM\OAuthConfig;
use DealDist\Tests\Unit\AmoCRM\InMemoryTokenStorage;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use Monolog\Handler\NullHandler;
use Monolog\Logger;
use PHPUnit\Framework\TestCase;

/**
 * @covers \DealDist\AmoCRM\Resources\Leads
 * @covers \DealDist\AmoCRM\Resources\Resource
 */
final class LeadsTest extends TestCase
{
    private InMemoryTokenStorage $storage;
    /** @var list<array{request: \GuzzleHttp\Psr7\Request, options: array<string,mixed>}> */
    private array $history;

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
    }

    public function testGetBuildsPathAndWithQuery(): void
    {
        $connector = $this->makeConnector([new Response(200, [], '{"id":42}')]);

        $connector->leads('acc')->get(42, ['contacts', 'companies']);

        $req = $this->history[0]['request'];
        $this->assertSame('GET', $req->getMethod());
        $this->assertSame('/api/v4/leads/42', $req->getUri()->getPath());
        $this->assertSame('with=contacts%2Ccompanies', $req->getUri()->getQuery());
    }

    public function testListBuildsFilterAndOrderQuery(): void
    {
        $connector = $this->makeConnector([new Response(200, [], '{"_embedded":{"leads":[]}}')]);

        $connector->leads('acc')->list([
            'filter' => [
                'responsible_user_id' => 7,
                'statuses'            => [['pipeline_id' => 1, 'status_id' => 2]],
            ],
            'order'  => ['updated_at' => 'desc'],
            'with'   => ['contacts'],
            'limit'  => 50,
        ]);

        $query = $this->history[0]['request']->getUri()->getQuery();
        parse_str($query, $parsed);

        $this->assertSame('7', $parsed['filter']['responsible_user_id']);
        $this->assertSame('desc', $parsed['order']['updated_at']);
        $this->assertSame('contacts', $parsed['with']);
        $this->assertSame('50', $parsed['limit']);
    }

    public function testUpdateSendsPatchWithIdEmbedded(): void
    {
        $connector = $this->makeConnector([new Response(200, [], '{}')]);

        $connector->leads('acc')->update(42, ['name' => 'X']);

        $req  = $this->history[0]['request'];
        $body = json_decode((string) $req->getBody(), true);

        $this->assertSame('PATCH', $req->getMethod());
        $this->assertSame('/api/v4/leads', $req->getUri()->getPath());
        $this->assertSame([['name' => 'X', 'id' => 42]], $body);
    }

    public function testSetResponsibleUser(): void
    {
        $connector = $this->makeConnector([new Response(200, [], '{}')]);

        $connector->leads('acc')->setResponsibleUser(42, 7);

        $body = json_decode((string) $this->history[0]['request']->getBody(), true);
        $this->assertSame([['responsible_user_id' => 7, 'id' => 42]], $body);
    }

    public function testIterateWalksPagination(): void
    {
        $connector = $this->makeConnector([
            new Response(200, [], (string) json_encode([
                '_embedded' => ['leads' => [['id' => 1], ['id' => 2]]],
                '_links'    => ['next' => ['href' => 'https://acme.amocrm.ru/api/v4/leads?page=2']],
            ])),
            new Response(200, [], (string) json_encode([
                '_embedded' => ['leads' => [['id' => 3]]],
                '_links'    => [],
            ])),
        ]);

        $ids = [];
        foreach ($connector->leads('acc')->iterate(['filter' => ['responsible_user_id' => 7], 'limit' => 2]) as $lead) {
            $ids[] = $lead['id'];
        }

        $this->assertSame([1, 2, 3], $ids);

        // Pages walked: 1 then 2
        $this->assertCount(2, $this->history);
        parse_str($this->history[0]['request']->getUri()->getQuery(), $q1);
        parse_str($this->history[1]['request']->getUri()->getQuery(), $q2);
        $this->assertSame('1', $q1['page']);
        $this->assertSame('2', $q2['page']);
    }

    public function testCountOpenByUser(): void
    {
        $connector = $this->makeConnector([
            // user 1 — one page with 2 leads (below limit → stop)
            new Response(200, [], (string) json_encode([
                '_embedded' => ['leads' => [['id' => 1], ['id' => 2]]],
                '_links'    => [],
            ])),
            // user 2 — no leads
            new Response(200, [], (string) json_encode([
                '_embedded' => ['leads' => []],
                '_links'    => [],
            ])),
        ]);

        $counts = $connector->leads('acc')->countOpenByUser([1, 2]);

        $this->assertSame([1 => 2, 2 => 0], $counts);
    }

    /** @param array<int,Response> $responses */
    private function makeConnector(array $responses): Connector
    {
        $mock  = new MockHandler($responses);
        $stack = HandlerStack::create($mock);
        $stack->push(Middleware::history($this->history));

        $logger = new Logger('test');
        $logger->pushHandler(new NullHandler());

        return new Connector(
            new OAuthConfig('cid', 'csec', 'https://example/cb'),
            $this->storage,
            new Client(['handler' => $stack]),
            $logger,
        );
    }
}
