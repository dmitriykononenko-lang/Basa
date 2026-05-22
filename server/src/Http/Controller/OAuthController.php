<?php

declare(strict_types=1);

namespace DealDist\Http\Controller;

use DealDist\AmoCRM\AmoCrmException;
use DealDist\AmoCRM\Connector;
use Monolog\Logger;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Handles the OAuth 2.0 authorization code callback from AmoCRM.
 *
 * Flow:
 *   1. User installs the widget in AmoCRM.
 *   2. AmoCRM redirects to GET /oauth/callback?code=XXX&referer=domain.amocrm.ru&client_id=YYY
 *   3. Connector exchanges the code for tokens and persists them.
 */
class OAuthController
{
    public function __construct(private readonly Logger $logger)
    {
    }

    public function callback(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $params = $request->getQueryParams();
        $code   = $params['code']    ?? null;
        $domain = $params['referer'] ?? null;

        if (!$code || !$domain) {
            return $this->text($response, 'Missing code or referer parameter.', 400);
        }

        try {
            $connector = Connector::fromEnv($this->logger);
            $connector->exchangeAuthorizationCode((string) $domain, (string) $code);
            return $this->text($response, 'Authorization successful. You may close this window.');
        } catch (AmoCrmException $e) {
            $this->logger->error('OAuth callback failed', ['error' => $e->getMessage()]);
            return $this->text($response, 'Authorization failed: ' . $e->getMessage(), 500);
        } catch (\Throwable $e) {
            $this->logger->error('OAuth callback unexpected error', ['error' => $e->getMessage()]);
            return $this->text($response, 'Server error.', 500);
        }
    }

    private function text(ResponseInterface $response, string $text, int $status = 200): ResponseInterface
    {
        $response->getBody()->write($text);
        return $response->withStatus($status)->withHeader('Content-Type', 'text/plain');
    }
}
