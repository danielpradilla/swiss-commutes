<?php
declare(strict_types=1);
require_once __DIR__ . '/feed.php';

function trafficReplay(string $private, int $now): array {
    $feed = trafficCachedFeed($private, $now);
    $stations = $feed['stations'] ?? [];
    $ids = [];
    foreach ($stations as &$station) {
        foreach ($station['detectors'] as &$detector) {
            $ids[$detector['id']] = true;
            $detector['reading'] = null;
        }
        unset($detector);
    }
    unset($station);
    $frames = [];
    $end = intdiv($now, 60) * 60 - 60;
    for ($at = $end - 29 * 60; $at <= $end; $at += 60) {
        $path = $private . '/history-' . $at . '.json';
        $saved = is_file($path) ? json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR) : [];
        $values = [];
        $errors = [];
        $collected = false;
        foreach ($saved as $id => $reading) {
            if (!isset($ids[$id]) || strtotime($reading['at']) !== $at) continue;
            $collected = true;
            if (in_array($reading['error'] ?? null, LIVE_ERRORS, true)) $errors[$id] = $reading['error'];
            if ($reading['light'] === null && $reading['heavy'] === null) continue;
            // The frame supplies the timestamp; tuples avoid repeating field names for every detector.
            $values[$id] = [$reading['light'], $reading['heavy'], $reading['lightSpeed'], $reading['heavySpeed']];
        }
        $frames[] = ['at' => gmdate('Y-m-d\TH:i:s\Z', $at), 'readings' => (object)$values,
            'collected' => $collected, 'errors' => (object)$errors];
    }
    return ['generatedAt' => gmdate('Y-m-d\TH:i:s\Z', $now), 'collectedAt' => $feed['fetchedAt'] ?? null,
        'intervalSeconds' => 60, 'stations' => $stations, 'frames' => $frames];
}

function serveReplay(): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { http_response_code(405); echo '{"error":"Use GET"}'; return; }
    $private = getenv('SWISS_LIVE_PRIVATE_DIR') ?: __DIR__ . '/.private';
    $lock = null;
    try {
        $lock = fopen($private . '/feed.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock traffic history');
        $replay = trafficReplay($private, time());
        // Release the collector lock before encoding and sending the response to a slow connection.
        flock($lock, LOCK_UN); fclose($lock); $lock = null;
        if (extension_loaded('zlib')) ob_start('ob_gzhandler');
        echo json_encode($replay, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    } catch (Throwable $error) {
        error_log('Swiss Commutes replay: ' . $error->getMessage());
        http_response_code(503);
        header('Retry-After: 60');
        echo '{"error":"Traffic history is temporarily unavailable."}';
    } finally {
        if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) serveReplay();
