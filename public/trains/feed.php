<?php
declare(strict_types=1);

const TRAIN_CACHE_SECONDS = 15;
const TRAIN_BODY_LIMIT = 16 * 1024 * 1024;

final class TrainRequestError extends RuntimeException {}

function trainJson(string $body): array {
    if (strlen($body) > TRAIN_BODY_LIMIT) throw new RuntimeException('Transit response too large');
    $value = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($value)) throw new RuntimeException('Invalid transit response');
    return $value;
}

function trainPoint(mixed $point): bool {
    return is_array($point) && count($point) >= 2 && is_numeric($point[0] ?? null) && is_numeric($point[1] ?? null)
        && is_finite((float)$point[0]) && is_finite((float)$point[1])
        && abs((float)$point[0]) <= 20037509 && abs((float)$point[1]) <= 20037509;
}

function trainGeometry(mixed $geometry, bool $route = false): bool {
    if (!is_array($geometry)) return false;
    $type = $geometry['type'] ?? null;
    if ($route && $type === 'GeometryCollection') {
        $parts = $geometry['geometries'] ?? null;
        if (!is_array($parts) || !array_is_list($parts) || !$parts) return false;
        foreach ($parts as $part) if (!trainGeometry($part, true)) return false;
        return true;
    }
    $coordinates = $geometry['coordinates'] ?? null;
    if ($type === 'Point') return trainPoint($coordinates);
    if (!in_array($type, $route ? ['LineString', 'MultiPoint', 'MultiLineString'] : ['LineString'], true)
        || !is_array($coordinates) || !array_is_list($coordinates) || !$coordinates) return false;
    foreach ($coordinates as $point) {
        if ($type === 'MultiLineString') {
            if (!trainGeometry(['type' => 'LineString', 'coordinates' => $point], true)) return false;
        } elseif (!trainPoint($point)) return false;
    }
    return true;
}

function trainFeatures(array $value, bool $route = false): array {
    if (($value['type'] ?? null) !== 'FeatureCollection' || !is_array($value['features'] ?? null)
        || !array_is_list($value['features'])) throw new RuntimeException('Invalid transit collection');
    $features = [];
    foreach ($value['features'] as $feature) {
        if (!is_array($feature) || ($feature['type'] ?? null) !== 'Feature' || !is_array($feature['properties'] ?? null)) {
            throw new RuntimeException('Invalid transit feature');
        }
        $properties = $feature['properties'];
        if (!$route && !is_string($properties['type'] ?? null)) throw new RuntimeException('Invalid transit mode');
        if (!$route && !in_array($properties['type'] ?? null, ['rail', 'tram', 'subway', 'bus'], true)) continue;
        if (!trainGeometry($feature['geometry'] ?? null, $route)) throw new RuntimeException('Invalid transit geometry');
        if (!$route) {
            if (trainVehicleId($feature) === null || !is_array($properties['time_intervals'] ?? null)
                || !array_is_list($properties['time_intervals'])
                || (($feature['geometry']['type'] ?? null) === 'LineString'
                    && (count($feature['geometry']['coordinates']) < 2 || !$properties['time_intervals']))) {
                throw new RuntimeException('Invalid transit trajectory');
            }
            $previous = 0;
            foreach ($properties['time_intervals'] as $interval) {
                if (!is_array($interval) || !array_is_list($interval) || count($interval) !== 3
                    || (!is_int($interval[0]) && !is_float($interval[0])) || !is_finite((float)$interval[0])
                    || $interval[0] <= 0 || $interval[0] < $previous
                    || (!is_int($interval[1]) && !is_float($interval[1])) || !is_finite((float)$interval[1])
                    || $interval[1] < 0 || $interval[1] > 1
                    || ($interval[2] !== null && ((!is_int($interval[2]) && !is_float($interval[2])) || !is_finite((float)$interval[2])))) {
                    throw new RuntimeException('Invalid transit interval');
                }
                $previous = $interval[0];
            }
        }
        $features[] = $feature;
    }
    return $features;
}

function trainVehicleId(array $feature): ?string {
    foreach ([$feature['id'] ?? null, $feature['properties']['train_id'] ?? null] as $id) {
        if ((is_string($id) || is_int($id)) && preg_match('/^(?:sbb_)?([0-9]{1,30})$/D', (string)$id, $match)) return 'sbb_' . $match[1];
    }
    return null;
}

