"""티어표 분석 중 OCR 없이 볼 수 있는 부분: FA 명단 읽기, DB 비교, 구역 나누기·닉네임 그림 확인."""

import re
import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from tiertable.cards import cut_badge, split_sections  # noqa: E402
from tiertable.compare import compare  # noqa: E402
from tiertable.fa import FA_TIERS, read_fa_text  # noqa: E402
from tiertable.namelook import FONT, card_look, looks_same  # noqa: E402


def name_cell(text, bg, size=18, width=125):
    """카드 닉네임 칸 흉내: 구역 배경에 흰 글씨."""
    im = Image.new("RGB", (width, 24), bg)
    ImageDraw.Draw(im).text((1, 1), text, font=ImageFont.truetype(str(FONT), size), fill=(255, 255, 255))
    return im


def card(nick, tier, race, known=None):
    c = {
        "nickname_ocr": nick,
        "tier": tier,
        "race": race,
        "tier_read": {"margin": 0.5},
        "race_read": {"margin": 0.5},
        "name_unchanged": True,
    }
    if known:
        c["known"] = known
    return c


def player(pid, nick, tier, race, team, soop=None):
    return {"id": pid, "nickname": nick, "tier": tier, "race": race, "affiliation": team, "soop_id": soop or nick}


class FaTextTest(unittest.TestCase):
    def test_reads_tier_race_and_names(self):
        text = "\n".join(["FA 인원 3명", "갓티어｜ T 가람 Z 나래", "P 다온", "5티어 | Z 라온", "댓글 환영 | 공지 글"])
        self.assertEqual(
            read_fa_text(text),
            [
                {"tier": "갓", "race": "테란", "nickname": "가람"},
                {"tier": "갓", "race": "저그", "nickname": "나래"},
                {"tier": "갓", "race": "프로토스", "nickname": "다온"},
                {"tier": "5", "race": "저그", "nickname": "라온"},
            ],
        )

    def test_tiers_match_db_ladder(self):
        sql = (Path(__file__).resolve().parents[2] / "supabase" / "staruniv.sql").read_text(encoding="utf-8")
        ladder = re.search(r"function public\.tier_ladder\(\)[\s\S]*?array\[([^\]]*)\]", sql)[1]
        self.assertEqual(FA_TIERS, set(re.findall(r"'([^']*)'", ladder)))


class CompareTest(unittest.TestCase):
    DB = [
        player(1, "가람", "3", "테란", "캄몬대"),
        player(2, "나래", "4", "저그", "캄몬대"),
        player(3, "다온", "5", "프로토스", "FA"),
        player(4, "라온", "6", "테란", "숨은대"),
    ]

    def section(self, *cards, title="캄몬대"):
        return {"y": (0, 100), "title_ocr": [title], "cards": list(cards)}

    def test_tier_change_and_missing_player_goes_dormant(self):
        res = compare(
            [self.section(card("가람", "2", "테란"))],
            [{"tier": "5", "race": "프로토스", "nickname": "다온"}],
            self.DB,
            off_board=["숨은대"],
        )
        by_nick = {c["nickname"]: c for c in res["changes"]}
        self.assertEqual(by_nick["가람"]["diff"], {"tier": ["3", "2"]})
        # 표에도 FA 명단에도 없는 나래는 휴면, 현황판 밖 대학(숨은대) 라온은 그대로
        self.assertEqual(by_nick["나래"]["diff"], {"affiliation": ["캄몬대", "휴면"]})
        self.assertNotIn("라온", by_nick)
        self.assertNotIn("다온", by_nick)  # FA 명단 그대로

    def test_without_fa_text_missing_players_are_only_reviewed(self):
        res = compare([self.section(card("가람", "3", "테란"))], [], self.DB, off_board=["숨은대"])
        self.assertEqual(res["changes"], [])
        self.assertIn(
            {"type": "표에서 빠짐", "team": "캄몬대", "id": 2, "nickname": "나래", "tier": "4"}, res["review"]
        )

    def test_unsure_glyph_is_raised_for_review(self):
        c = card("가람", "3", "테란")
        c["tier_read"] = {"margin": 0.01, "alt": "8"}
        res = compare([self.section(c, card("나래", "4", "저그"))], [], self.DB, off_board=["숨은대"])
        change = next(x for x in res["changes"] if x["nickname"] == "가람")
        self.assertEqual(change["diff"], {"tier": ["3", "3"]})
        self.assertIn("3·8 중 어느 쪽인지", change["uncertain"])

    def test_known_photo_finds_transferred_player(self):
        # 사진으로 아는 라온이 캄몬대 구역에 있으면 이적
        res = compare(
            [
                self.section(
                    card("라온", "6", "테란", known={"soop_id": "라온", "nickname": "라온"}),
                    card("가람", "3", "테란"),
                    card("나래", "4", "저그"),
                )
            ],
            [],
            self.DB,
        )
        move = next(x for x in res["changes"] if x["nickname"] == "라온")
        self.assertEqual(move["diff"], {"affiliation": ["숨은대", "캄몬대"]})


