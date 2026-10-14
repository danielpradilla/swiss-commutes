<?php
declare(strict_types=1);
require_once __DIR__ . '/feed.php';

const TRAIN_NETWORK_CACHE_SECONDS = 86400;

function trainNetworkTile(array $query): ?array {
    $city = $query['city'] ?? null;
    if (!is_string($city) || !preg_match('/^[a-z]+(?:-[a-z]+)*$/D', $city)
        || array_diff(array_keys($query), ['city', 'z', 'x', 'y'])) throw new TrainRequestError('Invalid network parameters', 400);
    $tile = [];
    foreach (['z', 'x', 'y'] as $name) {
        $value = $query[$name] ?? null;
        if (!is_string($value) || !preg_match('/^(?:0|[1-9][0-9]{0,4})$/D', $value)) throw new TrainRequestError('Invalid network parameters', 400);
        $tile[$name] = (int)$value;
    }
    ['z' => $z, 'x' => $x, 'y' => $y] = $tile;
    if ($z < 7 || $z > 14 || $x >= (1 << $z) || $y >= (1 << $z)) throw new TrainRequestError('Invalid network tile', 400);
    $coverage = trainCoverage($city);
    $edge = M_PI * 6378137;
    $size = 2 * $edge / (1 << $z);
    $west = $x * $size - $edge;
    $north = $edge - $y * $size;
    if ($west > $coverage[2] || $west + $size < $coverage[0] || $north < $coverage[1] || $north - $size > $coverage[3]) return null;
    return $tile;
}

// Reject broken top-level protobuf framing before it can replace a last-good tile.
function trainNetworkBody(string $body, string $key = ''): void {
    $length = strlen($body);
    if (!$length || $length > TRAIN_BODY_LIMIT || ($key !== '' && (str_contains($body, $key) || str_contains($body, rawurlencode($key))))) throw new RuntimeException('Invalid network response');
    $offset = 0;
    while ($offset < $length) {
        if (ord($body[$offset++]) !== 26) throw new RuntimeException('Invalid network protobuf');
        $size = 0;
        for ($shift = 0; ; $shift += 7) {
            if ($shift > 28 || $offset >= $length) throw new RuntimeException('Invalid network protobuf');
            $byte = ord($body[$offset++]);
            $size |= ($byte & 127) << $shift;
            if (($byte & 128) === 0) break;
        }
        if ($size === 0 || $size > $length - $offset) throw new RuntimeException('Invalid network protobuf');
        $offset += $size;
    }
}

function trainNetworkResponse(array $response, string $key): string {
    $body = $response['body'] ?? null;
    $type = strtolower(trim(explode(';', (string)($response['type'] ?? ''))[0]));
    if (($response['status'] ?? null) !== 200 || !is_string($body)
        || !in_array($type, ['application/x-protobuf', 'application/protobuf', 'application/vnd.google.protobuf', 'application/vnd.mapbox-vector-tile'], true)) throw new RuntimeException('Network upstream unavailable');
    trainNetworkBody($body, $key);
    return $body;
}

// Only this server-side transport constructs the credential-bearing upstream URL.
function trainNetworkFetch(string $key, string $endpoint): array {
    if (!function_exists('curl_init')) throw new RuntimeException('Network transport unavailable');
    $curl = curl_init('https://maps.geops.io/data/openmaptiles_v2/' . $endpoint . '?key=' . rawurlencode($key));
    if ($curl === false) throw new RuntimeException('Network transport unavailable');
    $body = '';
    curl_setopt_array($curl, [CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 12, CURLOPT_ENCODING => '',
        CURLOPT_HTTPHEADER => ['Accept: application/x-protobuf', 'User-Agent: SwissCommutesTrains/1.0'],
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body): int {
            if (strlen($body) + strlen($chunk) > TRAIN_BODY_LIMIT) return 0;
            $body .= $chunk;
            return strlen($chunk);
        }]);
    if (@curl_exec($curl) === false) throw new RuntimeException('Network upstream unavailable');
    return ['status' => curl_getinfo($curl, CURLINFO_RESPONSE_CODE), 'type' => curl_getinfo($curl, CURLINFO_CONTENT_TYPE), 'body' => $body];
}

function trainNetworkStored(string $path): ?string {
    clearstatcache(true, $path);
    if (!is_file($path)) return null;
    try {
        $body = @file_get_contents($path, false, null, 0, TRAIN_BODY_LIMIT + 1);
        if (!is_string($body)) return null;
        trainNetworkBody($body);
        return $body;
    } catch (Throwable) {
        return null;
    }
}

function trainNetworkStore(string $path, string $body, int $now): void {
    $temporary = $path . '.tmp';
    try {
        if (@file_put_contents($temporary, $body) !== strlen($body) || !@chmod($temporary, 0600)
            || @file_get_contents($temporary) !== $body || !@touch($temporary, $now) || !@rename($temporary, $path)) throw new RuntimeException('Cannot save network cache');
    } finally {
        if (is_file($temporary)) @unlink($temporary);
    }
}

function trainNetworkCached(string $private, array $tile, callable $fetch, int $now): string {
    ['z' => $z, 'x' => $x, 'y' => $y] = $tile;
    $directory = $private . '/network/' . $z . '/' . $x;
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Cannot create network cache');
    $path = $directory . '/' . $y . '.pbf';
    $lock = @fopen($path . '.lock', 'c');
    if ($lock === false) throw new RuntimeException('Cannot lock network cache');
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock network cache');
        $stored = trainNetworkStored($path);
        if ($stored !== null && $now - filemtime($path) < TRAIN_NETWORK_CACHE_SECONDS) return $stored;
        $retry = $path . '.retry';
        clearstatcache(true, $retry);
        if (is_file($retry) && $now - filemtime($retry) < TRAIN_CACHE_SECONDS) {
            if ($stored !== null) return $stored;
            throw new RuntimeException('Network retry pending');
        }
        try {
            $key = trainKey($private);
            $body = trainNetworkResponse($fetch($key, $z . '/' . $x . '/' . $y . '.pbf'), $key);
            trainNetworkStore($path, $body, $now);
            if (is_file($retry)) @unlink($retry);
            return $body;
        } catch (Throwable) {
            @touch($retry, $now);
            if ($stored !== null) return $stored;
            throw new RuntimeException('Network updates unavailable');
        }
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function trainNetworkRequest(array $query, ?callable $fetch = null, ?int $now = null): ?string {
    $tile = trainNetworkTile($query);
    if ($tile === null) return null;
    return trainNetworkCached(getenv('SWISS_TRAINS_PRIVATE_DIR') ?: __DIR__ . '/.private', $tile, $fetch ?? 'trainNetworkFetch', $now ?? time());
}

function serveTrainNetwork(?callable $fetch = null): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { http_response_code(405); header('Allow: GET'); echo '{"error":"Use GET"}'; return; }
    try {
        $body = trainNetworkRequest($_GET, $fetch);
        if ($body === null) { http_response_code(204); header_remove('Content-Type'); return; }
        header('Content-Type: application/x-protobuf');
        header('Cache-Control: public, max-age=86400');
        if (extension_loaded('zlib')) ob_start('ob_gzhandler');
        echo $body;
    } catch (TrainRequestError $error) {
        http_response_code($error->getCode());
        echo json_encode(['error' => $error->getMessage()], JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        http_response_code(503);
        header('Retry-After: 15');
        echo '{"error":"Transit network tiles are temporarily unavailable."}';
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) serveTrainNetwork();
