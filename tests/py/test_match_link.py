"""경기·세트 잇기(scripts/match_link.py)."""
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from match_link import link_rounds_to_matches  # noqa: E402

MATCHES = [
    {'매치 번호': 1, '날짜': '2026-09-01', '상대팀': 'A대', '형식': '대학'},
    {'매치 번호': 2, '날짜': '2026-09-01', '상대팀': 'A대', '형식': '미니'},
    {'매치 번호': 3, '날짜': '2026-09-02', '상대팀': 'B대', '형식': '대회'},   # 세트 기록 없음
]
ROUNDS = [
    {'매치 번호': 1, '날짜': '2026-09-01', '상대팀': 'A대', '형식': '대학', '세트': '1세트', '라운드': '1R', '_mirrored': False},
    {'매치 번호': 1, '날짜': '2026-09-01', '상대팀': 'A대', '형식': '', '세트': '1세트', '라운드': '2R', '_mirrored': False},
    {'매치 번호': 2, '날짜': '2026-09-01', '상대팀': 'A대', '형식': '대회', '세트': '단일', '라운드': '1R', '_mirrored': False},
    {'매치 번호': 2, '날짜': '2026-09-01', '상대팀': 'A대', '형식': '미니', '세트': '단일', '라운드': '1R', '_mirrored': True},
]


def link(matches=MATCHES, rounds=ROUNDS):
    log = io.StringIO()
    with redirect_stdout(log):
        m, r = link_rounds_to_matches(matches, rounds)
    return m, r, log.getvalue()


class LinkTest(unittest.TestCase):
    def test_keys_follow_match_number(self):
        m, r, _ = link()
        self.assertEqual([x['_match_key'] for x in m], ['no__1', 'no__2', 'no__3'])
        self.assertEqual([x['_match_key'] for x in r], ['no__1', 'no__1', 'no__2', 'no__2'])

    def test_empty_round_format_is_filled_from_match(self):
        _, r, _ = link()
        self.assertEqual(r[1]['형식'], '대학')

    def test_round_format_is_kept_and_conflict_is_reported(self):
        _, r, log = link()
        self.assertEqual(r[2]['형식'], '대회')   # 라운드 값은 덮어쓰지 않는다
        self.assertIn("'형식'이 어긋난 매치가 1건", log)
        self.assertIn("매치 목록은 '미니', 매치 전적은 대회 1행", log)

    def test_match_without_rounds_is_reported(self):
        _, _, log = link()
        self.assertIn('세트 기록이 없는 매치가 1건', log)
        self.assertIn('2026-09-02 vs B대', log)

    def test_inputs_are_not_modified_and_mirror_flag_is_kept(self):
        before = [dict(x) for x in ROUNDS]
        _, r, _ = link()
        self.assertEqual(ROUNDS, before)
        self.assertIs(r[3]['_mirrored'], True)

    def test_float_match_numbers_join_as_integers(self):
        m, r, _ = link([{'매치 번호': 7.0, '날짜': 'd', '상대팀': 't', '형식': '대학'}],
                       [{'매치 번호': 7, '날짜': 'd', '상대팀': 't', '형식': ''}])
        self.assertEqual(m[0]['_match_key'], r[0]['_match_key'])
        self.assertEqual(r[0]['형식'], '대학')


if __name__ == '__main__':
    unittest.main()
