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

$cache = sys_get_temp_dir() . '/swiss-trains-' . bin2hex(random_bytes(6));
mkdir($cache . '/private', 0700, true);
mkdir($cache . '/timetable', 0700, true);
$source['header']['feedVersion'] = '20260916';
file_put_contents($cache . '/private/credentials.env', "GTFS_RT_API_KEY=test\n");
file_put_contents($cache . '/private/source.json', json_encode($source, JSON_THROW_ON_ERROR));
file_put_contents($cache . '/timetable/zurich.json', json_encode($timetable, JSON_THROW_ON_ERROR));
touch($cache . '/private/source.json', time() - 120);
putenv('SWISS_TRAINS_PRIVATE_DIR=' . $cache . '/private');
putenv('SWISS_TRAINS_TIMETABLE_DIR=' . $cache . '/timetable');
$calls = 0;
$failure = function () use (&$calls): string { $calls++; throw new RuntimeException('rate limited'); };
ob_start(); serveTrains('zurich', $failure); $cached = json_decode(ob_get_clean(), true, 512, JSON_THROW_ON_ERROR);
ob_start(); serveTrains('zurich', $failure); ob_end_clean();
trainCheck($cached['feedVersion'] === '20260916', 'Serve the last valid feed when refresh fails');
trainCheck($calls === 1 && is_file($cache . '/private/source.retry'), 'Back off upstream refreshes for one minute after failure');
foreach (['credentials.env', 'source.json', 'source.retry', 'feed.lock'] as $file) if (is_file($cache . '/private/' . $file)) unlink($cache . '/private/' . $file);
unlink($cache . '/timetable/zurich.json');
rmdir($cache . '/private'); rmdir($cache . '/timetable'); rmdir($cache);
putenv('SWISS_TRAINS_PRIVATE_DIR'); putenv('SWISS_TRAINS_TIMETABLE_DIR');

echo "Verified train feed matching, next-stop selection, units and timetable versions\n";
