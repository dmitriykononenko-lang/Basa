<?php

declare(strict_types=1);

namespace DealDist\Http\Controller;

use DealDist\Monitor\ActivityLogger;
use DealDist\Monitor\ViolationMonitor;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Log\LoggerInterface;

class WebhookEventController
{
    private ActivityLogger $activityLogger;
    private ViolationMonitor $violationMonitor;
    private LoggerInterface $logger;

    public function __construct(
        ActivityLogger $activityLogger,
        ViolationMonitor $violationMonitor,
        LoggerInterface $logger
    ) {
        $this->activityLogger = $activityLogger;
        $this->violationMonitor = $violationMonitor;
        $this->logger = $logger;
    }

    public function handleLeadsWebhook(Request $request, Response $response): Response
    {
        $data = $request->getParsedBody();
        $accountId = $request->getHeader('X-Amocrm-Account-Id')[0] ?? '';

        if (!$accountId) {
            return $response->withStatus(400);
        }

        // amoCRM sends events array
        $account = $data['account'] ?? [];
        $leads = $data['leads'] ?? [];

        foreach ($leads as $leadData) {
            foreach ($leadData as $leadInfo) {
                $this->processLeadEvent($accountId, $leadInfo);
            }
        }

        return $response
            ->withStatus(200)
            ->withHeader('Content-Type', 'application/json')
            ->write(json_encode(['status' => 'ok']));
    }

    private function processLeadEvent(string $accountId, array $leadInfo): void
    {
        $leadId = $leadInfo['id'] ?? null;
        $managerId = $leadInfo['responsible_user_id'] ?? null;
        $statusId = $leadInfo['status_id'] ?? null;

        if (!$leadId || !$managerId) {
            return;
        }

        // Log lead status change
        if ($statusId) {
            $this->activityLogger->log($accountId, [
                'manager_id' => $managerId,
                'lead_id' => $leadId,
                'event_type' => 'lead_moved',
                'details' => [
                    'status_id' => $statusId,
                    'lead_name' => $leadInfo['name'] ?? '',
                    'pipeline_id' => $leadInfo['pipeline_id'] ?? null,
                ],
            ]);

            // Check for violations
            $this->violationMonitor->checkForViolations($accountId, $leadId);
        }
    }

    public function handleNotesWebhook(Request $request, Response $response): Response
    {
        $data = $request->getParsedBody();
        $accountId = $request->getHeader('X-Amocrm-Account-Id')[0] ?? '';

        if (!$accountId) {
            return $response->withStatus(400);
        }

        $notes = $data['notes'] ?? [];

        foreach ($notes as $noteData) {
            foreach ($noteData as $noteInfo) {
                $this->processNoteEvent($accountId, $noteInfo);
            }
        }

        return $response
            ->withStatus(200)
            ->withHeader('Content-Type', 'application/json')
            ->write(json_encode(['status' => 'ok']));
    }

    private function processNoteEvent(string $accountId, array $noteInfo): void
    {
        $noteId = $noteInfo['id'] ?? null;
        $leadId = $noteInfo['entity_id'] ?? null;
        $createdBy = $noteInfo['created_by'] ?? null;

        if (!$noteId || !$leadId) {
            return;
        }

        // Determine note author (client vs manager)
        // 0 = system/client, 1+ = manager
        $isManagerNote = (int)$createdBy > 0;

        $this->activityLogger->log($accountId, [
            'manager_id' => $isManagerNote ? (int)$createdBy : null,
            'lead_id' => $leadId,
            'event_type' => 'note_added',
            'details' => [
                'note_id' => $noteId,
                'note_text' => substr($noteInfo['text'] ?? '', 0, 100),
                'is_manager' => $isManagerNote,
                'created_by' => $createdBy,
            ],
        ]);

        // Check response time violations if this is a client note
        if (!$isManagerNote) {
            $this->violationMonitor->checkForResponseTimeViolation($accountId, $leadId);
        }
    }

    public function handleTasksWebhook(Request $request, Response $response): Response
    {
        $data = $request->getParsedBody();
        $accountId = $request->getHeader('X-Amocrm-Account-Id')[0] ?? '';

        if (!$accountId) {
            return $response->withStatus(400);
        }

        $tasks = $data['tasks'] ?? [];

        foreach ($tasks as $taskData) {
            foreach ($taskData as $taskInfo) {
                $this->processTaskEvent($accountId, $taskInfo);
            }
        }

        return $response
            ->withStatus(200)
            ->withHeader('Content-Type', 'application/json')
            ->write(json_encode(['status' => 'ok']));
    }

    private function processTaskEvent(string $accountId, array $taskInfo): void
    {
        $taskId = $taskInfo['id'] ?? null;
        $leadId = $taskInfo['entity_id'] ?? null;
        $managerId = $taskInfo['responsible_user_id'] ?? null;
        $completeStatus = $taskInfo['complete_till'] ?? null;
        $isCompleted = $taskInfo['is_completed'] ?? false;

        if (!$taskId || !$leadId || !$managerId) {
            return;
        }

        $this->activityLogger->log($accountId, [
            'manager_id' => $managerId,
            'lead_id' => $leadId,
            'event_type' => 'task_event',
            'details' => [
                'task_id' => $taskId,
                'task_type' => $taskInfo['task_type'] ?? 'call',
                'is_completed' => $isCompleted,
                'due_date' => $completeStatus,
                'task_text' => substr($taskInfo['text'] ?? '', 0, 100),
            ],
        ]);

        // Check if task was missed (overdue without completion)
        if ($completeStatus && !$isCompleted) {
            $dueTime = strtotime($completeStatus);
            $now = time();

            if ($now > $dueTime + 3600) { // More than 1 hour late
                $this->violationMonitor->createViolation($accountId, [
                    'type' => 'task_missed',
                    'manager_id' => $managerId,
                    'lead_id' => $leadId,
                    'lead_title' => '',
                    'message' => 'Задача просрочена на ' . ceil(($now - $dueTime) / 3600) . ' часов',
                ]);
            }
        }
    }
}
