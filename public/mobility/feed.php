<?php
declare(strict_types=1);

// The upstream GBFS 2.0 responses emit duplicate Access-Control-Allow-Origin headers.
// Serve the documented public feeds on the same origin and reuse each file for one minute.
$path = $_GET['path'] ?? '';
if (!is_string($path) || !preg_match('~^(?:vehicle_types|free_bike_status|station_information|station_status)\.json$|^v2/gbfs/[a-zA-Z0-9_.-]+/station_status$~D', $path)) {
    http_response_code(400);
    exit('Invalid feed path');
}
$private = getenv('SWISS_MOBILITY_CACHE_DIR') ?: sys_get_temp_dir() . '/swiss-commutes-mobility';
if (!is_dir($private) && !mkdir($private, 0700, true) && !is_dir($private)) {
    http_response_code(503);
    exit('Cache unavailable');
}
$name = hash('sha256', $path);
$cache = $private . '/' . $name . '.json';
$lock = fopen($private . '/' . $name . '.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX)) {
    http_response_code(503);
    exit('Cache unavailable');
}
$valid = is_file($cache) && filesize($cache) > 0;
if (!$valid || time() - filemtime($cache) >= 60) {
    $url = 'https://sharedmobility.ch/' . $path;
    $headers = str_starts_with($path, 'v2/') ? ['Authorization: gbfs@sharedmobility.ch'] : [];
    $request = curl_init($url);
    curl_setopt_array($request, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 15,
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_ENCODING => '', CURLOPT_USERAGENT => 'Swiss Commutes shared mobility feed']);
    $body = curl_exec($request);
    $code = curl_getinfo($request, CURLINFO_HTTP_CODE);
    $validJson = is_string($body) && (function_exists('json_validate') ? json_validate($body) : (json_decode($body) !== null && json_last_error() === JSON_ERROR_NONE));
    if ($validJson && $code === 200 && strlen($body) < 20_000_000) {
        $candidate = tempnam($private, 'feed-');
        if ($candidate !== false && file_put_contents($candidate, $body) === strlen($body)) {
            chmod($candidate, 0600);
            rename($candidate, $cache);
            $valid = true;
        } elseif ($candidate !== false) {
            unlink($candidate);
        }
    }
}
if (!$valid) {
    flock($lock, LOCK_UN);
    fclose($lock);
    http_response_code(503);
    exit('Upstream feed unavailable');
}
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=30');
readfile($cache);
flock($lock, LOCK_UN);
fclose($lock);
