"""브라우저 관리자 페이지용 Supabase 공개 설정을 docs/supabase-config.js에 쓴다.

SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY(또는 SUPABASE_ANON_KEY)는 브라우저에 공개되는 값이다.
DB 비밀번호/SUPABASE_DB_URL/service_role은 절대 이 파일에 쓰지 않는다.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "supabase-config.js"


def main() -> None:
    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    if not url or not key:
        sys.exit("❌ SUPABASE_URL 및 SUPABASE_PUBLISHABLE_KEY(또는 SUPABASE_ANON_KEY)가 필요합니다.")
    if not url.startswith("https://"):
        sys.exit("❌ SUPABASE_URL은 https://... 형식이어야 합니다.")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = (
        "// 자동 생성 파일: 브라우저에서 공개되어도 되는 Supabase URL/publishable key만 포함합니다.\n"
        "window.STARUNIV_SUPABASE_CONFIG = Object.freeze({\n"
        f"  url: {json.dumps(url)},\n"
        f"  key: {json.dumps(key)}\n"
        "});\n"
    )
    tmp = OUT.with_suffix(".js.tmp")
    tmp.write_text(payload, encoding="utf-8")
    os.replace(tmp, OUT)
    print(f"✅ {OUT.relative_to(ROOT)} 생성 완료")


if __name__ == "__main__":
    main()
