<?php

declare(strict_types=1);

namespace DealDist\Http\Controller;

use DealDist\Monitor\ViolationStorage;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

class MonitorController
{
    private ViolationStorage $storage;

    public function __construct(ViolationStorage $storage)
    {
        $this->storage = $storage;
    }

    public function createViolation(Request $request, Response $response): Response
    {
        $accountId = $request->getHeader('X-Account-Id')[0] ?? '';
        $data = $request->getParsedBody();

        if (!$accountId) {
            return $response
                ->withStatus(401)
                ->withHeader('Content-Type', 'application/json');
        }

        $violation = [
            'id'              => uniqid('v_'),
            'account_id'      => $accountId,
            'manager_id'      => $data['manager_id'] ?? null,
            'manager_name'    => $data['manager_name'] ?? '',
            'lead_id'         => $data['lead_id'] ?? null,
            'lead_title'      => $data['lead_title'] ?? '',
            'type'            => $data['type'] ?? 'unknown',
            'message'         => $data['message'] ?? '',
            'created_at'      => date('c'),
            'status'          => 'new', // new | sent_to_telegram | resolved
            'resolved_by'     => null,
            'resolved_action' => null, // forgive | punish
            'resolved_at'     => null,
        ];

        $this->storage->save($accountId, $violation);

        return $response
            ->withStatus(201)
            ->withHeader('Content-Type', 'application/json')
            ->write(json_encode(['status' => 'ok', 'violation' => $violation]));
    }

    public function listViolations(Request $request, Response $response): Response
    {
        $accountId = $request->getHeader('X-Account-Id')[0] ?? '';
        $params = $request->getQueryParams();
        $status = $params['status'] ?? null;
        $managerId = $params['manager_id'] ?? null;

        if (!$accountId) {
            return $response
                ->withStatus(401)
                ->withHeader('Content-Type', 'application/json');
        }

        $violations = $this->storage->getAll($accountId);

        if ($status) {
            $violations = array_filter($violations, fn($v) => $v['status'] === $status);
        }

        if ($managerId) {
            $violations = array_filter($violations, fn($v) => (string)$v['manager_id'] === (string)$managerId);
        }

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->write(json_encode(['status' => 'ok', 'violations' => array_values($violations)]));
    }

    public function resolveViolation(Request $request, Response $response, array $args): Response
    {
        $accountId = $request->getHeader('X-Account-Id')[0] ?? '';
        $violationId = $args['id'] ?? '';
        $data = $request->getParsedBody();
        $action = $data['action'] ?? 'forgive'; // forgive | punish

        if (!$accountId || !$violationId) {
            return $response
                ->withStatus(400)
                ->withHeader('Content-Type', 'application/json');
        }

        $violation = $this->storage->getById($accountId, $violationId);
        if (!$violation) {
            return $response
                ->withStatus(404)
                ->withHeader('Content-Type', 'application/json')
                ->write(json_encode(['status' => 'error', 'message' => 'Violation not found']));
        }

        $violation['status'] = 'resolved';
        $violation['resolved_action'] = $action;
        $violation['resolved_at'] = date('c');

        $this->storage->save($accountId, $violation);

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->write(json_encode(['status' => 'ok', 'violation' => $violation]));
    }
}
