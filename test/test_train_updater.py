import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

module_path = Path(__file__).resolve().parents[1] / 'scripts/update-train-timetable.py'
spec = importlib.util.spec_from_file_location('train_updater', module_path)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class TimetableUpdateTests(unittest.TestCase):
    def test_archive_version_mismatch_preserves_active_timetable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / '.private'
            private.mkdir()
            active = private / 'timetable-20260916-20260924'
            active.mkdir()
            (active / 'geneva.json').write_text(json.dumps({'feedVersion': '20260916', 'serviceDates': updater.service_dates()}))
            (private / 'timetable-current').symlink_to(active.name)
            archive = private / 'gtfs-20260923.zip'
            with zipfile.ZipFile(archive, 'w') as file:
                file.writestr('feed_info.txt', 'feed_version\n20260916\n')
            with self.assertRaisesRegex(ValueError, 'differs from realtime'):
                updater.update(root, 'unused', version='20260923')
            self.assertEqual((private / 'timetable-current').resolve(), active.resolve())

    def test_catalog_selects_exact_version(self):
        parser = updater.Archives()
        parser.feed('<a href="/dataset/x/download/gtfs_fp2026_20260919.zip">old</a>'
                    '<a href="/dataset/x/download/gtfs_fp2026_20260923.zip">current</a>')
        self.assertEqual(parser.links[-1], 'https://data.opentransportdata.swiss/dataset/x/download/gtfs_fp2026_20260923.zip')


if __name__ == '__main__':
    unittest.main()
