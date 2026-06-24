<?php
/**
 * Роутер для встроенного PHP-сервера: php -S 0.0.0.0:8090 -t projects projects/router.php
 *
 * Все обращения к /api/* направляет в api/index.php, остальные пути отдаются как статические файлы.
 */

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if (strpos($path, '/api') === 0) {
    require __DIR__ . '/api/index.php';
    return true;
}

$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) {
    return false; // отдаст встроенный сервер
}

require __DIR__ . '/index.html';
return true;
