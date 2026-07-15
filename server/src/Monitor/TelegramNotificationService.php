<?php

declare(strict_types=1);

namespace DealDist\Monitor;

use Psr\Log\LoggerInterface;

class TelegramNotificationService
{
    private string $botToken;
    private string $chatId;
    private LoggerInterface $logger;

    public function __construct(string $botToken, string $chatId, LoggerInterface $logger)
    {
        $this->botToken = $botToken;
        $this->chatId = $chatId;
        $this->logger = $logger;
    }

    public function sendViolationNotification(array $violation, string $amoCrmBaseUrl = 'https://app.amocrm.ru'): bool
    {
        $text = $this->formatViolationMessage($violation, $amoCrmBaseUrl);
        $keyboard = $this->buildInlineKeyboard($violation, $amoCrmBaseUrl);

        return $this->sendMessage($text, $keyboard);
    }

    private function formatViolationMessage(array $violation, string $amoCrmBaseUrl): string
    {
        $typeLabel = $this->getViolationTypeLabel($violation['type']);
        $leadLink = $amoCrmBaseUrl . '/leads/detail/' . $violation['lead_id'];

        $text = "🚨 ГЛАЗ БОССА\n\n";
        $text .= "Нарушение: <b>{$typeLabel}</b>\n";
        $text .= "Сделка: <a href=\"{$leadLink}\">#" . $violation['lead_id'] . " " . htmlspecialchars($violation['lead_title']) . "</a>\n";
        $text .= "Ответственный: <b>" . htmlspecialchars($violation['manager_name']) . "</b>\n";
        $text .= "Время: " . date('H:i, d.m.Y', strtotime($violation['created_at'])) . "\n\n";
        $text .= htmlspecialchars($violation['message']);

        return $text;
    }

    private function getViolationTypeLabel(string $type): string
    {
        $labels = [
            'delay_response' => 'Задержка ответа клиенту',
            'client_waiting' => 'Клиент ждёт ответа',
            'delay_kp' => 'Задержка с КП',
            'unknown' => 'Неизвестное нарушение',
        ];

        return $labels[$type] ?? $type;
    }

    private function buildInlineKeyboard(array $violation, string $amoCrmBaseUrl): array
    {
        $violationId = $violation['id'];
        $leadLink = $amoCrmBaseUrl . '/leads/detail/' . $violation['lead_id'];

        return [
            'inline_keyboard' => [
                [
                    [
                        'text' => '✓ ПОМИЛОВАТЬ',
                        'callback_data' => 'forgive_' . $violationId
                    ],
                    [
                        'text' => '✗ КАЗНИТЬ',
                        'callback_data' => 'punish_' . $violationId
                    ],
                ],
                [
                    [
                        'text' => '🔍 ПОСМОТРЕТЬ',
                        'url' => $leadLink
                    ]
                ]
            ]
        ];
    }

    private function sendMessage(string $text, array $keyboard): bool
    {
        $url = 'https://api.telegram.org/bot' . $this->botToken . '/sendMessage';

        $payload = [
            'chat_id' => $this->chatId,
            'text' => $text,
            'parse_mode' => 'HTML',
            'reply_markup' => json_encode($keyboard)
        ];

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($payload),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ]);

        $response = curl_exec($ch);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            $this->logger->error('Telegram API error: ' . $error);
            return false;
        }

        $data = json_decode($response, true);
        if (!($data['ok'] ?? false)) {
            $this->logger->error('Telegram API returned error: ' . ($data['description'] ?? 'Unknown'));
            return false;
        }

        $this->logger->info('Telegram notification sent successfully');
        return true;
    }

    public function markSent(string $accountId, string $violationId): void
    {
        // This will be called from MonitorController after sending
        // to update violation status to 'sent_to_telegram'
    }
}
