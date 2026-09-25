<?php
declare(strict_types=1);

const TRAIN_SOURCE = 'https://api.opentransportdata.swiss/la/gtfs-rt?format=JSON';
const TRAIN_CACHE_SECONDS = 60;
const TRAIN_STALE_SECONDS = 900;

function trainField(array $value, string $name): mixed {
    return $value[$name] ?? $value[ucfirst($name)] ?? null;
}

function trainEventTime(string $date, string $clock): ?DateTimeImmutable {
    if (!preg_match('/^(\d{4})(\d{2})(\d{2})$/', $date, $day) ||
        !preg_match('/^(\d{1,2}):(\d{2}):(\d{2})$/', $clock, $time)) return null;
    $base = DateTimeImmutable::createFromFormat('!Y-m-d', "$day[1]-$day[2]-$day[3]", new DateTimeZone('Europe/Zurich'));
    if (!$base || (int)$time[2] > 59 || (int)$time[3] > 59) return null;
    return $base->modify('+' . ((int)$time[1] * 3600 + (int)$time[2] * 60 + (int)$time[3]) . ' seconds');
}

function trainIso(DateTimeImmutable $time): string {
    return $time->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}

function trainDelay(array $update, string $event): ?int {
    $value = trainField($update, $event);
    $delay = is_array($value) ? trainField($value, 'delay') : null;
    return is_int($delay) || (is_string($delay) && preg_match('/^-?\d+$/', $delay)) ? (int)$delay : null;
}

function trainStation(array $timetable, string $id): array {
    $station = $timetable['stations'][$id] ?? $id;
    if (!is_array($station)) return ['id' => $id, 'name' => (string)$station];
    return ['id' => $id, 'name' => (string)($station['name'] ?? $id),
        'lat' => (float)($station['lat'] ?? 0), 'lon' => (float)($station['lon'] ?? 0)];
}

function trainBuildFeed(array $header, iterable $entities, array $timetable, ?int $now = null): array {
    $version = is_array($header) ? (string)(trainField($header, 'feedVersion') ?? '') : '';
    if ($version === '' || $version !== (string)($timetable['feedVersion'] ?? '')) throw new RuntimeException('Static timetable version does not match realtime feed');
    $published = is_array($header) ? trainField($header, 'timestamp') : null;
    if (!is_numeric($published) || (int)$published <= 0) throw new RuntimeException('Missing train feed timestamp');
    $now ??= time();
    if ($now - (int)$published > TRAIN_STALE_SECONDS) throw new RuntimeException('Train feed has not published an update in over 15 minutes');
    $trains = [];
    foreach ($entities as $entity) {
        if (!is_array($entity) || (bool)(trainField($entity, 'isDeleted') ?? false)) continue;
        $update = trainField($entity, 'tripUpdate');
        $descriptor = is_array($update) ? trainField($update, 'trip') : null;
        if (!is_array($update) || !is_array($descriptor)) continue;
        $tripId = (string)(trainField($descriptor, 'tripId') ?? '');
        $original = (string)(trainField($descriptor, 'originalTripId') ?? '');
        $static = $timetable['trips'][$tripId] ?? $timetable['trips'][$original] ?? null;
        $date = (string)(trainField($descriptor, 'startDate') ?? '');
        if (!is_array($static) || $date === '') continue;
        $updates = [];
        foreach ((array)(trainField($update, 'stopTimeUpdate') ?? []) as $stop) {
            $sequence = is_array($stop) ? trainField($stop, 'stopSequence') : null;
            if (is_numeric($sequence)) $updates[(int)$sequence] = $stop;
        }
        $next = $last = null;
        foreach ($static['s'] ?? [] as $stop) {
            if (!is_array($stop) || count($stop) < 4) continue;
            [$sequence, $stationId, $arrival, $departure] = $stop;
            $event = $departure !== '' ? 'departure' : 'arrival';
            $scheduled = trainEventTime($date, $event === 'departure' ? $departure : $arrival);
            if (!$scheduled) continue;
            $stopUpdate = $updates[(int)$sequence] ?? [];
            $delay = is_array($stopUpdate) ? trainDelay($stopUpdate, $event) : null;
            if ($delay === null && $event === 'departure' && is_array($stopUpdate)) $delay = trainDelay($stopUpdate, 'arrival');
            $estimated = $scheduled->modify(($delay ?? 0) . ' seconds');
            if ($estimated->getTimestamp() < $now) {
                $last = trainStation($timetable, (string)$stationId) + ['departedAt' => trainIso($estimated)];
                continue;
            }
            if ($delay === null) break; // The next stop has no realtime report: omit this train.
            $relationship = strtoupper((string)(trainField($stopUpdate, 'scheduleRelationship') ?? 'SCHEDULED'));
            if ($relationship === 'SKIPPED') continue;
            $next = trainStation($timetable, (string)$stationId) + ['scheduledAt' => trainIso($scheduled), 'estimatedAt' => trainIso($estimated),
                'delayMinutes' => round($delay / 6) / 10, 'event' => $event];
            break;
        }
        if (!$next) continue;
        $trains[] = ['tripId' => $tripId ?: $original, 'trainNumber' => (string)($static['n'] ?? ''),
            'line' => (string)($static['l'] ?? ''), 'lastStation' => $last, 'nextStation' => $next,
            'cancelled' => strtoupper((string)(trainField($descriptor, 'scheduleRelationship') ?? 'SCHEDULED')) === 'CANCELED'];
    }
    usort($trains, fn(array $a, array $b) => $a['nextStation']['estimatedAt'] <=> $b['nextStation']['estimatedAt'] ?: strnatcasecmp($a['trainNumber'], $b['trainNumber']));
    return ['fetchedAt' => gmdate('Y-m-d\TH:i:s\Z'), 'publishedAt' => gmdate('Y-m-d\TH:i:s\Z', (int)$published),
        'feedVersion' => $version, 'trains' => $trains];
}

