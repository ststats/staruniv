"""배포 범위 판단을 실제 Git 객체로 확인한다(다시 쓴 이력 포함)."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/build_tools/build_scope.py"


class BuildScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "--quiet")
        self.git("config", "user.name", "Scope Test")
        self.git("config", "user.email", "scope@example.invalid")
        (self.root / ".github").mkdir()
        (self.root / ".github/build-paths.json").write_text('["templates/**"]', encoding="utf-8")
        self.before = self.commit("README.md", "initial")

    def git(self, *args):
        return subprocess.check_output(
            ["git", *args], cwd=self.root, stderr=subprocess.PIPE, text=True
        ).strip()

    def commit(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        self.git("add", ".")
        self.git("commit", "--quiet", "-m", "fixture")
        return self.git("rev-parse", "HEAD")

    def scope(self, before, event="push"):
        event_path = self.root / "event.json"
        output = self.root / "output.txt"
        event_path.write_text(json.dumps({"before": before}), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(SCRIPT)], cwd=self.root,
            env=dict(os.environ, GITHUB_EVENT_PATH=str(event_path), GITHUB_OUTPUT=str(output),
                     GITHUB_EVENT_NAME=event, GITHUB_SHA=self.git("rev-parse", "HEAD")),
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return output.read_text(encoding="utf-8").strip()

    def test_missing_previous_commit_builds(self):
        self.assertEqual(self.scope("1" * 40), "deploy=true")

    def test_initial_push_builds(self):
        self.assertEqual(self.scope("0" * 40), "deploy=true")

    def test_manual_dispatch_builds(self):
        self.assertEqual(self.scope("", "workflow_dispatch"), "deploy=true")

    def test_changed_template_builds(self):
        self.commit("templates/page.html", "page")
        self.assertEqual(self.scope(self.before), "deploy=true")

    def test_documentation_only_skips_build(self):
        self.commit("README.md", "documentation")
        self.assertEqual(self.scope(self.before), "deploy=false")


if __name__ == "__main__":
    unittest.main()
