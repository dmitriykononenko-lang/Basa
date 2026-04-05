<?php

declare(strict_types=1);

namespace DealDist\Http\Controller;

use DealDist\AmoCRM\ApiClient;
use DealDist\Analysis\DealAnalyzer;
use Monolog\Logger;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

class AnalysisController
{
    public function __construct(private readonly Logger $logger) {}

    /**
     * POST /api/analysis/lead
     *
     * Body (JSON): { "account_id": "...", "lead_id": 123 }
     *
     * Returns analysis for a single lead.
     */
    public function analyzeLead(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $payload   = (array) $request->getParsedBody();
        $accountId = $payload['account_id'] ?? null;
        $leadId    = isset($payload['lead_id']) ? (int) $payload['lead_id'] : null;

        if (!$accountId || !$leadId) {
            return $this->json($response, ['error' => 'account_id and lead_id are required'], 400);
        }

        try {
            $analyzer = new DealAnalyzer(new ApiClient($this->logger), $this->logger);
            $result   = $analyzer->analyzeLead((string) $accountId, $leadId);

            return $this->json($response, $result);
        } catch (\Throwable $e) {
            $this->logger->error('Lead analysis error', ['exception' => $e->getMessage()]);
            return $this->json($response, ['error' => 'internal_error', 'detail' => $e->getMessage()], 500);
        }
    }

    /**
     * GET /api/analysis/pipeline/{pipelineId}?account_id=...
     *
     * Analyses all active leads in the specified pipeline.
     * Results are sorted by probability (highest first).
     * Also returns total_expected_revenue across all deals.
     */
    public function analyzePipeline(
        ServerRequestInterface $request,
        ResponseInterface      $response,
        array                  $args,
    ): ResponseInterface {
        $pipelineId = (int) ($args['pipelineId'] ?? 0);
        $params     = $request->getQueryParams();
        $accountId  = $params['account_id'] ?? null;

        if (!$accountId || !$pipelineId) {
            return $this->json($response, ['error' => 'account_id query param and pipelineId path param are required'], 400);
        }

        try {
            $apiClient = new ApiClient($this->logger);
            $analyzer  = new DealAnalyzer($apiClient, $this->logger);

            $leads   = $apiClient->getLeads((string) $accountId, ['filter[pipeline_id]' => $pipelineId]);
            $results = [];
            $errors  = [];

            foreach ($leads as $lead) {
                $leadId = (int) $lead['id'];
                try {
                    $results[] = $analyzer->analyzeLead((string) $accountId, $leadId);
                } catch (\Throwable $e) {
                    $this->logger->warning('Skipped lead analysis', [
                        'lead_id'   => $leadId,
                        'exception' => $e->getMessage(),
                    ]);
                    $errors[] = ['lead_id' => $leadId, 'error' => $e->getMessage()];
                }
            }

            // Sort by probability descending
            usort($results, static fn(array $a, array $b) => $b['probability'] <=> $a['probability']);

            $totalExpectedRevenue = (float) array_sum(array_column($results, 'expected_revenue'));

            return $this->json($response, [
                'pipeline_id'            => $pipelineId,
                'analyzed_leads'         => count($results),
                'total_expected_revenue' => $totalExpectedRevenue,
                'deals'                  => $results,
                'errors'                 => $errors,
            ]);
        } catch (\Throwable $e) {
            $this->logger->error('Pipeline analysis error', ['exception' => $e->getMessage()]);
            return $this->json($response, ['error' => 'internal_error', 'detail' => $e->getMessage()], 500);
        }
    }

    private function json(ResponseInterface $response, array $data, int $status = 200): ResponseInterface
    {
        $response->getBody()->write(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        return $response->withStatus($status);
    }
}