class ImageTest(unittest.TestCase):
    def test_soft_section_border_still_splits(self):
        # 뉴캣슬(보라)→DM(남색)처럼 경계가 4px에 걸쳐 번져도 두 구역으로 나눈다
        a, b = (96, 90, 196), (74, 92, 150)
        im = Image.new("RGB", (1100, 400), b)
        draw = ImageDraw.Draw(im)
        draw.rectangle((0, 0, 1099, 199), fill=a)
        for k in range(4):
            t = (k + 1) / 5
            draw.line((0, 200 + k, 1099, 200 + k), fill=tuple(round(x + (y - x) * t) for x, y in zip(a, b)))
        self.assertEqual(len(split_sections(im)), 2)

    def test_white_name_on_light_section_is_not_cut(self):
        # 씨나인처럼 밝은 배경의 흰 글씨 획을 뱃지로 알고 자르면 '히요코'가 'ㅎ'로 읽힌다
        cell = name_cell("히요코", (255, 160, 199))
        self.assertEqual(cut_badge(cell).width, cell.width)
        badge = cell.copy()
        ImageDraw.Draw(badge).rectangle((70, 0, 110, 23), fill=(255, 255, 255))
        self.assertLess(cut_badge(badge).width, 70)

    def test_name_look_overrides_bad_ocr(self):
        bg = (2, 155, 195)
        c = {"name_look": card_look(name_cell("낭니", bg), bg), "nickname_ocr": "방늬이이", "role": ""}
        self.assertTrue(looks_same(c, "낭니"))
        self.assertFalse(looks_same(c, "김택용"))
        # 직책이 붙은 칸은 직책을 붙여 그려 본다
        p = {"name_look": card_look(name_cell("교수 방태수", bg), bg), "nickname_ocr": "방터", "role": "교수"}
        self.assertTrue(looks_same(p, "방태수"))


class NameLookCompareTest(unittest.TestCase):
    DB = [player(1, "낭니", "8", "저그", "캄몬대"), player(2, "가람", "3", "테란", "캄몬대")]

    def test_bad_ocr_of_same_name_is_not_a_rename(self):
        bg = (2, 155, 195)
        c = card("방늬이이", "8", "저그", known={"soop_id": "낭니", "nickname": "낭니"})
        c.pop("name_unchanged")
        c.update({"name_look": card_look(name_cell("낭니", bg), bg), "role": ""})
        res = compare([{"y": (0, 100), "title_ocr": ["캄몬대"], "cards": [c, card("가람", "3", "테란")]}], [], self.DB)
        self.assertFalse([x for x in res["changes"] if "nickname" in x["diff"]])

    def test_headcount_mismatch_is_reviewed(self):
        sec = {"y": (0, 100), "title_ocr": ["캄몬대"], "headcount": 3, "cards": [card("낭니", "8", "저그")]}
        res = compare([sec], [], self.DB)
        self.assertIn(
            {"type": "구역 인원 불일치", "section": 0, "team": "캄몬대", "expected": 3, "found": 1}, res["review"]
        )


if __name__ == "__main__":
    unittest.main()
