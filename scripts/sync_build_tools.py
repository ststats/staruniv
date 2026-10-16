"""공통 빌드 도구 원본(scripts/build_tools)을 따로 빌드하는 저장소로 내보낸다.

쓰는 법: python scripts/sync_build_tools.py ../synergy [--check]
사본은 여기서만 갱신하고 사본 쪽에서 직접 고치지 않는다.
"""
import argparse
import hashlib
import json
from pathlib import Path

SOURCE = Path(__file__).resolve().parent / "build_tools"
FILES = ("minify_assets.mjs", "browser_config.py", "build_scope.py")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    destination = args.target.resolve() / "scripts" / "build_tools"
    manifest = {"source": "ststats/staruniv:scripts/build_tools", "sha256": {}}
    for name in FILES:
        source = (SOURCE / name).read_text(encoding="utf-8").replace("\r\n", "\n")
        prefix = "//" if name.endswith(".mjs") else "#"
        content = f"{prefix} ststats/staruniv/scripts/build_tools/{name}에서 만든 사본. 직접 고치지 않는다.\n" + source
        manifest["sha256"][name] = hashlib.sha256(content.encode()).hexdigest()
        target = destination / name
        if args.check:
            if not target.exists() or target.read_text(encoding="utf-8") != content:
                raise SystemExit(f"사본이 원본과 다릅니다: {target}")
        else:
            destination.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8", newline="\n")
    lock = args.target / ".github" / "build-tools.json"
    if args.check:
        if json.loads(lock.read_text(encoding="utf-8")) != manifest:
            raise SystemExit("build-tools.json이 원본과 다릅니다")
    else:
        lock.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
