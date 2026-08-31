"""
scripts/ 폴더는 파이썬 패키지가 아니라(레포 구조상 __init__.py도 없고, GitHub
Actions에서 각 스크립트를 python scripts/xxx.py로 직접 실행하는 방식이라) 테스트에서
그냥 import하려면 sys.path에 직접 넣어줘야 한다. conftest.py는 pytest가 테스트를
수집하기 전에 자동으로 먼저 읽는 파일이라, 여기서 한 번만 경로를 잡아두면 tests/
아래 모든 테스트 파일이 별도 설정 없이 scripts/ 안의 모듈을 바로 import할 수 있다.
"""

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
