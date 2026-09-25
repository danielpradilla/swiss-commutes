<?php
declare(strict_types=1);

// ASTRA DATEX II: measured vehicle flow and speed, never routed commuter estimates.
const LIVE_SOURCE = 'https://api.opentransportdata.swiss/TDP/Soap_Datex2/Pull';
const LIVE_ERRORS = ['EMPTY_RESPONSE', 'PRV_OFFLINE', 'AGG_OFFLINE', 'VD_OFFLINE', 'VD_ERROR', 'SENSOR_ERROR', 'SENSOR_WWD', 'INVALID'];

// Keys and 60-minute history belong outside the published directory. Apache sets this from
// live/.htaccess for web requests; the collector cron entry sets it for CLI. The in-directory
// fallback stays for a fresh checkout and is denied by live/.private/.htaccess.
function trafficPrivate(): string {
    $configured = getenv('SWISS_LIVE_PRIVATE_DIR');
    return $configured !== false && $configured !== '' ? $configured : __DIR__ . '/.private';
}

function trafficXml(string $body): SimpleXMLElement {
    if (stripos($body, '<!DOCTYPE') !== false) throw new RuntimeException('Unexpected XML document type');
    libxml_use_internal_errors(true);
    $xml = simplexml_load_string($body, SimpleXMLElement::class, LIBXML_NONET);
    if ($xml === false || $xml->xpath('//*[local-name()="Fault"]')) throw new RuntimeException('Invalid traffic response');
    return $xml;
}

function trafficText(SimpleXMLElement $node, string $path): string {
    return trim((string)(($node->xpath($path) ?: [])[0] ?? ''));
}

function trafficField(SimpleXMLElement $node, string $field): string {
    return trafficText($node, './/*[local-name()="' . $field . '"]');
}

function trafficNumber(string $value): ?float {
    return is_numeric($value) && is_finite((float)$value) && (float)$value >= 0 ? (float)$value : null;
}

function trafficSites(string $body): array {
    $xml = trafficXml($body);
    $table = ($xml->xpath('//*[local-name()="measurementSiteTable"]') ?: [])[0] ?? null;
    if ($table === null) throw new RuntimeException('Missing counter table');
    $sites = [];
    foreach ($table->xpath('./*[local-name()="measurementSiteRecord"]') as $site) {
        $lat = trafficNumber(trafficField($site, 'latitude'));
        $lon = trafficNumber(trafficField($site, 'longitude'));
        if ($lat === null || $lon === null || $lat > 90 || $lon > 180) continue;
        $id = (string)$site['id'];
        $characteristics = [];
        foreach ($site->xpath('./*[local-name()="measurementSpecificCharacteristics"][@index]') as $value) {
            $characteristics[(int)$value['index']] = [
                'period' => trafficNumber(trafficField($value, 'period')),
                'type' => trafficField($value, 'specificMeasurementValueType'),
                'vehicle' => trafficField($value, 'vehicleType'),
            ];
        }
        $sites[$id] = [
            'id' => $id, 'station' => preg_replace('/\.[^.]+$/', '', $id),
            'version' => (string)$site['version'], 'lat' => $lat, 'lon' => $lon,
            'lane' => trafficField($site, 'lane'), 'direction' => trafficField($site, 'alertCDirectionCoded'),
            'characteristics' => $characteristics,
        ];
    }
    if (!$sites) throw new RuntimeException('Empty counter table');
    return ['version' => (string)$table['version'], 'sites' => $sites];
}

