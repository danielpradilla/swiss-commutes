<?php
declare(strict_types=1);
require __DIR__ . '/../public/trains/feed.php';

function trainCheck(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function trainReject(callable $action, int $status = 0): void {
    try { $action(); } catch (RuntimeException $error) {
        trainCheck(!$status || $error->getCode() === $status, 'Unexpected failure status');
        return;
    }
    throw new RuntimeException('Expected rejection');
}
function trainRemove(string $path): void {
    foreach (glob($path . '/*') ?: [] as $entry) {
        if (is_dir($entry)) trainRemove($entry); else unlink($entry);
    }
    rmdir($path);
}

$directory = sys_get_temp_dir() . '/swiss-transit-' . bin2hex(random_bytes(6));
mkdir($directory, 0700);
$environment = [];
foreach (['SWISS_TRAINS_PRIVATE_DIR', 'SWISS_TRAINS_CITIES_FILE', 'GEOPS_API_KEY'] as $name) $environment[$name] = getenv($name);
putenv('SWISS_TRAINS_PRIVATE_DIR=' . $directory);
putenv('SWISS_TRAINS_CITIES_FILE=' . $directory . '/cities.json');
putenv('GEOPS_API_KEY');
file_put_contents($directory . '/cities.json', json_encode(['zurich' => ['lat' => 47.37, 'lon' => 8.54], 'geneva' => ['lat' => 46.2, 'lon' => 6.14]], JSON_THROW_ON_ERROR));
file_put_contents($directory . '/credentials.env', "GEOPS_API_KEY=private-test-secret\n");
$feature = ['type' => 'Feature', 'id' => 'sbb_123', 'geometry' => ['type' => 'LineString', 'coordinates' => [[950000, 6000000], [950100, 6000100]]],
    'properties' => ['train_id' => 123, 'type' => 'rail', 'line' => ['name' => 'IC1'], 'time_intervals' => [[1000000, 0, null], [1015000, 1, 30]]]];
$route = ['type' => 'FeatureCollection', 'features' => [['type' => 'Feature', 'properties' => [], 'geometry' => ['type' => 'GeometryCollection', 'geometries' => [
    ['type' => 'LineString', 'coordinates' => [[950000, 6000000], [950100, 6000100]]], ['type' => 'MultiPoint', 'coordinates' => [[950000, 6000000]]]]]]]];
$callsFixture = [['destination' => 'Bern', 'stations' => [['stationName' => 'Zürich HB', 'coordinate' => [950000, 6000000], 'departureTime' => '2026-10-14T10:03:00Z', 'aimedDepartureTime' => '2026-10-14T10:00:00Z']]]];
$requests = [];
$fetch = function (string $key, string $endpoint) use (&$requests, $feature, $route, $callsFixture): string {
    trainCheck($key === 'private-test-secret', 'Load credentials privately');
    trainCheck(!str_contains($endpoint, $key), 'Injected endpoint must not contain credential');
    $requests[] = $endpoint;
    if (str_starts_with($endpoint, 'trajectories/')) {
        return json_encode(['type' => 'FeatureCollection', 'features' => str_contains($endpoint, implode(',', trainCoverage('geneva'))) ? [] : [$feature]], JSON_THROW_ON_ERROR);
    }
    return json_encode(str_starts_with($endpoint, 'journeys/') ? $route : $callsFixture, JSON_THROW_ON_ERROR);
};
$now = 1800000000;
try {
    $tram = array_replace_recursive($feature, ['properties' => ['type' => 'tram']]);
    $ferry = array_replace_recursive($feature, ['properties' => ['type' => 'ferry']]);
    trainCheck(trainFeatures(['type' => 'FeatureCollection', 'features' => [$ferry, $tram]]) === [$tram], 'Mixed upstream modes retain tram and omit ferry');
    foreach ([[], [[0, 0, null]], [[1000, 0, null], [999, 1, null]], [[INF, 0, null]], [[1000, NAN, null]], [[1000, 0, INF]]] as $intervals) {
        $bad = $tram;
        $bad['properties']['time_intervals'] = $intervals;
        trainReject(fn() => trainFeatures(['type' => 'FeatureCollection', 'features' => [$ferry, $bad]]));
    }
    $point = $tram;
    $point['geometry'] = ['type' => 'Point', 'coordinates' => [950000, 6000000]];
    $point['properties']['time_intervals'] = [];
    trainCheck(trainFeatures(['type' => 'FeatureCollection', 'features' => [$point]]) === [$point], 'Stationary points may have no intervals');
    $first = trainRequest(['city' => 'zurich'], $fetch, $now);
    trainCheck($first['city'] === 'zurich' && $first['features'] === [$feature] && count($first['coverage']) === 4, 'Expose REST feed and fixed coverage');
    trainCheck(trainRequest(['city' => 'zurich'], $fetch, $now + 14) === $first && count($requests) === 1, 'Visitors share a fresh cache');
    $failures = 0;
    $failure = function () use (&$failures): string { $failures++; throw new RuntimeException('https://upstream/?key=private-test-secret'); };
    trainCheck(trainRequest(['city' => 'zurich'], $failure, $now + 15) === $first, 'Preserve last good data and fetchedAt on transport failure');
    trainCheck(trainRequest(['city' => 'zurich'], $failure, $now + 16) === $first && $failures === 1, 'Bound outage attempts with shared retry backoff');
    $invalid = function () use (&$failures): string { $failures++; return '{"type":"FeatureCollection","features":[{"type":"Feature"}]}'; };
    trainCheck(trainRequest(['city' => 'zurich'], $invalid, $now + 30) === $first, 'Invalid upstream data cannot replace good cache');
    trainCheck(trainRequest(['city' => 'zurich'], $invalid, $now + 31) === $first && $failures === 2, 'Invalid responses also back off');
    $fresh = trainRequest(['city' => 'zurich'], $fetch, $now + 45);
    trainCheck($fresh['fetchedAt'] !== $first['fetchedAt'], 'Successful refresh advances timestamp');
    $trip = trainRequest(['city' => 'zurich', 'vehicle' => 'sbb_123'], $fetch, $now + 45);
    trainCheck($trip['route'] === $route && $trip['calls'] === $callsFixture && $trip['vehicleId'] === 'sbb_123', 'Fetch and combine journeys and calls');
    $before = count($requests);
    trainCheck(trainRequest(['city' => 'zurich', 'vehicle' => 'sbb_123'], $fetch, $now + 46) === $trip && count($requests) === $before, 'Details share a fresh cache');
    trainRequest(['city' => 'geneva'], $fetch, $now + 45);
    $before = count($requests);
    trainReject(fn() => trainRequest(['city' => 'geneva', 'vehicle' => 'sbb_123'], $fetch, $now + 46), 404);
    trainCheck(count($requests) === $before, 'Cross-city access must not fetch route details, even with another city cached');
    $detailCalls = 0;
    $partial = function (string $key, string $endpoint) use (&$detailCalls, $fetch): string {
        if (str_starts_with($endpoint, 'calls/')) { $detailCalls++; return '[{"stations":[{"stationName":"Bad","coordinate":["invalid",0]}]}]'; }
        return $fetch($key, $endpoint);
    };
    trainCheck(trainRequest(['city' => 'zurich', 'vehicle' => 'sbb_123'], $partial, $now + 60) === $trip, 'Malformed calls cannot commit a partial trip');
    trainCheck(trainRequest(['city' => 'zurich', 'vehicle' => 'sbb_123'], $partial, $now + 61) === $trip && $detailCalls === 1, 'Failed detail refresh preserves timestamp and backs off');
    foreach ([[], ['city' => ['zurich']], ['city' => '../zurich'], ['city' => 'zurich', 'vehicle' => []], ['city' => 'zurich', 'vehicle' => 'sbb_1/../../'], ['city' => 'zurich', 'bbox' => 'arbitrary']] as $query) {
        trainReject(fn() => trainRequest($query, $fetch, $now), 400);
    }
    trainReject(fn() => trainRequest(['city' => 'unknown'], $fetch, $now), 404);
    trainReject(fn() => trainFeatures(['type' => 'FeatureCollection', 'features' => [$feature + ['bad' => true], ['type' => 'Feature', 'geometry' => null, 'properties' => []]]]));
    trainReject(fn() => trainJson(str_repeat('x', TRAIN_BODY_LIMIT + 1)));
    unlink($directory . '/credentials.env');
    trainReject(fn() => trainRequest(['city' => 'geneva', 'vehicle' => 'sbb_456'], $fetch, $now + 90));
    $noCredentialCalls = 0;
    $never = function () use (&$noCredentialCalls): string { $noCredentialCalls++; return ''; };
    unlink($directory . '/geops/geneva.json');
    trainReject(fn() => trainRequest(['city' => 'geneva'], $never, $now + 106));
    trainCheck($noCredentialCalls === 0, 'Missing credentials must never call upstream');
    putenv('GEOPS_API_KEY=private-test-secret');
    $leak = fn() => json_encode(['type' => 'FeatureCollection', 'features' => [array_replace_recursive($feature, ['properties' => ['secret' => 'private-test-secret']])]], JSON_THROW_ON_ERROR);
    trainReject(fn() => trainRequest(['city' => 'geneva'], $leak, $now + 121));
    trainCheck(!is_file($directory . '/geops/geneva.json'), 'Never cache an echoed credential');
} finally {
    trainRemove($directory);
    foreach ($environment as $name => $value) putenv($value === false ? $name : $name . '=' . $value);
}
echo "Verified transit cache, stale preservation, backoff, trust boundaries and city-bound details\n";
