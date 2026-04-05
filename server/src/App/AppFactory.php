<?php

declare(strict_types=1);

namespace DealDist\App;

use DealDist\Http\Middleware\AuthMiddleware;
use DealDist\Http\Middleware\JsonMiddleware;
use DealDist\Http\Controller\DistributeController;
use DealDist\Http\Controller\SettingsController;
use DealDist\Http\Controller\OAuthController;
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

        // Routes
        $app->post('/api/distribute', DistributeController::class . ':distribute');
        $app->put('/api/settings',    SettingsController::class  . ':save');
        $app->get('/api/settings',    SettingsController::class  . ':get');
        $app->get('/oauth/callback',  OAuthController::class     . ':callback');

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
        ];
    }
}