function trafficReadings(string $body, array $table): array {
    $xml = trafficXml($body);
    if (trafficField($xml, 'informationStatus') !== 'real') throw new RuntimeException('Feed is not marked real');
    $reference = ($xml->xpath('//*[local-name()="measurementSiteTableReference"]') ?: [])[0] ?? null;
    if ($reference === null || (string)$reference['version'] !== $table['version']) throw new RuntimeException('Counter table version changed');
    $readings = [];
    foreach ($xml->xpath('//*[local-name()="siteMeasurements"]') as $measurement) {
        $ref = ($measurement->xpath('./*[local-name()="measurementSiteReference"]') ?: [])[0] ?? null;
        $id = (string)($ref['id'] ?? '');
        $site = $table['sites'][$id] ?? null;
        if (!$site || (string)$ref['version'] !== $site['version']) continue;
        $at = strtotime(trafficField($measurement, 'measurementTimeDefault'));
        if ($at === false) continue;
        $values = [];
        foreach ($measurement->xpath('./*[local-name()="measuredValue"][@index]') as $value) {
            $index = (int)$value['index'];
            $spec = $site['characteristics'][$index] ?? null;
            // 1/2 are error categories in this profile, not total flow/speed.
            if (!$spec || !in_array($index, [11, 12, 21, 22], true) || (float)$spec['period'] !== 60.0) continue;
            if ($value->xpath('.//*[local-name()="dataError" or local-name()="reasonForDataError"]') ||
                $value->xpath('.//*[@dataError="true" or @dataError="1" or @forecast="true" or @forecast="1"]')) continue;
            $override = trafficField($value, 'measurementOrCalculationTime');
            if ($override !== '' && strtotime($override) !== $at) continue;
            $isFlow = in_array($index, [11, 21], true);
            if ($spec['type'] !== ($isFlow ? 'trafficFlow' : 'trafficSpeed') ||
                $spec['vehicle'] !== ($index < 20 ? 'car' : 'lorry')) continue;
            $number = trafficNumber(trafficField($value, $isFlow ? 'vehicleFlowRate' : 'speed'));
            if ($number === null) continue;
            if ($isFlow) {
                // DATEX expresses the measured one-minute count as an hourly rate.
                $count = $number / 60;
                if (abs($count - round($count)) > 0.001) continue;
                $values[$index] = (int)round($count);
            } else {
                $samples = trafficText($value, './/*[local-name()="averageVehicleSpeed"]/@numberOfInputValuesUsed');
                if ($samples === '' || (int)$samples <= 0) continue;
                $values[$index] = round($number, 1);
            }
        }
        $error = null;
        if (!isset($values[11], $values[21])) {
            $error = 'INVALID';
            foreach ($measurement->xpath('.//*[local-name()="reasonForDataError"]//*[local-name()="value"]') as $reason) {
                if (in_array((string)$reason, LIVE_ERRORS, true)) { $error = (string)$reason; break; }
            }
        }
        $readings[$id] = ['at' => gmdate('Y-m-d\TH:i:s\Z', $at), 'error' => $error,
            'light' => $values[11] ?? null, 'heavy' => $values[21] ?? null,
            'lightSpeed' => isset($values[11]) && $values[11] > 0 ? ($values[12] ?? null) : null,
            'heavySpeed' => isset($values[21]) && $values[21] > 0 ? ($values[22] ?? null) : null];
    }
    if (!$readings) throw new RuntimeException('Empty measurement response');
    $names = is_file(__DIR__ . '/station-names.json')
        ? json_decode(file_get_contents(__DIR__ . '/station-names.json'), true)['stations'] : [];
    $stations = [];
    foreach ($table['sites'] as $id => $site) {
        $station = $site['station'];
        if (!isset($stations[$station])) $stations[$station] = [
            'id' => $station, 'lat' => $site['lat'], 'lon' => $site['lon'], 'detectors' => [],
        ];
        $name = $names[$station] ?? null;
        if ($name && abs($name['lat'] - $site['lat']) < .02 && abs($name['lon'] - $site['lon']) < .02) {
            $stations[$station]['name'] = $name['name'];
            $stations[$station]['road'] = $name['road'];
        }
        $stations[$station]['detectors'][] = ['id' => $id, 'lane' => $site['lane'],
            'direction' => $site['direction'], 'reading' => $readings[$id] ?? null];
    }
    return ['fetchedAt' => gmdate('Y-m-d\TH:i:s\Z'), 'publishedAt' => trafficField($xml, 'publicationTime'),
        'intervalSeconds' => 60, 'source' => 'ASTRA / FEDRO', 'stations' => array_values($stations)];
}

