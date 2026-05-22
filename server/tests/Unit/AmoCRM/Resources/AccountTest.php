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

/** @covers \DealDist\AmoCRM\Resources\Account */
final class AccountTest extends TestCase
{
    public function testGetWithExpandsWithParameter(): void
    {
        $storage = new InMemoryTokenStorage();
        $storage->save('acc', [
            'access_token'  => 'AT',
            'refresh_token' => 'RT',
            'expires_at'    => time() + 3600,
            'token_type'    => 'Bearer',
            'base_domain'   => 'acme.amocrm.ru',
        ]);

        $history = [];
        $mock    = new MockHandler([new Response(200, [], '{"id":1}')]);
        $stack   = HandlerStack::create($mock);
        $stack->push(Middleware::history($history));

        $logger = new Logger('t');
        $logger->pushHandler(new NullHandler());

        $connector = new Connector(
            new OAuthConfig('cid', 'csec', 'https://example/cb'),
            $storage,
            new Client(['handler' => $stack]),
            $logger,
        );

        $connector->account('acc')->get(['amojo_id', 'users_groups']);

        $req = $history[0]['request'];
        $this->assertSame('/api/v4/account', $req->getUri()->getPath());
        $this->assertSame('with=amojo_id%2Cusers_groups', $req->getUri()->getQuery());
    }
}
