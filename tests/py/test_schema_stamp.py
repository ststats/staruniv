"""SQL 파일 맨 끝 지문(scripts/schema_stamp.py)이 내용과 맞는지. 다르면 맞는 값을 알려 준다."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from schema_stamp import read_stamp  # noqa: E402


class SchemaStampTest(unittest.TestCase):
    def test_stamp_matches_content(self):
        name, written, actual = read_stamp(ROOT / "supabase" / "staruniv.sql")
        self.assertEqual(name, "staruniv")
        self.assertEqual(written, actual, f"staruniv.sql 맨 끝 지문을 '{actual}'로 바꾸세요")
