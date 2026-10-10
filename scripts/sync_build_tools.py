"""Export the canonical tools to an independently buildable repository.

Usage: python scripts/sync_build_tools.py ../synergy [--check]
Generated copies must be updated here, never edited independently.
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
        content = f"{prefix} Generated from ststats/staruniv/scripts/build_tools/{name}; do not edit.\n" + source
        manifest["sha256"][name] = hashlib.sha256(content.encode()).hexdigest()
        target = destination / name
        if args.check:
            if not target.exists() or target.read_text(encoding="utf-8") != content:
                raise SystemExit(f"outdated generated tool: {target}")
        else:
            destination.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8", newline="\n")
    lock = args.target / ".github" / "build-tools.json"
    if args.check:
        if json.loads(lock.read_text(encoding="utf-8")) != manifest:
            raise SystemExit("outdated build-tools manifest")
    else:
        lock.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
