<?php
declare(strict_types=1);

/**
 * Лёгкий REST API для системы учёта проектов и бонусов аналитиков.
 * Данные хранятся в JSON-файлах в ../data/.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require __DIR__ . '/Storage.php';
require __DIR__ . '/BonusCalculator.php';

$dataDir = __DIR__ . '/../data';
$analystsStore = new Storage($dataDir . '/analysts.json');
$projectsStore = new Storage($dataDir . '/projects.json');

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '';
$path = preg_replace('#^.*/api/?#', '', $path);
$segments = array_values(array_filter(explode('/', trim($path, '/')), 'strlen'));

$body = [];
if (in_array($method, ['POST', 'PUT'], true)) {
    $raw = file_get_contents('php://input');
    if ($raw !== '' && $raw !== false) {
        $decoded = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            respond(400, ['error' => 'Invalid JSON: ' . json_last_error_msg()]);
        }
        $body = $decoded ?? [];
    }
}

try {
    route($method, $segments, $body, $analystsStore, $projectsStore);
} catch (Throwable $e) {
    respond(500, ['error' => $e->getMessage()]);
}

function route(string $method, array $segments, array $body, Storage $analystsStore, Storage $projectsStore): void
{
    $resource = $segments[0] ?? '';
    $id = $segments[1] ?? null;

    if ($resource === 'analysts') {
        handleAnalysts($method, $id, $body, $analystsStore, $projectsStore);
        return;
    }

    if ($resource === 'projects') {
        handleProjects($method, $id, $body, $projectsStore, $analystsStore);
        return;
    }

    if ($resource === 'stats') {
        handleStats($projectsStore, $analystsStore);
        return;
    }

    respond(404, ['error' => 'Not found']);
}

function handleAnalysts(string $method, ?string $id, array $body, Storage $analystsStore, Storage $projectsStore): void
{
    if ($method === 'GET') {
        respond(200, $analystsStore->all());
    }

    if ($method === 'POST') {
        $name = trim((string)($body['name'] ?? ''));
        if ($name === '') {
            respond(400, ['error' => 'Имя аналитика обязательно']);
        }
        $analyst = [
            'id' => generateId(),
            'name' => $name,
            'rate_type' => in_array($body['rate_type'] ?? 'percent', ['percent', 'fixed'], true) ? $body['rate_type'] : 'percent',
            'rate_value' => round((float)($body['rate_value'] ?? 0), 2),
            'created_at' => date('c'),
        ];
        $analystsStore->upsert($analyst);
        respond(201, $analyst);
    }

    if ($method === 'PUT' && $id !== null) {
        $existing = $analystsStore->find($id);
        if ($existing === null) {
            respond(404, ['error' => 'Аналитик не найден']);
        }
        $existing['name'] = trim((string)($body['name'] ?? $existing['name']));
        if (isset($body['rate_type']) && in_array($body['rate_type'], ['percent', 'fixed'], true)) {
            $existing['rate_type'] = $body['rate_type'];
        }
        if (isset($body['rate_value'])) {
            $existing['rate_value'] = round((float)$body['rate_value'], 2);
        }
        $analystsStore->upsert($existing);
        respond(200, $existing);
    }

    if ($method === 'DELETE' && $id !== null) {
        $hasProjects = false;
        foreach ($projectsStore->all() as $project) {
            if (($project['analyst_id'] ?? null) === $id) {
                $hasProjects = true;
                break;
            }
        }
        if ($hasProjects) {
            respond(409, ['error' => 'Нельзя удалить аналитика, у которого есть проекты']);
        }
        $analystsStore->delete($id);
        respond(204, null);
    }

    respond(405, ['error' => 'Method not allowed']);
}

