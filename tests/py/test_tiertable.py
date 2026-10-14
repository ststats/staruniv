"""티어표 분석 중 이미지 없이 볼 수 있는 부분: FA 명단 읽기와 DB 비교."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from tiertable.compare import compare  # noqa: E402
from tiertable.fa import read_fa_text  # noqa: E402


def card(nick, tier, race, known=None):
    c = {'nickname_ocr': nick, 'tier': tier, 'race': race, 'tier_read': {'margin': 0.5}, 'race_read': {'margin': 0.5},
         'name_unchanged': True}
    if known:
        c['known'] = known
    return c


def player(pid, nick, tier, race, team, soop=None):
    return {'id': pid, 'nickname': nick, 'tier': tier, 'race': race, 'affiliation': team, 'soop_id': soop or nick}


class FaTextTest(unittest.TestCase):
    def test_reads_tier_race_and_names(self):
        text = '\n'.join(['FA 인원 3명', '갓티어｜ T 가람 Z 나래', 'P 다온', '5티어 | Z 라온', '댓글 환영 | 공지 글'])
        self.assertEqual(read_fa_text(text), [
            {'tier': '갓', 'race': '테란', 'nickname': '가람'},
            {'tier': '갓', 'race': '저그', 'nickname': '나래'},
            {'tier': '갓', 'race': '프로토스', 'nickname': '다온'},
            {'tier': '5', 'race': '저그', 'nickname': '라온'},
        ])


class CompareTest(unittest.TestCase):
    DB = [player(1, '가람', '3', '테란', '캄몬대'), player(2, '나래', '4', '저그', '캄몬대'),
          player(3, '다온', '5', '프로토스', 'FA'), player(4, '라온', '6', '테란', '숨은대')]

    def section(self, *cards, title='캄몬대'):
        return {'y': (0, 100), 'title_ocr': [title], 'cards': list(cards)}

    def test_tier_change_and_missing_player_goes_dormant(self):
        res = compare([self.section(card('가람', '2', '테란'))], [{'tier': '5', 'race': '프로토스', 'nickname': '다온'}],
                      self.DB, off_board=['숨은대'])
        by_nick = {c['nickname']: c for c in res['changes']}
        self.assertEqual(by_nick['가람']['diff'], {'tier': ['3', '2']})
        # 표에도 FA 명단에도 없는 나래는 휴면, 현황판 밖 대학(숨은대) 라온은 그대로
        self.assertEqual(by_nick['나래']['diff'], {'affiliation': ['캄몬대', '휴면']})
        self.assertNotIn('라온', by_nick)
        self.assertNotIn('다온', by_nick)   # FA 명단 그대로

    def test_without_fa_text_missing_players_are_only_reviewed(self):
        res = compare([self.section(card('가람', '3', '테란'))], [], self.DB, off_board=['숨은대'])
        self.assertEqual(res['changes'], [])
        self.assertIn({'type': '표에서 빠짐', 'team': '캄몬대', 'id': 2, 'nickname': '나래', 'tier': '4'}, res['review'])

    def test_unsure_glyph_is_raised_for_review(self):
        c = card('가람', '3', '테란')
        c['tier_read'] = {'margin': 0.01, 'alt': '8'}
        res = compare([self.section(c, card('나래', '4', '저그'))], [], self.DB, off_board=['숨은대'])
        change = next(x for x in res['changes'] if x['nickname'] == '가람')
        self.assertEqual(change['diff'], {'tier': ['3', '3']})
        self.assertIn('3·8 중 어느 쪽인지', change['uncertain'])

    def test_known_photo_finds_transferred_player(self):
        # 사진으로 아는 라온이 캄몬대 구역에 있으면 이적
        res = compare([self.section(card('라온', '6', '테란', known={'soop_id': '라온', 'nickname': '라온'}),
                                    card('가람', '3', '테란'), card('나래', '4', '저그'))], [], self.DB)
        move = next(x for x in res['changes'] if x['nickname'] == '라온')
        self.assertEqual(move['diff'], {'affiliation': ['숨은대', '캄몬대']})


if __name__ == '__main__':
    unittest.main()
