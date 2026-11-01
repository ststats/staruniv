# Shared build tools

This directory is the canonical editable source for StarUniv and Synergy:

- `minify_assets.mjs`: AST-checked JS, CSS and HTML minification; optional owned-asset manifest updates.
- `browser_config.py`: normalized public Supabase configuration, atomic output.
- `build_scope.py`: deployment path selection; tests still run for every main push.

Synergy keeps generated copies so a clean checkout builds without a sibling repository or a network fetch of executable source. They are distribution copies, not separately maintained implementations. This deliberately retains the distributed files rather than pretending cross-repository duplication disappears.

After changing the canonical source, run from StarUniv:

```sh
python scripts/sync_build_tools.py ../synergy
python scripts/sync_build_tools.py ../synergy --check
```

Commit the source changes and generated Synergy changes together with its `.github/build-tools.json`. That manifest pins the complete SHA-256 of each distributed file; Synergy CI rejects edits that do not match it. The `--check` command checks both generated content and metadata against the canonical source. There is no runtime source fallback or dependency on another local checkout.

Each repository owns `.github/build-paths.json`. Build calls the reusable tests once for each main push, then deploys only when these paths change. Manual dispatch and pushes whose previous commit is unavailable (such as rewritten history) always build after tests pass. PRs use Test directly. Other scope detection errors prevent deployment.
