<?php

declare(strict_types=1);

namespace DealDist\Analysis;

use DealDist\AmoCRM\ApiClient;
use GuzzleHttp\Client;
use Monolog\Logger;

/**
 * Analyses a single AmoCRM lead using the Claude API and returns:
 *   - probability      (0–100) – likelihood of closing in the next 30 days
 *   - expected_revenue – budget × (probability / 100)
 *   - urgency          – "high" | "medium" | "low"
 *   - next_step        – concrete recommended action
 *   - reasoning        – brief explanation
 */
class DealAnalyzer
{
    private const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
    private const CLAUDE_MODEL   = 'claude-sonnet-4-6';
    private const MAX_NOTES      = 20;   // last N notes to include in context
    private const MAX_TEXT_CHARS = 600;  // truncate long notes

    private Client $http;

    public function __construct(
        private readonly ApiClient $apiClient,
        private readonly Logger    $logger,
    ) {
        $this->http = new Client(['timeout' => 60, 'connect_timeout' => 10]);
    }

    /**
     * Analyse one lead and return the full result array.
     */
    public function analyzeLead(string $accountId, int $leadId): array
    {
        $lead  = $this->apiClient->getLead($accountId, $leadId, ['tags', 'contacts', 'companies']);
        $notes = $this->apiClient->getLeadNotes($accountId, $leadId);
        $tasks = $this->apiClient->getLeadTasks($accountId, $leadId);

        $context  = $this->buildContext($lead, $notes, $tasks);
        $analysis = $this->callClaude($context);

        return array_merge($analysis, [
            'lead_id'   => $leadId,
            'lead_name' => $lead['name'] ?? "Сделка #$leadId",
            'budget'    => (int) ($lead['price'] ?? 0),
        ]);
    }

    // ── Context builder ───────────────────────────────────────────────────────

    private function buildContext(array $lead, array $notes, array $tasks): string
    {
        $name    = $lead['name'] ?? 'Без названия';
        $budget  = number_format((int) ($lead['price'] ?? 0), 0, '.', ' ');
        $created = date('d.m.Y', $lead['created_at'] ?? time());
        $updated = date('d.m.Y H:i', $lead['updated_at'] ?? time());
        $ageDays = (int) round((time() - ($lead['updated_at'] ?? time())) / 86400);
        $tags    = implode(', ', array_column($lead['_embedded']['tags'] ?? [], 'name')) ?: 'нет';

        $ctx  = "## Сделка: «$name»\n";
        $ctx .= "- Бюджет: $budget руб.\n";
        $ctx .= "- Создана: $created\n";
        $ctx .= "- Последнее изменение: $updated ($ageDays дн. назад)\n";
        $ctx .= "- Теги: $tags\n\n";

        // Notes / conversations (last N, chronological)
        $recentNotes = array_slice($notes, -self::MAX_NOTES);
        if ($recentNotes) {
            $ctx .= "## Заметки и переписка\n";
            foreach ($recentNotes as $note) {
                $date = date('d.m.Y H:i', $note['created_at'] ?? time());
                $type = $note['note_type'] ?? 'common';
                $text = $note['params']['text'] ?? $note['params']['note'] ?? '';
                if ($text === '') {
                    continue;
                }
                $text = mb_substr(trim($text), 0, self::MAX_TEXT_CHARS);
                $ctx .= "[$date] ($type): $text\n";
            }
            $ctx .= "\n";
        }

        // Open tasks
        if ($tasks) {
            $ctx .= "## Открытые задачи\n";
            foreach ($tasks as $task) {
                $due  = $task['complete_till'] ? date('d.m.Y', $task['complete_till']) : 'без срока';
                $text = $task['text'] ?? '';
                $ctx .= "- $text (срок: $due)\n";
            }
            $ctx .= "\n";
        }

        return $ctx;
    }

    // ── Claude API call ───────────────────────────────────────────────────────

    private function callClaude(string $dealContext): array
    {
        $apiKey = $_ENV['ANTHROPIC_API_KEY'] ?? '';
        if ($apiKey === '') {
            throw new \RuntimeException('ANTHROPIC_API_KEY is not configured');
        }

        $prompt = <<<PROMPT
Ты — опытный руководитель отдела продаж. Проанализируй сделку и верни оценку.

$dealContext

Ответь ТОЛЬКО валидным JSON-объектом (без markdown, без пояснений вне JSON):
{
  "probability": <целое число 0–100, вероятность закрытия сделки в течение 30 дней>,
  "expected_revenue": <число: бюджет сделки × (probability/100), округлённое до рублей>,
  "urgency": <"high" | "medium" | "low" — насколько срочно нужно действовать>,
  "next_step": <конкретное следующее действие менеджера, до 200 символов>,
  "reasoning": <краткое обоснование, до 500 символов>
}
PROMPT;

        $responseBody = $this->http->post(self::CLAUDE_API_URL, [
            'headers' => [
                'x-api-key'         => $apiKey,
                'anthropic-version' => '2023-06-01',
                'content-type'      => 'application/json',
            ],
            'json' => [
                'model'      => self::CLAUDE_MODEL,
                'max_tokens' => 512,
                'messages'   => [
                    ['role' => 'user', 'content' => $prompt],
                ],
            ],
        ]);

        $body    = json_decode((string) $responseBody->getBody(), true, 512, JSON_THROW_ON_ERROR);
        $content = $body['content'][0]['text'] ?? '';

        $this->logger->debug('Claude analysis raw response', ['content' => $content]);

        // Strip any accidental markdown fences
        $content = preg_replace('/^```(?:json)?\s*/i', '', trim($content));
        $content = preg_replace('/\s*```$/', '', $content);

        $analysis = json_decode($content, true, 512, JSON_THROW_ON_ERROR);

        return [
            'probability'      => max(0, min(100, (int)   ($analysis['probability']      ?? 0))),
            'expected_revenue' => max(0,            (float) ($analysis['expected_revenue'] ?? 0)),
            'urgency'          =>                  (string) ($analysis['urgency']          ?? 'medium'),
            'next_step'        =>                  (string) ($analysis['next_step']        ?? ''),
            'reasoning'        =>                  (string) ($analysis['reasoning']        ?? ''),
        ];
    }
}
