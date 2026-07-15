<?php

declare(strict_types=1);

namespace DealDist\Http\Controller;

use DealDist\Monitor\ActivityLogger;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

class ActivityController
{
    private ActivityLogger $activityLogger;

    public function __construct(ActivityLogger $activityLogger)
    {
        $this->activityLogger = $activityLogger;
    }

    public function listActivities(Request $request, Response $response): Response
    {
        $accountId = $request->getHeader('X-Account-Id')[0] ?? '';
        $params = $request->getQueryParams();

        if (!$accountId) {
            return $response
                ->withStatus(401)
                ->withHeader('Content-Type', 'application/json');
        }

        $filters = [];

        if (!empty($params['manager_id'])) {
            $filters['manager_id'] = (int)$params['manager_id'];
        }

        if (!empty($params['lead_id'])) {
            $filters['lead_id'] = (int)$params['lead_id'];
        }

        if (!empty($params['event_type'])) {
            $filters['event_type'] = $params['event_type'];
        }

        if (!empty($params['since'])) {
            $filters['since'] = $params['since'];
        }

        $activities = $this->activityLogger->getActivities($accountId, $filters);

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->write(json_encode(['status' => 'ok', 'activities' => $activities]));
    }

    public function getLeadHistory(Request $request, Response $response, array $args): Response
    {
        $accountId = $request->getHeader('X-Account-Id')[0] ?? '';
        $leadId = (int)($args['lead_id'] ?? 0);

        if (!$accountId || !$leadId) {
            return $response
                ->withStatus(400)
                ->withHeader('Content-Type', 'application/json');
        }

        $activities = $this->activityLogger->getLeadHistory($accountId, $leadId);

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->write(json_encode(['status' => 'ok', 'activities' => $activities]));
    }

    public function getManagerStats(Request $request, Response $response, array $args): Response
    {
        $accountId = $request->getHeader('X-Account-Id')[0] ?? '';
        $managerId = (int)($args['manager_id'] ?? 0);

        if (!$accountId || !$managerId) {
            return $response
                ->withStatus(400)
                ->withHeader('Content-Type', 'application/json');
        }

        $activities = $this->activityLogger->getActivities($accountId, ['manager_id' => $managerId]);

        // Calculate stats
        $stats = [
            'manager_id' => $managerId,
            'total_activities' => count($activities),
            'activities_by_type' => [],
            'last_activity' => null,
            'activity_today' => 0,
        ];

        $today = date('Y-m-d');
        $lastActivity = null;

        foreach ($activities as $activity) {
            $type = $activity['event_type'] ?? 'unknown';
            $stats['activities_by_type'][$type] = ($stats['activities_by_type'][$type] ?? 0) + 1;

            if (strpos($activity['created_at'] ?? '', $today) === 0) {
                $stats['activity_today']++;
            }

            if (!$lastActivity || strtotime($activity['created_at'] ?? '0') > strtotime($lastActivity['created_at'] ?? '0')) {
                $lastActivity = $activity;
            }
        }

        $stats['last_activity'] = $lastActivity;

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->write(json_encode(['status' => 'ok', 'stats' => $stats]));
    }
}
