"""Exercise shared-market routing, point-in-time revisions and hash validation."""
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
import publish_market_data as publish
from providers import data_repository as repo


class DataRepositoryTest(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.catalog = root / repo.CATALOG_REPOSITORY
        self.years = {}
        for year in ('2025', '2026'):
            annual = root / f'{repo.CATALOG_REPOSITORY}-{year}'
            publish.init(self.catalog, annual, year)
            self.years[year] = annual
        self.urls = []

    def add_daily(self, day, code, price, revision=1, after=None):
        year, month = day[:4], day[:7]
        annual = self.years[year]
        manifest = publish.file_json(annual / 'manifest.json')
        index = publish.file_json(annual / manifest['months'][month]['path'])
        seen = (after or day) + 'T17:00:00+08:00'
        raw = publish.canonical([{'date': day, 'code': code, 'open': price, 'high': price,
                                  'low': price, 'close': price, 'volume': 100}])
        digest = repo.sha256(raw)
        path = f'shards/{month}/daily/{digest}.json'
        entry = {
            'dataset': 'daily', 'market': 'TWSE', 'instrument_id': code, 'code': code,
            'date_from': day, 'date_to': day, 'statistic_date': day,
            'observed_at': seen, 'published_at': None, 'retrieved_at': seen,
            'revision': revision, 'data_version': f'r{revision}',
            'source': {'url': 'https://example.invalid/data', 'license_url': 'https://example.invalid/license',
                       'redistributable': True, 'license': 'isolated test fixture'},
            'coverage': {'complete': True, 'missing': []}, 'row_count': 1, 'unit': 'shares',
            'trading_scope': 'regular',
            'asset': {'bytes': len(raw), 'sha256': digest, 'format': 'json', 'compression': 'none', 'path': path},
            'validation': {'status': 'passed', 'method': 'test fixture', 'verified_at': seen},
        }
        publish.write_immutable(annual / path, raw)
        index['datasets']['daily'].append(entry)
        manifest['months'][month] = publish.write_month(annual, index)
        publish.write_atomic(annual / 'manifest.json', publish.canonical(manifest))
        return annual / path

    def download(self, url, limit, deadline):
        self.urls.append(url)
        _, owner, repository, ref, path = url.split('/', 6)[2:]
        self.assertEqual((owner, ref), (repo.REPOSITORY_OWNER, 'main'))
        root = self.catalog if repository == repo.CATALOG_REPOSITORY else self.years[repository[-4:]]
        return (root / path).read_bytes()

    def test_cross_year_selective_read_and_ram_reuse(self):
        self.add_daily('2025-12-31', '2330', 100)
        self.add_daily('2026-01-02', '2330', 101)
        other = self.add_daily('2026-01-02', '2404', 200)
        client = repo.SharedDataClient(download=self.download)
        result = client.read('daily', '2025-12-31', '2026-02-01', code='2330')
        self.assertEqual([entry['date_from'] for entry, _ in result], ['2025-12-31', '2026-01-02'])
        self.assertFalse(any(url.endswith(other.name) for url in self.urls))
        count = len(self.urls)
        self.assertEqual(client.read('daily', '2025-12-31', '2026-02-01', code='2330'), result)
        self.assertEqual(len(self.urls), count)

    def test_revision_respects_available_time(self):
        self.add_daily('2026-01-02', '2330', 101)
        self.add_daily('2026-01-02', '2330', 102, revision=2, after='2026-01-10')
        client = repo.SharedDataClient(download=self.download)
        historical = client.read('daily', '2026-01-01', '2026-01-02', code='2330',
                                 as_of='2026-01-02T18:00:00+08:00')
        latest = client.read('daily', '2026-01-01', '2026-01-02', code='2330')
        self.assertEqual([historical[0][0]['revision'], latest[0][0]['revision']], [1, 2])

    def test_reject_hash_and_stop_on_cancellation(self):
        asset = self.add_daily('2026-01-02', '2330', 101)
        asset.write_bytes(asset.read_bytes().replace(b'101', b'102'))
        client = repo.SharedDataClient(download=self.download)
        with self.assertRaisesRegex(repo.Unavailable, 'SHA-256'):
            client.read('daily', '2026-01-01', '2026-01-02', code='2330')
        client.cancel.set()
        with self.assertRaises(InterruptedError):
            client.read('daily', '2026-01-01', '2026-01-02')


if __name__ == '__main__':
    unittest.main()