function trainFeed(string $body, array $timetable, ?int $now = null): array {
    $source = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($source)) throw new RuntimeException('Invalid train response');
    $header = trainField($source, 'header');
    if (!is_array($header)) throw new RuntimeException('Missing train feed header');
    return trainBuildFeed($header, (array)(trainField($source, 'entity') ?? []), $timetable, $now);
}

function trainEntities(string $path): Generator {
    $file = fopen($path, 'rb');
    if (!$file) throw new RuntimeException('Cannot read train source cache');
    $search = $object = '';
    $array = $string = $escaped = false;
    $depth = 0;
    try {
        while (!feof($file)) {
            $chunk = fread($file, 65536);
            if ($chunk === false) throw new RuntimeException('Cannot read train source cache');
            if (!$array) {
                $search .= $chunk;
                if (!preg_match('/"(?:entity|Entity)"\s*:\s*\[/s', $search, $match, PREG_OFFSET_CAPTURE)) {
                    if (strlen($search) > 131072) throw new RuntimeException('Missing train entities');
                    continue;
                }
                $offset = $match[0][1] + strlen($match[0][0]);
                $chunk = substr($search, $offset);
                $search = '';
                $array = true;
            }
            for ($i = 0, $length = strlen($chunk); $i < $length; $i++) {
                $char = $chunk[$i];
                if ($depth === 0) {
                    if ($char === ']') return;
                    if ($char !== '{') continue;
                    $object = '{'; $depth = 1; $string = $escaped = false;
                    continue;
                }
                $object .= $char;
                if ($string) {
                    if ($escaped) $escaped = false;
                    elseif ($char === '\\') $escaped = true;
                    elseif ($char === '"') $string = false;
                    continue;
                }
                if ($char === '"') $string = true;
                elseif ($char === '{') $depth++;
                elseif ($char === '}' && --$depth === 0) {
                    yield json_decode($object, true, 512, JSON_THROW_ON_ERROR);
                    $object = '';
                }
            }
        }
        throw new RuntimeException('Incomplete train entity array');
    } finally {
        fclose($file);
    }
}

function trainFeedFile(string $path, array $timetable, ?int $now = null): array {
    $file = fopen($path, 'rb');
    if (!$file) throw new RuntimeException('Cannot read train source cache');
    $prefix = fread($file, 131072);
    fclose($file);
    if ($prefix === false || !preg_match('/"(?:header|Header)"\s*:\s*(\{[^{}]*\})/s', $prefix, $match)) {
        throw new RuntimeException('Missing train feed header');
    }
    $header = json_decode($match[1], true, 512, JSON_THROW_ON_ERROR);
    return trainBuildFeed($header, trainEntities($path), $timetable, $now);
}

