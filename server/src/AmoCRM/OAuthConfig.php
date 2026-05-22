<?php

declare(strict_types=1);

namespace DealDist\AmoCRM;

final class OAuthConfig
{
    public function __construct(
        public readonly string $clientId,
        public readonly string $clientSecret,
        public readonly string $redirectUri,
    ) {
    }

    public static function fromEnv(): self
    {
        $clientId     = (string) ($_ENV['AMO_CLIENT_ID']     ?? '');
        $clientSecret = (string) ($_ENV['AMO_CLIENT_SECRET'] ?? '');
        $redirectUri  = (string) ($_ENV['AMO_REDIRECT_URI']  ?? '');

        if ($clientId === '' || $clientSecret === '' || $redirectUri === '') {
            throw new AmoCrmException(
                'AmoCRM OAuth credentials are not configured. ' .
                'Set AMO_CLIENT_ID, AMO_CLIENT_SECRET and AMO_REDIRECT_URI.'
            );
        }

        return new self($clientId, $clientSecret, $redirectUri);
    }
}
