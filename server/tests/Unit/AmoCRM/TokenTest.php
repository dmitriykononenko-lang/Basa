<?php

declare(strict_types=1);

namespace DealDist\Tests\Unit\AmoCRM;

use DealDist\AmoCRM\AmoCrmException;
use DealDist\AmoCRM\Token;
use PHPUnit\Framework\TestCase;

/** @covers \DealDist\AmoCRM\Token */
final class TokenTest extends TestCase
{
    public function testFromTokenEndpointResponseComputesExpiresAt(): void
    {
        $token = Token::fromTokenEndpointResponse([
            'access_token'  => 'a',
            'refresh_token' => 'r',
            'expires_in'    => 3600,
            'token_type'    => 'Bearer',
        ], 'x.amocrm.ru', 1_000_000);

        $this->assertSame('a', $token->accessToken);
        $this->assertSame('r', $token->refreshToken);
        $this->assertSame(1_000_000 + 3600, $token->expiresAt);
        $this->assertSame('Bearer', $token->tokenType);
        $this->assertSame('x.amocrm.ru', $token->baseDomain);
    }

    public function testFromTokenEndpointResponseDefaultsExpiresInTo24h(): void
    {
        $token = Token::fromTokenEndpointResponse([
            'access_token'  => 'a',
            'refresh_token' => 'r',
        ], 'x.amocrm.ru', 1_000_000);

        $this->assertSame(1_000_000 + 86400, $token->expiresAt);
        $this->assertSame('Bearer', $token->tokenType);
    }

    public function testFromTokenEndpointResponseRejectsMalformed(): void
    {
        $this->expectException(AmoCrmException::class);
        Token::fromTokenEndpointResponse(['access_token' => 'a'], 'x.amocrm.ru', 0);
    }

    public function testToArrayAndFromArrayRoundtrip(): void
    {
        $token   = new Token('a', 'r', 12345, 'Bearer', 'x.amocrm.ru');
        $roundtrip = Token::fromArray($token->toArray());

        $this->assertEquals($token, $roundtrip);
    }

    public function testFromArrayRequiresFields(): void
    {
        $this->expectException(AmoCrmException::class);
        Token::fromArray(['access_token' => 'a']);
    }

    public function testFromArraySupportsLegacyExpiresInAndSavedAt(): void
    {
        $token = Token::fromArray([
            'access_token'  => 'a',
            'refresh_token' => 'r',
            'base_domain'   => 'x.amocrm.ru',
            'expires_in'    => 600,
            'saved_at'      => 1_000_000,
        ]);

        $this->assertSame(1_000_600, $token->expiresAt);
    }

    public function testIsExpiredRespectsSkew(): void
    {
        $token = new Token('a', 'r', time() + 30, 'Bearer', 'x.amocrm.ru');
        $this->assertFalse($token->isExpired(0));
        $this->assertTrue($token->isExpired(60));
    }

    public function testIsExpiredTrueWhenInPast(): void
    {
        $token = new Token('a', 'r', time() - 1, 'Bearer', 'x.amocrm.ru');
        $this->assertTrue($token->isExpired());
    }
}
