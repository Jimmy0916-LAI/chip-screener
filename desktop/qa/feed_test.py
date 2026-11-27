"""Regression tests for 0.6.3 market updates and cache boundaries."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import serve_local as service


def weekly_csv(day, increment=0):
    lines = [','.join(service.REQUIRED_TDCC_FIELDS)]
    stamp = day.replace('-', '')
    for level in range(1, 18):
        shares = 150 + increment if level == 17 else 0 if level == 16 else 10 + (increment if level == 1 else 0)
        people = 15 if level == 17 else int(level < 16)
        lines.append(f'{stamp},2404,{level},{people},{shares},0.00')
    return ('\n'.join(lines) + '\n').encode()


class FeedTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.feed = service.LocalFeedService(root / 'weekly', {
            'hashes': {'2026-11-13':'a'*64},
            'sessions': ['2026-11-13', '2026-11-20'],
            'universe': ['2404'],
        })

    def test_same_hash_revision_and_older(self):
        day = '2026-11-20'
        first = weekly_csv(day)
        packet, _ = self.feed._check_week(first)
        self.assertEqual(packet['rows']['2404'][0], 150)
        path = Path(self.directory.name) / 'weekly' / 'official' / f'{day}.json'
        saved_bytes = path.read_bytes()
        self.assertIsNone(self.feed._check_week(first)[0])
        with self.assertRaises(ValueError):
            self.feed._check_week(weekly_csv('2026-11-13'))
        with self.assertRaises(ValueError):
            self.feed._check_week(b'')
        self.assertEqual(path.read_bytes(), saved_bytes)
        with patch.object(self.feed, '_atomic_save', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.feed._check_week(weekly_csv(day, 5))
        self.assertEqual(self.feed.initial()['weeks'][day], packet)
        revised, _ = self.feed._check_week(weekly_csv(day, 5))
        self.assertEqual(revised['rows']['2404'][0], 155)
        self.assertEqual(len(list((path.parent.parent / 'revisions').glob('*.json'))), 1)
        reloaded = service.LocalFeedService(self.feed.cache_dir, self.feed.base)
        self.assertEqual(reloaded.initial()['weeks'][day], revised)

    def test_source_failure_keeps_week_and_other_market_can_succeed(self):
        keeper, _ = self.feed._check_week(weekly_csv('2026-11-20'))
        def receive(key):
            self.feed.market[key] = {'day': '2026-11-26'}
        with patch.object(service, 'download_url', side_effect=TimeoutError), \
             patch.object(self.feed,'_check_calendar',return_value=None), \
             patch.object(self.feed,'_refresh_market',side_effect=receive):
            result = self.feed.update()
        self.assertEqual(result['status'], '部分成功')
        self.assertEqual(len(result['market']), 4)
        self.assertEqual(self.feed.weeks['2026-11-20'], keeper)

    def test_inflight_update_shared(self):
        arrived, finish = threading.Event(), threading.Event()
        original_future = service.Future
        class ObservedFuture(original_future):
            def result(self, *args, **kwargs):
                arrived.set()
                return super().result(*args, **kwargs)
        expected = {'status':'已是最新'}
        def refresh():
            if not finish.wait(5):
                raise TimeoutError()
            return expected
        with patch.object(service,'Future',ObservedFuture), patch.object(self.feed,'_refresh',side_effect=refresh) as work:
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(self.feed.update)
                # Calls to Future.result inside the service identify the joining request.
                second = pool.submit(self.feed.update)
                self.assertTrue(arrived.wait(5))
                finish.set()
                self.assertIs(first.result(), expected)
                self.assertIs(second.result(), expected)
            work.assert_called_once()

    def test_window_leases_keep_other_windows_and_allow_reload(self):
        now = [0]
        leases = service.WindowLeases(lambda: now[0])
        leases.update('first', True)
        leases.update('second', True)
        leases.update('first', False)
        now[0] = 10
        self.assertFalse(leases.expired())
        leases.update('second', False)
        now[0] = 12
        self.assertFalse(leases.expired())
        leases.update('replacement', True)
        now[0] = 15
        self.assertFalse(leases.expired())
        leases.update('replacement', False)
        now[0] = 20
        self.assertTrue(leases.expired())

    def test_cache_clear_preserves_other_files(self):
        root = Path(self.directory.name)
        path = root / 'daily'
        path.mkdir()
        (path / '2404.json').write_text('{}')
        (path / 'unknown.json').write_text('{}')
        (root / 'watchlist.json').write_text('{}')
        daily = service.DailyService(path, self.feed)
        self.assertEqual(daily.cache_info()['bytes'], 2)
        self.assertEqual(daily.clear_cache()['count'],1)
        self.assertTrue((root / 'watchlist.json').exists())
        self.assertTrue((path / 'unknown.json').exists())


if __name__ == '__main__':
    unittest.main()