function trainCalls(array $calls): void {
    if (!array_is_list($calls)) throw new RuntimeException('Invalid transit calls');
    foreach ($calls as $journey) {
        if (!is_array($journey) || !is_array($journey['stations'] ?? null) || !array_is_list($journey['stations'])) throw new RuntimeException('Invalid transit journey calls');
        foreach ($journey['stations'] as $station) {
            if (!is_array($station) || !is_string($station['stationName'] ?? null)
                || (isset($station['coordinate']) && !trainPoint($station['coordinate']))) throw new RuntimeException('Invalid transit station');
            foreach (['arrivalTime', 'departureTime', 'aimedArrivalTime', 'aimedDepartureTime'] as $field) {
                if (isset($station[$field]) && (!is_string($station[$field]) || strtotime($station[$field]) === false)) throw new RuntimeException('Invalid transit stop time');
            }
        }
    }
}

function trainCoverage(string $city): array {
    $path = getenv('SWISS_TRAINS_CITIES_FILE') ?: __DIR__ . '/cities.json';
    $cities = trainJson(file_get_contents($path) ?: '');
    if (!array_key_exists($city, $cities)) throw new TrainRequestError('Unknown city', 404);
    $lat = $cities[$city]['lat'] ?? null;
    $lon = $cities[$city]['lon'] ?? null;
    if (!is_numeric($lat) || !is_numeric($lon) || abs((float)$lat) > 85 || abs((float)$lon) > 180) throw new RuntimeException('Invalid transit city');
    $x = 6378137 * deg2rad((float)$lon);
    $y = 6378137 * log(tan(M_PI / 4 + deg2rad((float)$lat) / 2));
    return [(int)floor($x - 80000), (int)floor($y - 80000), (int)ceil($x + 80000), (int)ceil($y + 80000)];
}

function trainKey(string $private): string {
    $key = getenv('GEOPS_API_KEY') ?: '';
    if (!$key && is_file($private . '/credentials.env')) {
        foreach (file($private . '/credentials.env', FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            if (preg_match('/^\s*GEOPS_API_KEY\s*=\s*(.*?)\s*$/', $line, $match)) $key = trim($match[1], "\"'");
        }
    }
    if (!$key || preg_match('/[\r\n]/', $key)) throw new RuntimeException('Transit credentials unavailable');
    return $key;
}

// The callback receives only a relative endpoint; exception messages never reach logs or responses.
function trainFetch(string $key, string $endpoint): string {
    if (!function_exists('curl_init')) throw new RuntimeException('Transit transport unavailable');
    $curl = curl_init('https://api.geops.io/tracker-http/v1/' . $endpoint . (str_contains($endpoint, '?') ? '&' : '?') . 'key=' . rawurlencode($key));
    $body = '';
    curl_setopt_array($curl, [CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 12,
        CURLOPT_ENCODING => '', CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: SwissCommutesTrains/1.0'],
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body): int {
            if (strlen($body) + strlen($chunk) > TRAIN_BODY_LIMIT) return 0;
            $body .= $chunk;
            return strlen($chunk);
        }]);
    $ok = curl_exec($curl);
    if ($ok === false || curl_getinfo($curl, CURLINFO_RESPONSE_CODE) !== 200) throw new RuntimeException('Transit upstream unavailable');
    return $body;
}

function trainStore(string $path, array $value): void {
    $json = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    if (file_put_contents($path . '.tmp', $json) !== strlen($json) || !rename($path . '.tmp', $path)) throw new RuntimeException('Cannot save transit cache');
}

function trainStored(string $path, string $city, array $coverage, ?string $vehicle): ?array {
    if (!is_file($path)) return null;
    try {
        $value = trainJson(file_get_contents($path) ?: '');
        if (!is_string($value['fetchedAt'] ?? null) || strtotime($value['fetchedAt']) === false) return null;
        if ($vehicle === null) {
            if (($value['city'] ?? null) !== $city || ($value['coverage'] ?? null) !== $coverage) return null;
            trainFeatures(['type' => 'FeatureCollection', 'features' => $value['features'] ?? null]);
        } else {
            if (($value['vehicleId'] ?? null) !== $vehicle) return null;
            trainFeatures($value['route'] ?? [], true);
            trainCalls($value['calls'] ?? []);
            if (!isset($value['calls'])) return null;
        }
        return $value;
    } catch (Throwable) {
        return null;
    }
}

