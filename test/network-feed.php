<?php
declare(strict_types=1);
require __DIR__ . '/../public/trains/network.php';

function networkCheck(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function networkReject(callable $action, int $status = 0): void {
    try { $action(); } catch (RuntimeException $error) {
        networkCheck(!$status || $error->getCode() === $status, 'Unexpected failure status');
        return;
    }
    throw new RuntimeException('Expected rejection');
}
function networkRemove(string $path): void {
    foreach (glob($path . '/*') ?: [] as $entry) {
        if (is_dir($entry)) networkRemove($entry); else unlink($entry);
    }
    rmdir($path);
}
function networkFixture(string $name): string {
    $layer = "\x0a" . chr(strlen($name)) . $name . "\x28\x80\x20\x78\x02";
    return "\x1a" . chr(strlen($layer)) . $layer;
}
function networkHttp(string $url, string $method = 'GET', bool $gzip = false): array {
    $context = stream_context_create(['http' => ['method' => $method, 'ignore_errors' => true, 'timeout' => 3,
        'header' => $gzip ? "Accept-Encoding: gzip\r\n" : '']]);
    $body = file_get_contents($url, false, $context);
    $headers = [];
    foreach ($http_response_header ?? [] as $line) {
        if (str_starts_with($line, 'HTTP/')) { preg_match('/HTTP\/\S+ ([0-9]+)/', $line, $match); $headers['status'] = (int)$match[1]; }
        elseif (str_contains($line, ':')) { [$name, $value] = explode(':', $line, 2); $headers[strtolower($name)] = trim($value); }
    }
    if (($headers['content-encoding'] ?? '') === 'gzip') $body = gzdecode($body);
    return [$headers, $body];
}

$directory = sys_get_temp_dir() . '/swiss-network-' . bin2hex(random_bytes(6));
mkdir($directory, 0700);
$environment = [];
foreach (['SWISS_TRAINS_PRIVATE_DIR', 'SWISS_TRAINS_CITIES_FILE', 'GEOPS_API_KEY'] as $name) $environment[$name] = getenv($name);
putenv('SWISS_TRAINS_PRIVATE_DIR=' . $directory);
putenv('SWISS_TRAINS_CITIES_FILE=' . $directory . '/cities.json');
putenv('GEOPS_API_KEY');
file_put_contents($directory . '/cities.json', json_encode(['geneva' => ['lat' => 46.2, 'lon' => 6.14], 'neighbor' => ['lat' => 46.21, 'lon' => 6.15]], JSON_THROW_ON_ERROR));
file_put_contents($directory . '/credentials.env', "GEOPS_API_KEY=private-test-secret\n");
$body = networkFixture('transportation');
$changed = networkFixture('transportation_name');
$query = ['city' => 'geneva', 'z' => '12', 'x' => '2117', 'y' => '1453'];
$path = $directory . '/network/12/2117/1453.pbf';
$requests = [];
$fetch = function (string $key, string $endpoint) use (&$requests, $body, $path): array {
    networkCheck($key === 'private-test-secret', 'Load the existing private credential');
    networkCheck($endpoint === '12/2117/1453.pbf' && !str_contains($endpoint, $key), 'Use only the fixed relative tile path');
    $lock = fopen($path . '.lock', 'c');
    networkCheck(!flock($lock, LOCK_EX | LOCK_NB), 'Hold the per-tile exclusive lock throughout fetching');
    fclose($lock);
    $requests[] = $endpoint;
    return ['status' => 200, 'type' => 'application/x-protobuf', 'body' => $body];
};
$now = 1800000000;
$server = null;
try {
    $before = count($requests);
    foreach ([[], ['city' => ['geneva']], ['city' => '../geneva'], ['city' => 'geneva', 'key' => 'injected'], ['z' => '6'], ['z' => '15'], ['x' => '4096'], ['y' => '4096'], ['x' => '-1'], ['y' => '1.5'], ['x' => '01'], ['x' => '1e2'], ['x' => '+1'], ['y' => ' 1'], ['x' => str_repeat('9', 100)], ['z' => ['12']], ['x' => []], ['y' => null]] as $override) {
        $invalid = $override === [] ? [] : array_replace($query, $override);
        networkReject(fn() => trainNetworkRequest($invalid, $fetch, $now), 400);
    }
    networkReject(fn() => trainNetworkRequest(array_replace($query, ['city' => 'unknown']), $fetch, $now), 404);
    networkCheck(trainNetworkRequest(array_replace($query, ['x' => '0', 'y' => '0']), $fetch, $now) === null, 'Outside coverage is a valid empty tile');
    networkCheck(count($requests) === $before && !is_dir($directory . '/network'), 'Invalid and outside tiles never fetch or allocate a cache');
    foreach (['7', '14'] as $z) {
        $coverage = trainCoverage('geneva');
        $edge = M_PI * 6378137;
        $size = 2 * $edge / (1 << (int)$z);
        $x = (string)(int)floor((($coverage[0] + $coverage[2]) / 2 + $edge) / $size);
        $y = (string)(int)floor(($edge - ($coverage[1] + $coverage[3]) / 2) / $size);
        networkCheck(trainNetworkTile(['city' => 'geneva', 'z' => $z, 'x' => $x, 'y' => $y]) !== null, 'Both supported zoom endpoints cover the city');
    }
    networkCheck(trainNetworkRequest($query, $fetch, $now) === $body && count($requests) === 1, 'Fetch and cache a new binary tile');
    networkCheck(file_get_contents($path) === $body && !file_exists($path . '.tmp'), 'Commit exact binary bytes atomically');
    networkCheck((fileperms(dirname($path)) & 0777) === 0700 && (fileperms($path) & 0777) === 0600, 'Keep cached tiles private');
    networkCheck(trainNetworkRequest($query, $fetch, $now + 86399) === $body && count($requests) === 1, 'Keep tiles fresh for a full 24 hours');
    networkCheck(trainNetworkRequest(array_replace($query, ['city' => 'neighbor']), $fetch, $now + 86399) === $body && count($requests) === 1, 'Overlapping city coverage shares tile cache');
    $failures = 0;
    $failure = function () use (&$failures): array { $failures++; throw new RuntimeException('https://maps.geops.io/?key=private-test-secret'); };
    networkCheck(trainNetworkRequest($query, $failure, $now + 86400) === $body && $failures === 1, 'Expiry attempts a refresh and preserves stale bytes on failure');
    networkCheck(trainNetworkRequest($query, $failure, $now + 86414) === $body && $failures === 1, 'Retry guard prevents repeated outage fetching for 15 seconds');
    networkCheck(filemtime($path) === $now, 'Failure never makes old data look fresh');
    $invalidResponses = [
        ['status' => 500, 'type' => 'application/x-protobuf', 'body' => $changed],
        ['status' => 200, 'type' => 'text/html', 'body' => '<html>error</html>'],
        ['status' => 200, 'type' => 'application/json', 'body' => '{"error":"secret"}'],
        ['status' => 200, 'type' => 'image/png', 'body' => "\x89PNG\r\n\x1a\n"],
        ['status' => 200, 'type' => 'application/x-protobuf', 'body' => '{"error":"secret"}'],
        ['status' => 200, 'type' => 'application/x-protobuf', 'body' => "\x1a\xff"],
        ['status' => 200, 'type' => 'application/x-protobuf', 'body' => ''],
        ['status' => 200, 'type' => 'application/x-protobuf', 'body' => networkFixture('private-test-secret')],
    ];
    $refresh = $now + 86415;
    foreach ($invalidResponses as $response) {
        networkCheck(trainNetworkRequest($query, fn() => $response, $refresh) === $body, 'Invalid upstream responses cannot replace last-good bytes');
        networkCheck(file_get_contents($path) === $body && filemtime($path) === $now, 'Invalid upstream leaves the committed cache untouched');
        $refresh += 15;
    }
    networkReject(fn() => trainNetworkBody(str_repeat('x', TRAIN_BODY_LIMIT + 1)));
    mkdir($path . '.tmp');
    networkCheck(trainNetworkRequest($query, fn() => ['status' => 200, 'type' => 'application/x-protobuf', 'body' => $changed], $refresh) === $body, 'A failed temporary write preserves the old tile');
    networkCheck(file_get_contents($path) === $body, 'No partial write replaces a good cache');
    rmdir($path . '.tmp');
    $refresh += 15;
    networkCheck(trainNetworkRequest($query, fn() => ['status' => 200, 'type' => 'application/protobuf; charset=binary', 'body' => $changed], $refresh) === $changed, 'Successful recovery accepts protobuf MIME and updates exact bytes');
    networkCheck(filemtime($path) === $refresh && !is_file($path . '.retry'), 'Recovery renews freshness and clears retry state');

    $cold = array_replace($query, ['x' => '2118']);
    unlink($directory . '/credentials.env');
    $never = function () use (&$failures): array { $failures++; throw new RuntimeException('Unexpected fetch'); };
    $before = $failures;
    networkReject(fn() => trainNetworkRequest($cold, $never, $now));
    networkReject(fn() => trainNetworkRequest($cold, $never, $now + 14));
    networkCheck($failures === $before, 'Missing credentials and cold retry guard never invoke upstream');
    networkCheck(!is_file($directory . '/network/12/2118/1453.pbf'), 'Failed cold requests create no fake binary body');
    touch($path, time());
    touch($directory . '/network/12/2118/1453.pbf.retry', time());

    // Exercise the real entrypoint and headers without any live upstream access.
    $socket = stream_socket_server('tcp://127.0.0.1:0', $errorCode, $errorMessage);
    networkCheck($socket !== false, 'Reserve a local HTTP test port');
    $address = stream_socket_get_name($socket, false);
    fclose($socket);
    $server = proc_open([PHP_BINARY, '-S', $address, '-t', realpath(__DIR__ . '/../public')], [['pipe', 'r'], ['file', $directory . '/http.log', 'a'], ['file', $directory . '/http.log', 'a']], $pipes);
    networkCheck(is_resource($server), 'Start the real PHP endpoint server');
    fclose($pipes[0]);
    $ready = false;
    for ($attempt = 0; $attempt < 100; $attempt++) {
        $connection = @stream_socket_client('tcp://' . $address, $errorCode, $errorMessage, 0.05);
        if ($connection !== false) { fclose($connection); $ready = true; break; }
        usleep(20000);
    }
    networkCheck($ready, 'HTTP endpoint becomes available');
    $url = 'http://' . $address . '/trains/network.php?';
    [$headers, $received] = networkHttp($url . http_build_query($query));
    networkCheck(($headers['status'] ?? null) === 200 && $received === $changed, 'Real entrypoint returns unchanged cached binary bytes');
    networkCheck(($headers['content-type'] ?? '') === 'application/x-protobuf' && ($headers['cache-control'] ?? '') === 'public, max-age=86400' && ($headers['x-content-type-options'] ?? '') === 'nosniff', 'Successful endpoint has protobuf, public caching and nosniff headers');
    [$headers, $received] = networkHttp($url . http_build_query($query), 'GET', true);
    networkCheck(($headers['status'] ?? null) === 200 && $received === $changed, 'Optional gzip preserves binary content');
    [$headers, $received] = networkHttp($url . http_build_query(array_replace($query, ['x' => '0', 'y' => '0'])));
    networkCheck(($headers['status'] ?? null) === 204 && $received === '' && ($headers['cache-control'] ?? '') === 'no-store', 'Outside tile is HTTP 204 with no body or successful-cache header');
    [$headers, $received] = networkHttp($url . http_build_query(array_replace($query, ['x' => ['2117']])));
    networkCheck(($headers['status'] ?? null) === 400 && ($headers['cache-control'] ?? '') === 'no-store' && str_starts_with($headers['content-type'] ?? '', 'application/json'), 'Real query array injection is a safe JSON HTTP 400');
    [$headers, $received] = networkHttp($url . http_build_query($cold));
    networkCheck(($headers['status'] ?? null) === 503 && ($headers['retry-after'] ?? '') === '15' && ($headers['cache-control'] ?? '') === 'no-store', 'Cold failure is HTTP 503 with retry guard headers');
    networkCheck(json_decode($received, true, 512, JSON_THROW_ON_ERROR) === ['error' => 'Transit network tiles are temporarily unavailable.'] && !str_contains($received, 'private-test-secret') && !str_contains($received, 'maps.geops.io'), 'Error response exposes neither credentials nor upstream URLs');
    [$headers, $received] = networkHttp($url . http_build_query($query), 'POST');
    networkCheck(($headers['status'] ?? null) === 405 && ($headers['allow'] ?? '') === 'GET', 'The real endpoint only permits GET');
} finally {
    if (is_resource($server)) { proc_terminate($server); proc_close($server); }
    networkRemove($directory);
    foreach ($environment as $name => $value) putenv($value === false ? $name : $name . '=' . $value);
}
echo "Verified network tile validation, private binary cache, stale/retry safety and actual HTTP endpoint headers\n";
