<?php

declare(strict_types=1);

namespace DealDist\App;

use DealDist\Http\Middleware\AuthMiddleware;
use DealDist\Http\Middleware\CorsMiddleware;
use DealDist\Http\Middleware\JsonMiddleware;
use DealDist\Http\Controller\DistributeController;
use DealDist\Http\Controller\OAuthController;
use DealDist\Http\Controller\QueueController;
use DealDist\Http\Controller\ScheduleController;
use DealDist\Http\Controller\SettingsController;
use DealDist\Http\Controller\WebhookController;
use DealDist\Http\Controller\MonitorController;
use DealDist\Http\Controller\TelegramController;
use DealDist\Monitor\ViolationStorage;
use DealDist\Monitor\TelegramNotificationService;
use DealDist\Monitor\ViolationMonitor;
use DI\ContainerBuilder;
use Monolog\Handler\StreamHandler;
use Monolog\Level;
use Monolog\Logger;
use Slim\Factory\AppFactory as SlimAppFactory;

class AppFactory
{
    public static function create(): \Slim\App
    {
        // Load .env
        $dotenv = \Dotenv\Dotenv::createImmutable(__DIR__ . '/../../');
        $dotenv->safeLoad();

        // DI container
        $builder = new ContainerBuilder();
        $builder->addDefinitions(self::definitions());
        $container = $builder->build();

        // Slim app
        SlimAppFactory::setContainer($container);
        $app = SlimAppFactory::create();
        $app->addErrorMiddleware(true, true, true);
        $app->add(new JsonMiddleware());
        $app->add(new CorsMiddleware());

        // OPTIONS preflight — must be declared before other routes
        $app->options('/{routes:.+}', function ($request, $response) {
            return $response;
        });

        // Routes
        $app->post('/api/distribute',                   DistributeController::class . ':distribute');
        $app->put('/api/settings',                      SettingsController::class   . ':save');
        $app->get('/api/settings',                      SettingsController::class   . ':get');

        // Schedules
        $app->get('/api/schedules',                     ScheduleController::class   . ':listAll');
        $app->get('/api/schedules/{userId:[0-9]+}',     ScheduleController::class   . ':get');
        $app->put('/api/schedules/{userId:[0-9]+}',     ScheduleController::class   . ':save');
        $app->delete('/api/schedules/{userId:[0-9]+}',  ScheduleController::class   . ':delete');

        // Queue management
        $app->get('/api/queue',                         QueueController::class      . ':listQueues');
        $app->post('/api/queue/{ruleHash}/reset',       QueueController::class      . ':resetQueue');
        $app->get('/api/log',                           QueueController::class      . ':getLog');

        // Monitoring & Violations
        $app->post('/api/violations',                   MonitorController::class    . ':createViolation');
        $app->get('/api/violations',                    MonitorController::class    . ':listViolations');
        $app->put('/api/violations/{id}',               MonitorController::class    . ':resolveViolation');

        // Telegram webhook
        $app->post('/webhook/telegram',                 TelegramController::class   . ':handleWebhook');

        // AmoCRM webhook (alternative to Digital Pipeline)
        $app->post('/webhook/leads',                    WebhookController::class    . ':handle');

        $app->get('/oauth/callback',                    OAuthController::class      . ':callback');

        return $app;
    }

    private static function definitions(): array
    {
        return [
            Logger::class => static function () {
                $level   = strtoupper($_ENV['LOG_LEVEL'] ?? 'INFO');
                $logger  = new Logger('deal-dist');
                $logger->pushHandler(new StreamHandler('php://stderr', Level::fromName($level)));
                return $logger;
            },
            ViolationStorage::class => static function () {
                $storagePath = $_ENV['STORAGE_PATH'] ?? '/tmp/deal-dist-storage';
                return new ViolationStorage($storagePath);
            },
            TelegramNotificationService::class => static function (Logger $logger) {
                $botToken = $_ENV['TELEGRAM_BOT_TOKEN'] ?? '';
                $chatId = $_ENV['TELEGRAM_CHAT_ID'] ?? '';
                return new TelegramNotificationService($botToken, $chatId, $logger);
            },
            ViolationMonitor::class => static function (Logger $logger) {
                return new ViolationMonitor(
                    new \DealDist\AmoCRM\ApiClient(),
                    new ViolationStorage($_ENV['STORAGE_PATH'] ?? '/tmp/deal-dist-storage'),
                    $logger
                );
            },
            TelegramController::class => static function (ViolationStorage $storage, Logger $logger) {
                $botToken = $_ENV['TELEGRAM_BOT_TOKEN'] ?? '';
                return new TelegramController($storage, $logger, $botToken);
            },
        ];
    }
}