function trainCached(string $private, string $city, array $coverage, ?string $vehicle, callable $fetch, int $now): array {
    $directory = $private . '/geops';
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Cannot create transit cache');
    $path = $directory . '/' . $city . ($vehicle === null ? '' : '-' . $vehicle) . '.json';
    $lock = fopen($path . '.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock transit cache');
    try {
        $stored = trainStored($path, $city, $coverage, $vehicle);
        if ($stored && $now - strtotime($stored['fetchedAt']) < TRAIN_CACHE_SECONDS) return $stored;
        $retry = $path . '.retry';
        clearstatcache(true, $retry);
        if (is_file($retry) && $now - filemtime($retry) < TRAIN_CACHE_SECONDS) {
            if ($stored) return $stored;
            throw new RuntimeException('Transit retry pending');
        }
        try {
            $key = trainKey($private);
            if ($vehicle === null) {
                $features = trainFeatures(trainJson($fetch($key, 'trajectories/sbb/?bbox=' . implode(',', $coverage) . '&gen_level=100')));
                $fresh = ['fetchedAt' => gmdate('Y-m-d\TH:i:s\Z', $now), 'city' => $city, 'coverage' => $coverage, 'features' => $features];
            } else {
                $route = trainJson($fetch($key, 'journeys/' . $vehicle . '/'));
                trainFeatures($route, true);
                $callsBody = $fetch($key, 'calls/' . $vehicle . '/');
                if (!str_starts_with(ltrim($callsBody), '[')) throw new RuntimeException('Invalid transit calls');
                $calls = trainJson($callsBody);
                trainCalls($calls);
                $fresh = ['fetchedAt' => gmdate('Y-m-d\TH:i:s\Z', $now), 'vehicleId' => $vehicle, 'route' => $route, 'calls' => $calls];
            }
            // Reject a credential accidentally echoed anywhere in a raw upstream response.
            if (str_contains(json_encode($fresh, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), $key)) throw new RuntimeException('Unsafe transit response');
            trainStore($path, $fresh);
            if (is_file($retry)) unlink($retry);
            return $fresh;
        } catch (Throwable) {
            touch($retry, $now);
            if ($stored) return $stored;
            throw new RuntimeException('Transit updates unavailable');
        }
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function trainRequest(array $query, ?callable $fetch = null, ?int $now = null): array {
    $city = $query['city'] ?? null;
    $vehicle = $query['vehicle'] ?? null;
    if (!is_string($city) || !preg_match('/^[a-z]+(?:-[a-z]+)*$/D', $city)
        || (array_key_exists('vehicle', $query) && (!is_string($vehicle) || !preg_match('/^sbb_[0-9]{1,30}$/D', $vehicle)))
        || array_diff(array_keys($query), ['city', 'vehicle'])) throw new TrainRequestError('Invalid transit parameters', 400);
    $coverage = trainCoverage($city);
    $private = getenv('SWISS_TRAINS_PRIVATE_DIR') ?: __DIR__ . '/.private';
    $fetch ??= 'trainFetch';
    $now ??= time();
    $feed = trainCached($private, $city, $coverage, null, $fetch, $now);
    if ($vehicle === null) return $feed;
    foreach ($feed['features'] as $feature) {
        if (trainVehicleId($feature) === $vehicle) return trainCached($private, $city, $coverage, $vehicle, $fetch, $now);
    }
    throw new TrainRequestError('Vehicle not in city feed', 404);
}

function serveTrains(?callable $fetch = null): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { http_response_code(405); header('Allow: GET'); echo '{"error":"Use GET"}'; return; }
    try {
        $feed = trainRequest($_GET, $fetch);
        if (extension_loaded('zlib')) ob_start('ob_gzhandler');
        echo json_encode($feed, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    } catch (TrainRequestError $error) {
        http_response_code($error->getCode());
        echo json_encode(['error' => $error->getMessage()], JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        http_response_code(503);
        header('Retry-After: 15');
        echo '{"error":"Live transit updates are temporarily unavailable."}';
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) serveTrains();