function trainFetch(string $key, string $path): void {
    $file = fopen($path, 'wb');
    if (!$file) throw new RuntimeException('Cannot open train source cache');
    try {
        $curl = curl_init(TRAIN_SOURCE);
        // The body takes about 16 seconds to download from the server and grows through the day, so
        // allow well over the 25-second cap that previously left almost no headroom for a slow run.
        curl_setopt_array($curl, [CURLOPT_FILE => $file, CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 60, CURLOPT_ENCODING => '',
            CURLOPT_HTTPHEADER => ['Authorization: ' . (str_starts_with($key, 'Bearer ') ? $key : 'Bearer ' . $key),
                'Accept: application/json', 'User-Agent: SwissCommutesTrains/1.0']]);
        // Stream to disk: the uncompressed feed exceeds the request memory limit when buffered.
        $ok = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_errno($curl);
    } finally {
        fclose($file);
    }
    if ($ok === false || $status !== 200) throw new RuntimeException('Train source HTTP ' . $status . ' (cURL ' . $error . ')');
    // The body is about 64 MB and grows through the day; the cap only catches a runaway response.
    if (filesize($path) > 256 * 1024 * 1024) throw new RuntimeException('Train response too large');
}

function serveTrains(?string $requestedCity = null, ?callable $fetch = null): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { http_response_code(405); echo '{"error":"Use GET"}'; return; }
    $city = $requestedCity ?? (string)($_GET['city'] ?? 'zurich');
    if (!preg_match('/^[a-z-]+$/', $city)) { http_response_code(400); echo '{"error":"Unknown city"}'; return; }
    $private = getenv('SWISS_TRAINS_PRIVATE_DIR') ?: __DIR__ . '/.private';
    $timetablePath = getenv('SWISS_TRAINS_TIMETABLE_DIR') ?: (is_link($private . '/timetable-current') ? $private . '/timetable-current' : __DIR__ . '/timetable');
    $timetablePath .= '/' . $city . '.json';
    $lock = null;
    try {
        if (!is_file($timetablePath)) throw new RuntimeException('Train timetable not installed');
        if (!is_dir($private) && !mkdir($private, 0700, true)) throw new RuntimeException('Cannot create train cache');
        $timetable = json_decode(file_get_contents($timetablePath), true, 512, JSON_THROW_ON_ERROR);
        $lock = fopen($private . '/feed.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock train cache');
        $sourcePath = $private . '/source.json';
        $retryPath = $private . '/source.retry';
        $refreshDue = !is_file($sourcePath) || time() - filemtime($sourcePath) >= TRAIN_CACHE_SECONDS;
        $retryDue = !is_file($retryPath) || time() - filemtime($retryPath) >= TRAIN_CACHE_SECONDS;
        if ($refreshDue && $retryDue) {
            $candidate = $sourcePath . '.new';
            try {
                $key = getenv('GTFS_RT_API_KEY') ?: '';
                foreach ([$private . '/credentials.env', dirname(__DIR__, 2) . '/.env.local'] as $file) {
                    if (!$key && is_file($file)) $key = parse_ini_file($file, false, INI_SCANNER_RAW)['GTFS_RT_API_KEY'] ?? '';
                }
                if (!$key) throw new RuntimeException('Train API key not configured');
                $fetch ??= 'trainFetch';
                $fetch($key, $candidate);
                $feed = trainFeedFile($candidate, $timetable); // Validate before replacing the last good source.
                if (!rename($candidate, $sourcePath)) throw new RuntimeException('Cannot save train source cache');
                if (is_file($retryPath)) unlink($retryPath);
            } catch (Throwable $refreshError) {
                if (is_file($candidate)) unlink($candidate);
                touch($retryPath);
                if (!is_file($sourcePath)) throw $refreshError;
                error_log('Swiss Commutes trains: refresh failed, serving cached feed: ' . $refreshError->getMessage());
            }
        }
        $feed ??= trainFeedFile($sourcePath, $timetable);
        $feed['fetchedAt'] = gmdate('Y-m-d\TH:i:s\Z', filemtime($sourcePath));
        echo json_encode($feed, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    } catch (Throwable $error) {
        error_log('Swiss Commutes trains: ' . $error->getMessage());
        http_response_code(503);
        header('Retry-After: 60');
        echo '{"error":"Live train updates are temporarily unavailable."}';
    } finally {
        if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    serveTrains();
    if (PHP_SAPI === 'cli' && http_response_code() >= 400) exit(1);
}
