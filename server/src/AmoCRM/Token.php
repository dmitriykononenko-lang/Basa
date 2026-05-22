<?php

declare(strict_types=1);

namespace DealDist\AmoCRM;

final class Token
{
    public function __construct(
        public readonly string $accessToken,
        public readonly string $refreshToken,
        public readonly int    $expiresAt,
        public readonly string $tokenType,
        public readonly string $baseDomain,
    ) {
    }

    public static function fromTokenEndpointResponse(array $response, string $baseDomain, int $issuedAt): self
    {
        if (!isset($response['access_token'], $response['refresh_token'])) {
            throw new AmoCrmException('Malformed token response: missing access_token or refresh_token.');
        }

        $expiresIn = (int) ($response['expires_in'] ?? 86400);

        return new self(
            accessToken:  (string) $response['access_token'],
            refreshToken: (string) $response['refresh_token'],
            expiresAt:    $issuedAt + $expiresIn,
            tokenType:    (string) ($response['token_type'] ?? 'Bearer'),
            baseDomain:   $baseDomain,
        );
    }

    public static function fromArray(array $data): self
    {
        if (!isset($data['access_token'], $data['refresh_token'], $data['base_domain'])) {
            throw new AmoCrmException('Stored token is missing required fields.');
        }

        $expiresAt = (int) ($data['expires_at'] ?? 0);
        // Legacy format saved by older ApiClient — derive from expires_in + saved_at
        if ($expiresAt === 0 && isset($data['expires_in'], $data['saved_at'])) {
            $expiresAt = (int) $data['saved_at'] + (int) $data['expires_in'];
        }

        return new self(
            accessToken:  (string) $data['access_token'],
            refreshToken: (string) $data['refresh_token'],
            expiresAt:    $expiresAt,
            tokenType:    (string) ($data['token_type'] ?? 'Bearer'),
            baseDomain:   (string) $data['base_domain'],
        );
    }

    public function toArray(): array
    {
        return [
            'access_token'  => $this->accessToken,
            'refresh_token' => $this->refreshToken,
            'expires_at'    => $this->expiresAt,
            'token_type'    => $this->tokenType,
            'base_domain'   => $this->baseDomain,
        ];
    }

    public function isExpired(int $skewSeconds = 0): bool
    {
        return ($this->expiresAt - $skewSeconds) <= time();
    }
}
