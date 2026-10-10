"""사이트 데이터 계산(scripts/write_site_data.py)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from write_site_data import clean, player_stats, race_code  # noqa: E402


def rnd(player, fmt, race, result):
    return {'우리 선수': player, '형식': fmt, '상대 종족': race, '결과': result}


class PlayerStatsTest(unittest.TestCase):
    def test_counts_by_format_and_opponent_race(self):
        rows = [rnd('가', '대학', '테란', '승'), rnd('가', '대학', '저그', '패'), rnd('가', '미니', '프로토스', '승'),
                rnd('나', 'CK', '저그', '승')]
        stats = {s['이름']: s for s in player_stats(rows)}
        self.assertEqual(list(stats), ['가', '나'])
        self.assertEqual(stats['가']['대학 전적'], {'wins': 1, 'losses': 1})
        self.assertEqual(stats['가']['미니 전적'], {'wins': 1, 'losses': 0})
        self.assertEqual(stats['가']['대회 전적'], {'wins': 0, 'losses': 0})        # 경기 없음
        self.assertEqual(stats['가']['테란전 전적'], {'wins': 1, 'losses': 0})
        self.assertEqual(stats['가']['저그전 전적'], {'wins': 0, 'losses': 1})
        self.assertEqual(stats['나']['CK 전적'], {'wins': 1, 'losses': 0})

    def test_invisible_characters_and_blank_players(self):
        rows = [rnd('가​', '대학', '테란', '승 '), rnd('', '대학', '테란', '승'), rnd(None, '대학', '테란', '패')]
        stats = player_stats(rows)
        self.assertEqual([s['이름'] for s in stats], ['가'])
        self.assertEqual(stats[0]['대학 전적'], {'wins': 1, 'losses': 0})

    def test_race_code_and_clean(self):
        self.assertEqual([race_code(x) for x in ('테란', '저그', ' 프로토스', '랜덤', '')], ['T', 'Z', 'P', '', ''])
        self.assertEqual(clean(None), '')
        self.assertEqual(clean(' 승﻿ '), '승')


if __name__ == '__main__':
    unittest.main()