function handleProjects(string $method, ?string $id, array $body, Storage $projectsStore, Storage $analystsStore): void
{
    if ($method === 'GET') {
        $projects = array_map(
            static fn(array $p) => enrichProject($p, $analystsStore),
            $projectsStore->all()
        );
        respond(200, $projects);
    }

    if ($method === 'POST') {
        $project = buildProject($body, $analystsStore);
        $projectsStore->upsert($project);
        respond(201, enrichProject($project, $analystsStore));
    }

    if ($method === 'PUT' && $id !== null) {
        $existing = $projectsStore->find($id);
        if ($existing === null) {
            respond(404, ['error' => 'Проект не найден']);
        }
        $merged = array_merge($existing, [
            'name' => trim((string)($body['name'] ?? $existing['name'])),
            'started_at' => $body['started_at'] ?? $existing['started_at'],
            'status' => normalizeStatus($body['status'] ?? $existing['status']),
            'analyst_id' => $body['analyst_id'] ?? $existing['analyst_id'],
            'budget' => isset($body['budget']) ? (float)$body['budget'] : $existing['budget'],
            'custom_bonus' => array_key_exists('custom_bonus', $body)
                ? ($body['custom_bonus'] === null || $body['custom_bonus'] === '' ? null : (float)$body['custom_bonus'])
                : ($existing['custom_bonus'] ?? null),
            'notes' => $body['notes'] ?? ($existing['notes'] ?? ''),
            'updated_at' => date('c'),
        ]);
        $projectsStore->upsert($merged);
        respond(200, enrichProject($merged, $analystsStore));
    }

    if ($method === 'DELETE' && $id !== null) {
        $projectsStore->delete($id);
        respond(204, null);
    }

    respond(405, ['error' => 'Method not allowed']);
}

function handleStats(Storage $projectsStore, Storage $analystsStore): void
{
    $byAnalyst = [];
    foreach ($analystsStore->all() as $a) {
        $byAnalyst[$a['id']] = [
            'analyst_id' => $a['id'],
            'analyst_name' => $a['name'],
            'projects_total' => 0,
            'projects_active' => 0,
            'projects_completed' => 0,
            'bonus_accrued' => 0.0,
            'bonus_pending' => 0.0,
        ];
    }

    foreach ($projectsStore->all() as $project) {
        $analystId = $project['analyst_id'] ?? null;
        if ($analystId === null || !isset($byAnalyst[$analystId])) {
            continue;
        }
        $analyst = $analystsStore->find($analystId);
        $bonus = BonusCalculator::calculate($project, $analyst ?? []);

        $byAnalyst[$analystId]['projects_total']++;

        $status = $project['status'] ?? 'launched';
        if ($status === 'completed') {
            $byAnalyst[$analystId]['projects_completed']++;
            $byAnalyst[$analystId]['bonus_accrued'] += $bonus;
        } elseif ($status === 'cancelled') {
            // отменённые — без бонуса
        } else {
            $byAnalyst[$analystId]['projects_active']++;
            $byAnalyst[$analystId]['bonus_pending'] += $bonus;
        }
    }

    foreach ($byAnalyst as &$row) {
        $row['bonus_accrued'] = round($row['bonus_accrued'], 2);
        $row['bonus_pending'] = round($row['bonus_pending'], 2);
    }

    respond(200, array_values($byAnalyst));
}

function buildProject(array $body, Storage $analystsStore): array
{
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '') {
        respond(400, ['error' => 'Название проекта обязательно']);
    }
    $analystId = $body['analyst_id'] ?? null;
    if ($analystId === null || $analystsStore->find((string)$analystId) === null) {
        respond(400, ['error' => 'Необходимо выбрать существующего аналитика']);
    }
    $startedAt = trim((string)($body['started_at'] ?? ''));
    if ($startedAt === '') {
        $startedAt = date('Y-m-d');
    }
    return [
        'id' => generateId(),
        'name' => $name,
        'started_at' => $startedAt,
        'status' => normalizeStatus($body['status'] ?? 'launched'),
        'analyst_id' => (string)$analystId,
        'budget' => (float)($body['budget'] ?? 0),
        'custom_bonus' => isset($body['custom_bonus']) && $body['custom_bonus'] !== '' && $body['custom_bonus'] !== null
            ? (float)$body['custom_bonus']
            : null,
        'notes' => (string)($body['notes'] ?? ''),
        'created_at' => date('c'),
        'updated_at' => date('c'),
    ];
}

function enrichProject(array $project, Storage $analystsStore): array
{
    $analyst = isset($project['analyst_id']) ? $analystsStore->find($project['analyst_id']) : null;
    $project['analyst_name'] = $analyst['name'] ?? null;
    $project['bonus'] = BonusCalculator::calculate($project, $analyst ?? []);
    return $project;
}

function normalizeStatus(string $status): string
{
    $allowed = ['launched', 'in_progress', 'completed', 'cancelled'];
    return in_array($status, $allowed, true) ? $status : 'launched';
}

function generateId(): string
{
    return bin2hex(random_bytes(8));
}

function respond(int $code, $payload): void
{
    http_response_code($code);
    if ($payload === null) {
        exit;
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}
