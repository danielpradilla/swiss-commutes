#!/usr/bin/env python3
"""Refresh the deployed GTFS timetable when the realtime feed changes version."""
import argparse
import fcntl
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from urllib.request import Request, urlopen
import zipfile

SOURCE = 'https://api.opentransportdata.swiss/la/gtfs-rt?format=JSON'
CATALOG = 'https://data.opentransportdata.swiss/dataset/timetable-{}-gtfs2020'
HOST = 'https://data.opentransportdata.swiss'


class Archives(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != 'a':
            return
        href = dict(attrs).get('href', '')
        if re.search(r'/download/gtfs_fp\d{4}_\d{8}\.zip$', href, re.I):
            self.links.append(href if href.startswith('https://') else HOST + href)


def request(url, key=None):
    headers = {'User-Agent': 'SwissCommutesTrains/1.0'}
    if key:
        headers['Authorization'] = key if key.startswith('Bearer ') else 'Bearer ' + key
    return urlopen(Request(url, headers=headers), timeout=90)


def feed_version(key):
    with request(SOURCE, key) as response:
        prefix = response.read(131072).decode('utf-8')
    match = re.search(r'"(?:header|Header)"\s*:\s*(\{[^{}]*\})', prefix)
    if not match:
        raise ValueError('Realtime feed header missing')
    header = json.loads(match.group(1))
    version = str(header.get('feedVersion', header.get('FeedVersion', '')))
    timestamp = int(header.get('timestamp', header.get('Timestamp', 0)))
    if not re.fullmatch(r'\d{8}', version) or abs(datetime.now().timestamp() - timestamp) > 900:
        raise ValueError('Realtime feed version or timestamp invalid')
    return version


def archive_url(version):
    year = datetime.strptime(version, '%Y%m%d').year
    for timetable_year in (year, year + 1):
        with request(CATALOG.format(timetable_year)) as response:
            parser = Archives()
            parser.feed(response.read().decode('utf-8'))
        matches = [url for url in parser.links if url.lower().endswith('_' + version + '.zip')]
        if matches:
            return matches[0]
    raise ValueError(f'No published GTFS archive for realtime version {version}')


def service_dates():
    # DreamHost uses Pacific time; compute the service day in Switzerland instead.
    from zoneinfo import ZoneInfo
    day = datetime.now(ZoneInfo('Europe/Zurich')).date()
    return [(day + timedelta(days=offset)).strftime('%Y%m%d') for offset in (-1, 0, 1)]


def installed(directory):
    try:
        data = json.loads((directory / 'geneva.json').read_text())
        return data['feedVersion'], data['serviceDates']
    except (OSError, ValueError, KeyError):
        return None, None


def update(root, key, version=None):
    private = root / '.private'
    private.mkdir(mode=0o700, exist_ok=True)
    with (private / 'timetable-update.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        version = version or feed_version(key)
        dates = service_dates()
        current = private / 'timetable-current'
        if installed(current) == (version, dates):
            print(f'Timetable {version} already covers {dates[1]}')
            return False
        cached_archive = private / f'gtfs-{version}.zip'
        with tempfile.TemporaryDirectory(prefix='timetable-build-', dir=private) as temporary:
            work = Path(temporary)
            archive = cached_archive
            if not archive.exists():
                url = archive_url(version)
                candidate = work / 'gtfs.zip'
                with request(url) as response, candidate.open('wb') as output:
                    shutil.copyfileobj(response, output)
                archive = candidate
            with zipfile.ZipFile(archive) as zip_file:
                lines = zip_file.read('feed_info.txt').decode('utf-8-sig').splitlines()
                import csv
                archive_version = next(csv.DictReader(lines))['feed_version']
            if archive_version != version:
                raise ValueError(f'Archive version {archive_version} differs from realtime {version}')
            if archive != cached_archive:
                archive.rename(cached_archive)
                archive = cached_archive
            staging = work / 'generated'
            subprocess.run(['node', str(private / 'updater/scripts/generate-train-timetable.mjs'),
                            str(archive), str(staging), dates[1]], check=True)
            expected = {path.name.removesuffix('-rail-routes.json') for path in (private / 'updater/app/data').glob('*-rail-routes.json')}
            if {path.stem for path in staging.glob('*.json')} != expected:
                raise ValueError('Generated timetable city set differs from rail data')
            for city in expected:
                data = json.loads((staging / f'{city}.json').read_text())
                if data['feedVersion'] != version or data['serviceDates'] != dates or not data['trips']:
                    raise ValueError(f'Invalid generated timetable for {city}')
            target = private / f'timetable-{version}-{dates[1]}'
            if target.exists():
                shutil.rmtree(target)
            staging.rename(target)
            link = private / 'timetable-next'
            link.symlink_to(target.name, target_is_directory=True)
            os.replace(link, current)
            print(f'Activated timetable {version} for {dates[1]} ({len(expected)} cities)')
            # The HTTP endpoint refreshes its source against the new version on the next request.
            (private / 'source.retry').unlink(missing_ok=True)
            for old in private.glob('timetable-????????-????????'):
                if old != target and old.is_dir() and datetime.now().timestamp() - old.stat().st_mtime > 172800:
                    shutil.rmtree(old)
            for old in private.glob('gtfs-????????.zip'):
                if old != cached_archive:
                    old.unlink()
            return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1] / 'public/trains')
    args = parser.parse_args()
    root = args.root.resolve()
    credential = root / '.private/credentials.env'
    key = os.environ.get('GTFS_RT_API_KEY', '')
    if not key:
        for line in credential.read_text().splitlines():
            if line.startswith('GTFS_RT_API_KEY='):
                key = line.partition('=')[2].strip().strip('"\'')
    if not key:
        raise ValueError('Train API key not configured')
    update(root, key)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Timetable update failed: {error}', file=sys.stderr)
        sys.exit(1)
