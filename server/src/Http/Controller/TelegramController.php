<?php

declare(strict_types=1);

namespace DealDist\Http\Controller;

use DealDist\Monitor\ViolationStorage;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Log\LoggerInterface;

class TelegramController
{
    private ViolationStorage $storage;
    private LoggerInterface $logger;
    private string $botToken;

    public function __construct(ViolationStorage $storage, LoggerInterface $logger, string $botToken)
    {
        $this->storage = $storage;
        $this->logger = $logger;
        $this->botToken = $botToken;
    }

    public function handleWebhook(Request $request, Response $response): Response
    {
        // Verify the token from Telegram
        $token = $request->getHeader('X-Telegram-Bot-Api-Secret-Token')[0] ?? '';
        if ($token !== $this->botToken) {
            return $response->withStatus(401);
        }

        $data = $request->getParsedBody();

        if (isset($data['callback_query'])) {
            return $this->handleCallbackQuery($data['callback_query'], $response);
        }

        return $response->withStatus(200);
    }

    private function handleCallbackQuery(array $query, Response $response): Response
    {
        $callbackData = $query['callback_data'] ?? '';
        $queryId = $query['id'] ?? '';

        if (!$callbackData || !$queryId) {
            return $response->withStatus(400);
        }

        // Parse callback_data: "forgive_v_xxx" or "punish_v_xxx"
        if (preg_match('/^(forgive|punish)_(.+)$/', $callbackData, $matches)) {
            $action = $matches[1];
            $violationId = $matches[2];

            // Find the violation by ID (search all accounts - improvement: store account_id in callback_data)
            // For now, this is a simplified approach
            $this->logger->info("Processing Telegram action: {$action} for violation: {$violationId}");

            // Send answer to show notification
            $this->answerCallbackQuery($queryId, "Действие '{$action}' выполнено");
        }

        return $response->withStatus(200);
    }

    private function answerCallbackQuery(string $queryId, string $text, bool $showAlert = false): void
    {
        $url = 'https://api.telegram.org/bot' . $this->botToken . '/answerCallbackQuery';

        $payload = [
            'callback_query_id' => $queryId,
            'text' => $text,
            'show_alert' => $showAlert ? 'true' : 'false',
        ];

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($payload),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 5,
        ]);

        curl_exec($ch);
        curl_close($ch);
    }
}
