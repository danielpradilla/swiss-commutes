<?php
declare(strict_types=1);
require __DIR__ . '/../public/trains/feed.php';

function trainCheck(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

$timetable = ['feedVersion' => '20260916', 'stations' => [
    '8503000:0:1' => ['name' => 'Zürich HB', 'lat' => 47.378, 'lon' => 8.54],
    '8500010:0:2' => ['name' => 'Baden', 'lat' => 47.476, 'lon' => 8.307],
], 'trips' => [
    'trip-1' => ['n' => '515', 'l' => 'IC1', 's' => [[1, '8503000:0:1', '10:00:00', '10:02:00'], [2, '8500010:0:2', '10:17:00', '10:18:00']]],
]];
$source = ['header' => ['timestamp' => 1789804800, 'feedVersion' => '20260916'], 'entity' => [[
    'id' => 'one', 'tripUpdate' => ['trip' => ['tripId' => 'trip-1', 'startDate' => '20260919', 'scheduleRelationship' => 'SCHEDULED'], 'stopTimeUpdate' => [
        ['stopSequence' => 1, 'departure' => ['delay' => 180], 'scheduleRelationship' => 'SCHEDULED'],
        ['stopSequence' => 2, 'arrival' => ['delay' => 180], 'departure' => ['delay' => 180], 'scheduleRelationship' => 'SCHEDULED'],
    ]],
]]];
$feed = trainFeed(json_encode($source, JSON_THROW_ON_ERROR), $timetable, (new DateTimeImmutable('2026-09-19 10:06:00', new DateTimeZone('Europe/Zurich')))->getTimestamp());
$fixture = tempnam(sys_get_temp_dir(), 'train-feed-');
file_put_contents($fixture, json_encode($source, JSON_THROW_ON_ERROR));
trainCheck(trainFeedFile($fixture, $timetable, (new DateTimeImmutable('2026-09-19 10:06:00', new DateTimeZone('Europe/Zurich')))->getTimestamp()) === $feed, 'Streaming and in-memory parsing must agree');
unlink($fixture);
$train = $feed['trains'][0];
trainCheck($train['trainNumber'] === '515' && $train['line'] === 'IC1', 'Use the train number, not the line name');
trainCheck($train['nextStation']['name'] === 'Baden' && $train['nextStation']['event'] === 'departure', 'Choose the next stop not yet departed');
trainCheck($train['nextStation']['delayMinutes'] === 3.0, 'Convert GTFS-RT delay seconds to minutes');
trainCheck($train['nextStation']['scheduledAt'] === '2026-09-19T08:18:00Z' && $train['nextStation']['estimatedAt'] === '2026-09-19T08:21:00Z', 'Apply delay to the static Europe/Zurich timetable');
trainCheck($train['lastStation']['name'] === 'Zürich HB' && $train['lastStation']['departedAt'] === '2026-09-19T08:05:00Z', 'Include the last stop for map interpolation');
trainCheck($train['nextStation']['lat'] === 47.476 && $train['nextStation']['lon'] === 8.307, 'Include station coordinates');

$source['entity'][0]['tripUpdate']['stopTimeUpdate'] = [['stopSequence' => 1, 'departure' => ['delay' => 180]]];
trainCheck(trainFeed(json_encode($source), $timetable, (new DateTimeImmutable('2026-09-19 10:06:00', new DateTimeZone('Europe/Zurich')))->getTimestamp())['trains'] === [], 'Omit a train when its next stop has no realtime report');
$source['header']['feedVersion'] = 'wrong';
$rejected = false;
try { trainFeed(json_encode($source), $timetable); } catch (RuntimeException) { $rejected = true; }
trainCheck($rejected, 'Reject realtime data paired with another static feed version');
trainCheck(trainEventTime('20261025', '25:15:00')?->format('Y-m-d H:i:sP') === '2026-10-26 01:15:00+01:00', 'Support after-midnight GTFS times across daylight saving');

$source['header']['feedVersion'] = '20260916';
$stale = false;
try { trainFeed(json_encode($source), $timetable, time()); } catch (RuntimeException) { $stale = true; }
trainCheck($stale, 'Reject a feed whose header has not published an update in over 15 minutes');

$cache = sys_get_temp_dir() . '/swiss-trains-' . bin2hex(random_bytes(6));
mkdir($cache . '/private', 0700, true);
mkdir($cache . '/timetable', 0700, true);
$source['header']['feedVersion'] = '20260916';
$source['header']['timestamp'] = time() - 120;
file_put_contents($cache . '/private/credentials.env', "GTFS_RT_API_KEY=test\n");
file_put_contents($cache . '/private/source.json', json_encode($source, JSON_THROW_ON_ERROR));
file_put_contents($cache . '/timetable/zurich.json', json_encode($timetable, JSON_THROW_ON_ERROR));
touch($cache . '/private/source.json', time() - 120);
putenv('SWISS_TRAINS_PRIVATE_DIR=' . $cache . '/private');
putenv('SWISS_TRAINS_TIMETABLE_DIR=' . $cache . '/timetable');
$calls = 0;
$failure = function (string $key, string $path) use (&$calls): void { $calls++; throw new RuntimeException('rate limited'); };
ob_start(); serveTrains('zurich', $failure); $cached = json_decode(ob_get_clean(), true, 512, JSON_THROW_ON_ERROR);
ob_start(); serveTrains('zurich', $failure); ob_end_clean();
trainCheck($cached['feedVersion'] === '20260916', 'Serve the last valid feed when refresh fails');
trainCheck($calls === 1 && is_file($cache . '/private/source.retry'), 'Back off upstream refreshes for one minute after failure');

// A page load must read a stored per-city feed instead of parsing the nationwide source.
$stored = ['fetchedAt' => '2026-09-19T10:06:00Z', 'publishedAt' => '2026-09-19T10:05:00Z', 'feedVersion' => '20260916', 'trains' => [$train]];
trainStoreFeed($cache . '/private', 'lausanne', $stored);
file_put_contents($cache . '/timetable/lausanne.json', json_encode($timetable, JSON_THROW_ON_ERROR));
$calls = 0;
$never = function (string $key, string $path) use (&$calls): void { $calls++; throw new RuntimeException('must not fetch'); };
ob_start(); serveTrains('lausanne', $never); $served = json_decode(ob_get_clean(), true, 512, JSON_THROW_ON_ERROR);
trainCheck($served === $stored && $calls === 0, 'Serve the stored city feed without touching the source or the timetable');

// The cron collector rebuilds the cities requested within the activity window, one build each.
// The failure above left a retry marker; a fresh minute is due again once it clears.
unlink($cache . '/private/source.retry');
touch($cache . '/private/source.json', time() - 120);
$arrived = ['stopSequence' => 2, 'arrival' => ['delay' => 180], 'departure' => ['delay' => 180], 'scheduleRelationship' => 'SCHEDULED'];
$published = $source;
$published['entity'][0]['tripUpdate']['stopTimeUpdate'] = [$published['entity'][0]['tripUpdate']['stopTimeUpdate'][0], $arrived];
$calls = 0;
$download = function (string $key, string $path) use (&$calls, $published): void { $calls++; file_put_contents($path, json_encode($published, JSON_THROW_ON_ERROR)); };
$nowFixture = (new DateTimeImmutable('2026-09-19 10:06:00', new DateTimeZone('Europe/Zurich')))->getTimestamp();
$built = trainCollect($cache . '/private', $download, $nowFixture);
sort($built);
trainCheck($built === ['lausanne', 'zurich'], 'Collect only the cities requested recently');
$rebuilt = trainStoredFeed($cache . '/private', 'lausanne');
trainCheck($rebuilt['trains'][0]['trainNumber'] === $train['trainNumber'] && $rebuilt['fetchedAt'] === gmdate('Y-m-d\TH:i:s\Z', filemtime($cache . '/private/source.json')), 'Store a fresh feed stamped with the source fetch time');
trainCheck($calls === 1 && !is_file($cache . '/private/source.retry'), 'Download once per collection and clear the retry marker');

trainMarkActive($cache . '/private', 'geneva', time() - TRAIN_ACTIVE_SECONDS - 1);
trainCheck(!in_array('geneva', trainActiveCities($cache . '/private', time()), true), 'Drop activity older than the window');

foreach (['credentials.env', 'source.json', 'source.retry', 'feed.lock'] as $file) if (is_file($cache . '/private/' . $file)) unlink($cache . '/private/' . $file);
foreach (glob($cache . '/private/feeds/*') ?: [] as $file) unlink($file);
rmdir($cache . '/private/feeds');
unlink($cache . '/timetable/zurich.json'); unlink($cache . '/timetable/lausanne.json');
rmdir($cache . '/private'); rmdir($cache . '/timetable'); rmdir($cache);
putenv('SWISS_TRAINS_PRIVATE_DIR'); putenv('SWISS_TRAINS_TIMETABLE_DIR');

echo "Verified train feed matching, next-stop selection, units, stored city feeds and the collector\n";
