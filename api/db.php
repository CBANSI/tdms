<?php

function tdms_config(): array
{
    $configFile = __DIR__ . '/config.php';
    if (!file_exists($configFile)) {
        http_response_code(500);
        echo json_encode([
            'ok' => false,
            'message' => 'Missing api/config.php. Copy api/config.example.php to api/config.php and update your MySQL credentials.',
        ]);
        exit;
    }

    return require $configFile;
}

function tdms_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = tdms_config();
    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
        $config['db_host'],
        $config['db_port'],
        $config['db_name']
    );

    $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    return $pdo;
}
