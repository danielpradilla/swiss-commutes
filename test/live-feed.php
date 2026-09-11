<?php
declare(strict_types=1);
require __DIR__ . '/../public/live/feed.php';
require __DIR__ . '/../public/live/replay.php';

function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

// Small DATEX II fixture: namespace handling, source units, missing data and quality flags.
$spec = '';
foreach ([11 => ['trafficFlow', 'car'], 12 => ['trafficSpeed', 'car'], 21 => ['trafficFlow', 'lorry'], 22 => ['trafficSpeed', 'lorry'], 1 => ['trafficFlow', 'anyVehicle']] as $i => [$type, $vehicle]) {
    $spec .= '<measurementSpecificCharacteristics index="' . $i . '"><measurementSpecificCharacteristics><period>60</period><specificMeasurementValueType>' . $type . '</specificMeasurementValueType><specificVehicleCharacteristics><vehicleType>' . $vehicle . '</vehicleType></specificVehicleCharacteristics></measurementSpecificCharacteristics></measurementSpecificCharacteristics>';
}
$static = '<root xmlns="http://datex2.eu/schema/2/2_0"><measurementSiteTable version="3"><measurementSiteRecord id="ZH.CH:TEST.01" version="1">' . $spec . '<measurementSiteLocation><latitude>47.3</latitude><longitude>8.5</longitude></measurementSiteLocation></measurementSiteRecord></measurementSiteTable></root>';
$dynamic = '<root xmlns="http://datex2.eu/schema/2/2_0"><informationStatus>real</informationStatus><publicationTime>2026-09-10T14:31:18Z</publicationTime><measurementSiteTableReference version="3"/><siteMeasurements><measurementSiteReference id="ZH.CH:TEST.01" version="1"/><measurementTimeDefault>2026-09-10T14:30:00Z</measurementTimeDefault><measuredValue index="11"><measuredValue><basicData><vehicleFlow><vehicleFlowRate>1200</vehicleFlowRate></vehicleFlow></basicData></measuredValue></measuredValue><measuredValue index="12"><measuredValue><basicData><averageVehicleSpeed numberOfInputValuesUsed="20"><speed>76.5</speed></averageVehicleSpeed></basicData></measuredValue></measuredValue><measuredValue index="21"><vehicleFlowRate>0</vehicleFlowRate></measuredValue><measuredValue index="1"><vehicleFlowRate>600</vehicleFlowRate></measuredValue></siteMeasurements></root>';
$table = trafficSites($static);
$extract = fn($body, $metadata = null) => trafficReadings($body, $metadata ?? $table)['stations'][0]['detectors'][0]['reading'];
$reading = $extract($dynamic);
$offline = preg_replace('/<measuredValue index="11">.*<\/siteMeasurements>/', '<measuredValue index="0"><dataError>true</dataError><reasonForDataError><values><value lang="en">VD_OFFLINE</value></values></reasonForDataError></measuredValue></siteMeasurements>', $dynamic);
check($extract($offline)['error'] === 'VD_OFFLINE' && $extract($offline)['light'] === null, 'Preserve source-wide offline flags without inventing a zero count');
check($extract(str_replace('VD_OFFLINE', 'SENSOR_ERROR', $offline))['error'] === 'SENSOR_ERROR', 'Distinguish offline detectors from broken sensors');
check(trafficExpectedMinute(strtotime('2026-09-10T14:31:19Z')) === strtotime('2026-09-10T14:29:00Z') &&
    trafficExpectedMinute(strtotime('2026-09-10T14:31:20Z')) === strtotime('2026-09-10T14:30:00Z'), 'Use the source publication boundary');
