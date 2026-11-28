"""Daily prices remain usable before a dated shares-outstanding record exists."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from serve_local import DailyService


class DailyDenominatorTest(unittest.TestCase):
    def test_point_in_time_shares(self):
        with tempfile.TemporaryDirectory() as folder:
            daily = DailyService(Path(folder), None)
            prices = [
                dict(date=day, open=10, max=11, min=9, close=10, Trading_Volume=100)
                for day in ('2026-11-21', '2026-11-10')
            ]
            shares = [dict(date='2026-11-20', NumberOfSharesIssued=1000)]
            with patch.object(daily, '_fetch_finmind', side_effect=[prices, shares]):
                bars = daily.get_daily('2330')['bars']
            self.assertEqual([bar[0] for bar in bars], ['2026-11-10', '2026-11-21'])
            self.assertEqual(bars[0][6:8], [None, None])
            self.assertEqual(bars[1][6:8], [1000, 0.1])


if __name__ == '__main__':
    unittest.main()