function trafficFetch(string $operation, string $key): string {
    $body = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><d2LogicalModel xmlns="http://datex2.eu/schema/2/2_0" modelBaseVersion="2"><exchange><supplierIdentification><country>ch</country><nationalIdentifier>SwissCommutesLive</nationalIdentifier></supplierIdentification></exchange></d2LogicalModel></s:Body></s:Envelope>';
    $curl = curl_init(LIVE_SOURCE);
    curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body,
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10,
        CURLOPT_ENCODING => 'gzip', CURLOPT_HTTPHEADER => ['Content-Type: text/xml',
            'Authorization: ' . (str_starts_with($key, 'Bearer ') ? $key : 'Bearer ' . $key),
            'User-Agent: SwissCommutesLive/1.0',
            'SOAPAction: http://opentransportdata.swiss/TDP/Soap_Datex2/Pull/v1/' . $operation]]);
    $data = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    if ($data === false || $status !== 200) throw new RuntimeException('Traffic source HTTP ' . $status . ' (cURL ' . curl_errno($curl) . ')');
    if (strlen($data) > 32 * 1024 * 1024) throw new RuntimeException('Traffic response too large');
    return $data;
}

function trafficWrite(string $path, string $content): void {
    $temp = $path . '.tmp';
    if (file_put_contents($temp, $content) === false || !rename($temp, $path)) throw new RuntimeException('Cannot save traffic cache');
}

