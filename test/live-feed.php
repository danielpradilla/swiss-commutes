<?php
declare(strict_types=1);
require __DIR__ . '/../public/live/feed.php';

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
$private = sys_get_temp_dir() . '/swiss-live-cache-' . bin2hex(random_bytes(6));
mkdir($private, 0700);
$previousPrivate = getenv('SWISS_LIVE_PRIVATE_DIR');
try {
    $now = strtotime('2026-09-10T14:31:20Z');
    $feed = trafficReadings($dynamic, $table);
    $saved = json_encode($feed, JSON_THROW_ON_ERROR);
    trafficWrite($private . '/feed.json', $saved);
    check(trafficCachedFeed($private) === $feed, 'A cached minute is returned exactly as collected');
    check(file_get_contents($private . '/feed.json') === $saved, 'Reading the cache never rewrites or expires it');
    check(trafficCachedFeed($private) !== null, 'An old minute stays available instead of expiring');
    trafficWrite($private . '/feed.json', '{not json');
    check(trafficCachedFeed($private) === null, 'An unreadable cache reads as absent so collection can still recover');
    trafficWrite($private . '/feed.json', $saved);
    check(!glob($private . '/history-*.json'), 'Caching must not write a replay history');

    trafficWrite($private . '/sites.json', json_encode($table));
    $target = trafficExpectedMinute(time());
    $calls = 0; $rejected = false;
    try {
        trafficCollect($private, 'test', function () use (&$calls, $dynamic) {
            $calls++;
            return preg_replace('/<vehicleFlowRate>[^<]*<\/vehicleFlowRate>/', '<vehicleFlowRate>unavailable</vehicleFlowRate>', $dynamic);
        }, fn($seconds) => null, $target);
    } catch (RuntimeException $error) { $rejected = str_contains($error->getMessage(), 'no usable readings'); }
    check($rejected && $calls === 2, 'A publication without usable readings never replaces the stored minute');
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
    // No explicit status is set on success, so compare the body and the absence of an error status.
    $feed['fetchedAt'] = gmdate('Y-m-d\TH:i:s\Z', $now);
    $current = array_replace($reading, ['at' => gmdate('Y-m-d\TH:i:s\Z', trafficExpectedMinute($now))]);
    $feed['stations'][0]['detectors'][0]['reading'] = $current;
    trafficWrite($private . '/feed.json', json_encode($feed));
    ob_start(); serveTraffic(); $response = json_decode(ob_get_clean(), true);
    check(http_response_code() !== 503 && $response['stations'][0]['detectors'][0]['reading'] === $current, 'A current cache is served as collected');

    // A stale cache whose collection already ran this minute keeps the last minute on screen.
    $feed['stations'][0]['detectors'][0]['reading'] = array_replace($current, ['at' => gmdate('Y-m-d\TH:i:s\Z', trafficExpectedMinute($now) - 60)]);
    trafficWrite($private . '/feed.json', json_encode($feed));
    touch($private . '/attempt');
    ob_start(); serveTraffic(); $response = json_decode(ob_get_clean(), true);
    check(http_response_code() !== 503 && $response['stations'][0]['detectors'][0]['reading']['light'] === $reading['light'],
        'A skipped or failed collection still serves the last collected minute');

    // With nothing stored there is nothing to keep, so the endpoint reports unavailability.
    unlink($private . '/feed.json');
    ob_start(); serveTraffic(); $response = json_decode(ob_get_clean(), true);
    check(http_response_code() === 503 && isset($response['error']), 'Without a stored minute the endpoint reports unavailability');
} finally {
    putenv($previousPrivate === false ? 'SWISS_LIVE_PRIVATE_DIR' : 'SWISS_LIVE_PRIVATE_DIR=' . $previousPrivate);
    foreach (glob($private . '/*') as $file) unlink($file);
    rmdir($private);
}
echo "Verified live traffic parsing, units, quality flags, versions, cache retention and collection retries\n";