check($extract($dynamic, json_decode(json_encode($table), true)) === $reading, 'Cached metadata must give the same readings as freshly parsed XML');
check($reading['light'] === 20 && $reading['heavy'] === 0, 'Convert the measured hourly rate to its one-minute count, excluding error category 1');
check($reading['lightSpeed'] === 76.5 && $reading['heavySpeed'] === null, 'Keep observed average speeds and missing values');
check($reading['at'] === '2026-09-10T14:30:00Z', 'Keep the observation time, not the fetch time');
check($extract(str_replace('<vehicleFlowRate>1200', '<dataError><reasonForDataError>bad detector</reasonForDataError></dataError><vehicleFlowRate>1200', $dynamic))['light'] === null, 'Exclude invalid measurements');
check($extract(str_replace('<basicData>', '<basicData forecast="true">', $dynamic))['light'] === null, 'Exclude forecasts');
check($extract(str_replace('>1200<', '>-60<', $dynamic))['light'] === null, 'Exclude negative counts');
check($extract(str_replace('>1200<', '>1234<', $dynamic))['light'] === null, 'Do not round a non-integer count into an observation');
check($extract(str_replace('>1200<', '>0<', $dynamic))['lightSpeed'] === null, 'No speed when no vehicles were counted');
check($extract($dynamic, trafficSites(str_replace('<period>60', '<period>300', $static)))['light'] === null, 'Never label a five-minute record as a one-minute count');
foreach ([str_replace('>real<', '>test<', $dynamic), str_replace('version="3"', 'version="4"', $dynamic), '<!DOCTYPE root><root/>'] as $invalid) {
    $rejected = false;
    try { $extract($invalid); } catch (RuntimeException) { $rejected = true; }
    check($rejected, 'Reject test data, metadata mismatches and DTDs');
}
$private = sys_get_temp_dir() . '/swiss-live-history-' . bin2hex(random_bytes(6));
mkdir($private, 0700);
$previousPrivate = getenv('SWISS_LIVE_PRIVATE_DIR');
try {
    $now = strtotime('2026-09-10T15:30:00Z');
    $feed = trafficReadings($dynamic, $table);
    $edge = $now - LIVE_HISTORY_SECONDS;
    foreach ([$edge - 1, $edge] as $at) trafficWrite($private . '/history-' . $at . '.json', '{}');
    foreach (['expired' => $edge - 1, 'recent' => $now - 60, 'future' => $now + 60] as $id => $at) {
        $feed['stations'][0]['detectors'][] = ['id' => $id, 'reading' => array_replace($reading, ['at' => gmdate('Y-m-d\TH:i:s\Z', $at)])];
    }
    $kept = trafficHistory($private, $feed, $now);
    check(!is_file($private . '/history-' . ($edge - 1) . '.json'), 'Delete readings older than 60 minutes');
    check($kept['stations'][0]['detectors'][0]['reading'] === $reading, 'Retain readings exactly 60 minutes old');
    check($kept['stations'][0]['detectors'][1]['reading'] === null && $kept['stations'][0]['detectors'][3]['reading'] === null, 'Remove expired and future readings from the feed cache too');
    $path = $private . '/history-' . $edge . '.json';
    $saved = file_get_contents($path);
    trafficHistory($private, $feed, $now);
    check(file_get_contents($path) === $saved && count(glob($private . '/history-*.json')) === 2, 'Repeated queries must not duplicate readings');
    $feed['stations'][0]['detectors'][0]['reading']['light'] = 21;
    trafficHistory($private, $feed, $now);
    check(json_decode(file_get_contents($path), true)['ZH.CH:TEST.01']['light'] === 21, 'Source corrections replace the same detector and observation');

    $end = intdiv($now, 60) * 60 - 60;
    $start = $end - 29 * 60;
    $feed['fetchedAt'] = gmdate('Y-m-d\TH:i:s\Z', $now);
    $feed['stations'][0]['detectors'][0]['reading'] = array_replace($reading, ['at' => gmdate('Y-m-d\TH:i:s\Z', $end)]);
    trafficWrite($private . '/feed.json', json_encode($feed));
    foreach ([$start => 7, $start + 120 => 0] as $at => $count) {
        trafficWrite($private . '/history-' . $at . '.json', json_encode([
            'ZH.CH:TEST.01' => array_replace($reading, ['at' => gmdate('Y-m-d\TH:i:s\Z', $at), 'light' => $count]),
            'unknown' => array_replace($reading, ['at' => gmdate('Y-m-d\TH:i:s\Z', $at)]),
        ]));
    }
    $replay = trafficReplay($private, $now);
    check(count($replay['frames']) === 30 && strtotime($replay['frames'][0]['at']) === $start && strtotime($replay['frames'][29]['at']) === $end, 'Replay covers exactly the last 30 completed minutes in order');
    check($replay['frames'][0]['readings']->{'ZH.CH:TEST.01'}[0] === 7 && !isset($replay['frames'][0]['readings']->unknown), 'Keep measured counts and exclude unknown detectors');
    check(count((array)$replay['frames'][1]['readings']) === 0 && $replay['frames'][2]['readings']->{'ZH.CH:TEST.01'}[0] === 0, 'Missing minutes stay empty; measured zero stays zero');
    check(!$replay['frames'][1]['collected'] && $replay['frames'][2]['collected'], 'Distinguish a missing collection from a measured zero');
    trafficWrite($private . '/history-' . ($start + 180) . '.json', json_encode([
        'ZH.CH:TEST.01' => array_replace($extract($offline), ['at' => gmdate('Y-m-d\TH:i:s\Z', $start + 180)]),
    ]));
    $flagged = trafficReplay($private, $now)['frames'][3];
    check($flagged['collected'] && count((array)$flagged['readings']) === 0 && $flagged['errors']->{'ZH.CH:TEST.01'} === 'VD_OFFLINE', 'Source errors belong to their recorded minute even when no counts are available');
    check($replay['stations'][0]['detectors'][0]['reading'] === null, 'Do not leak the latest reading into historical frames');
    trafficWrite($private . '/history-' . ($edge - 1) . '.json', '{}');
    trafficReplay($private, $now);
    check(!is_file($private . '/history-' . ($edge - 1) . '.json'), 'Replay queries also prune expired history');

    trafficWrite($private . '/sites.json', json_encode($table));
    $target = trafficExpectedMinute(time());
    $liveDynamic = str_replace('2026-09-10T14:30:00Z', gmdate('Y-m-d\TH:i:s\Z', $target), $dynamic);
    foreach (['http', 'empty', 'stale', 'duplicate'] as $failure) {
        $calls = 0; $delays = [];
        $collected = trafficCollect($private, 'test-key-do-not-log', function () use (&$calls, $failure, $liveDynamic, $dynamic, $target) {
            $calls++;
            if ($calls === 1) {
                if ($failure === 'http') throw new RuntimeException('Source unavailable');
                if ($failure === 'duplicate') return str_replace('2026-09-10T14:30:00Z', gmdate('Y-m-d\TH:i:s\Z', $target - 60), $dynamic);
                return $failure === 'empty' ? '<root/>' : str_replace('2026-09-10T14:30:00Z', '2000-01-01T00:00:00Z', $dynamic);
            }
            return $liveDynamic;
        }, function ($seconds) use (&$delays) { $delays[] = $seconds; }, $target);
        check($calls === 2 && $delays === [5] && strtotime($collected['stations'][0]['detectors'][0]['reading']['at']) === $target, 'Retry failed, empty, stale and duplicate source data after five seconds');
    }
    $calls = 0; $rejected = false;
    try {
        trafficCollect($private, 'test', function () use (&$calls) { $calls++; throw new RuntimeException('Still unavailable'); }, fn($seconds) => null);
    } catch (RuntimeException) { $rejected = true; }
    check($rejected && $calls === 2, 'Stop after the immediate retry; the next scheduled minute tries again');
    trafficWrite($private . '/feed.json', json_encode($collected));
    $calls = 0; $rejected = false;
    try {
        trafficCollect($private, 'test', function () use (&$calls, $liveDynamic) { $calls++; return $liveDynamic; }, fn($seconds) => null, $target);
    } catch (RuntimeException) { $rejected = true; }
    check($rejected && $calls === 2, 'Receiving the same recorded minute again must not count as advancement');
    $log = file_get_contents($private . '/collection.log');
    check(str_contains($log, '"outcome":"retry"') && str_contains($log, '"outcome":"success"') && str_contains($log, '"outcome":"failed"') && !str_contains($log, 'test-key-do-not-log'), 'Log outcomes and timing without the API key');
    for ($i = 0; $i < 205; $i++) trafficLog($private, ['outcome' => 'test', 'attempt' => $i]);
    check(count(file($private . '/collection.log')) === 200, 'Keep the diagnostic log bounded');

    // Exercise the real request paths without making upstream API calls.
    putenv('SWISS_LIVE_PRIVATE_DIR=' . $private);
    $now = time();
    $feed['fetchedAt'] = gmdate('Y-m-d\TH:i:s\Z', $now);
    $feed['stations'][0]['detectors'][0]['reading']['at'] = gmdate('Y-m-d\TH:i:s\Z', trafficExpectedMinute($now));
    $feed['stations'][0]['detectors'][1]['reading']['at'] = gmdate('Y-m-d\TH:i:s\Z', $now - 3601);
    $expired = $private . '/history-' . ($now - 3601) . '.json';
    trafficWrite($expired, '{}');
    trafficWrite($private . '/feed.json', json_encode($feed));
    ob_start(); serveTraffic(); $response = json_decode(ob_get_clean(), true);
    check(!is_file($expired) && $response['stations'][0]['detectors'][1]['reading'] === null, 'Cache hits still expire history and cached readings');
    check(json_decode(file_get_contents($private . '/feed.json'), true)['stations'][0]['detectors'][1]['reading'] === null, 'Remove expired readings from disk, not only the response');
    $feed['stations'][0]['detectors'][0]['reading']['at'] = gmdate('Y-m-d\TH:i:s\Z', trafficExpectedMinute($now) - 60);
    trafficWrite($private . '/feed.json', json_encode($feed));
    trafficWrite($expired, '{}');
    touch($private . '/attempt');
    ob_start(); serveTraffic(); $response = json_decode(ob_get_clean(), true);
    check(http_response_code() === 503 && isset($response['error']) && !is_file($expired), 'Failed queries still prune; a recent fetch must not make duplicate observations current');
} finally {
    putenv($previousPrivate === false ? 'SWISS_LIVE_PRIVATE_DIR' : 'SWISS_LIVE_PRIVATE_DIR=' . $previousPrivate);
    foreach (glob($private . '/*') as $file) unlink($file);
    rmdir($private);
}
echo "Verified live traffic parsing, units, quality flags, versions, retention and 30-minute replay\n";