// The cache holds the last minute we collected readings for. Reads never expire or rewrite it, and a
// failed collection keeps it, so the map always has the newest minute the source published to us.
function trafficCachedFeed(string $private): ?array {
    $path = $private . '/feed.json';
    if (!is_file($path)) return null;
    try {
        $feed = json_decode(file_get_contents($path) ?: '', true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return null; // An unreadable cache must not stop a fresh collection.
    }
    return is_array($feed) ? $feed : null;
}

// Publication is at :20; before then the preceding publication is still current.
function trafficExpectedMinute(int $now): int {
    return intdiv($now - 20, 60) * 60 - 60;
}

function trafficLatestMinute(?array $feed): int {
    $latest = 0;
    foreach ($feed['stations'] ?? [] as $station) {
        foreach ($station['detectors'] as $detector) {
            $reading = $detector['reading'];
            if (!$reading || ($reading['light'] === null && $reading['heavy'] === null)) continue;
            $at = strtotime($reading['at']);
            if ($at !== false && $at % 60 === 0 && $at <= time()) $latest = max($latest, $at);
        }
    }
    return $latest;
}

function trafficLog(string $private, array $entry): void {
    // A bounded local log is enough for this single collector; no readings or credentials.
    $path = $private . '/collection.log';
    $lines = is_file($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    $lines = array_slice($lines ?: [], -199);
    $lines[] = json_encode(['at' => gmdate('Y-m-d\TH:i:s\Z')] + $entry, JSON_THROW_ON_ERROR);
    try { trafficWrite($path, implode("\n", $lines) . "\n"); }
    catch (RuntimeException) { error_log('Swiss Commutes live: Cannot save collection log'); }
}

function trafficCollect(string $private, string $key, ?callable $fetch = null, ?callable $pause = null, ?int $target = null): array {
    $fetch ??= 'trafficFetch';
    $pause ??= 'sleep';
    $target ??= trafficExpectedMinute(time());
    $previous = is_file($private . '/feed.json')
        ? trafficLatestMinute(json_decode(file_get_contents($private . '/feed.json'), true, 512, JSON_THROW_ON_ERROR)) : 0;
    for ($attempt = 0; $attempt < 2; $attempt++) {
        $started = microtime(true);
        $entry = ['attempt' => $attempt + 1, 'target' => gmdate('Y-m-d\TH:i:s\Z', $target)];
        try {
            $tablePath = $private . '/sites.json';
            $table = is_file($tablePath) && time() - filemtime($tablePath) < 86400
                ? json_decode(file_get_contents($tablePath), true, 512, JSON_THROW_ON_ERROR) : null;
            if (!$table) {
                $table = trafficSites($fetch('pullMeasurementSiteTable', $key));
                trafficWrite($tablePath, json_encode($table, JSON_THROW_ON_ERROR));
            }
            $body = $fetch('pullMeasuredData', $key);
            $xml = trafficXml($body);
            $ref = ($xml->xpath('//*[local-name()="measurementSiteTableReference"]') ?: [])[0] ?? null;
            if ($ref !== null && (string)$ref['version'] !== $table['version']) {
                $table = trafficSites($fetch('pullMeasurementSiteTable', $key));
                trafficWrite($tablePath, json_encode($table, JSON_THROW_ON_ERROR));
            }
            unset($xml);
            $feed = trafficReadings($body, $table);
            $latest = trafficLatestMinute($feed);
            $entry += ['latest' => $latest ? gmdate('Y-m-d\TH:i:s\Z', $latest) : null, 'publishedAt' => $feed['publishedAt']];
            // Never replace the stored minute with an empty or repeated one; the map keeps the last read.
            if ($latest === 0) throw new RuntimeException('Source returned no usable readings');
            if ($latest < $target || $latest <= $previous) throw new RuntimeException('Expected minute not received (duplicate or delayed source)');
            trafficLog($private, $entry + ['outcome' => 'success', 'seconds' => round(microtime(true) - $started, 3)]);
            return $feed;
        } catch (RuntimeException $error) {
            trafficLog($private, $entry + ['outcome' => $attempt === 0 ? 'retry' : 'failed',
                'seconds' => round(microtime(true) - $started, 3), 'error' => substr($error->getMessage(), 0, 200)]);
            if ($attempt === 1) throw $error;
            $pause(5);
        }
    }
    throw new RuntimeException('Traffic collection failed');
}

function serveTraffic(): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { http_response_code(405); echo '{"error":"Use GET"}'; return; }
    $private = trafficPrivate();
    $lock = null;
    $feed = null;
    try {
        $lock = fopen($private . '/feed.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock traffic cache');
        $now = time();
        $cache = $private . '/feed.json';
        $feed = trafficCachedFeed($private);
        if ($feed) {
            // Cache by observation time, never by the time an old response was fetched.
            if (trafficLatestMinute($feed) >= trafficExpectedMinute($now)) {
                echo json_encode($feed, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES); return;
            }
        }
        $attempt = $private . '/attempt';
        if (is_file($attempt) && trafficExpectedMinute(filemtime($attempt)) >= trafficExpectedMinute($now)) throw new RuntimeException('Traffic source retry pending');
        touch($attempt);
        $key = getenv('ASTRA_API_KEY') ?: '';
        foreach ([$private . '/credentials.env', dirname(__DIR__, 2) . '/.env.local'] as $file) {
            if (!$key && is_file($file)) $key = parse_ini_file($file, false, INI_SCANNER_RAW)['ASTRA_API_KEY'] ?? '';
        }
        if (!$key) throw new RuntimeException('Traffic key not configured');
        $feed = trafficCollect($private, $key);
        $json = json_encode($feed, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        trafficWrite($cache, $json);
        unlink($attempt);
        echo $json;
    } catch (Throwable $error) {
        error_log('Swiss Commutes live: ' . $error->getMessage());
        // The last collected minute outranks a failed attempt: keep it on screen while collection recovers.
        if ($feed) { echo json_encode($feed, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES); return; }
        http_response_code(503);
        header('Retry-After: 60');
        echo '{"error":"Live traffic readings are temporarily unavailable."}';
    } finally {
        if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    // Cron can start between minute boundaries. Wait for publication, not a fixed delay after startup.
    if (PHP_SAPI === 'cli') sleep(max(0, 25 - (time() % 60)));
    serveTraffic();
    if (PHP_SAPI === 'cli' && http_response_code() >= 400) exit(1);
}
