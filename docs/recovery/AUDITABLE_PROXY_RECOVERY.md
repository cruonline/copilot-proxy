# Auditable Copilot Proxy recovery

Recovered the deleted `C:\Projects\copilot-proxy` on 2026-10-30 by copying its intact Recycle Bin directory to the original path. Recycle Bin contents were retained. Source, tests, dependencies, artifacts, vendor references, and documentation are available again. The installed `local-auditable.auditable-copilot-proxy-0.2.0` extension was not modified.

The recovered project compiles and passes all 55 original tests. Its source includes public and native Responses implementations, custom/namespaced tools, freeform patch support, native reasoning/compaction, and Codex CLI/Desktop configuration export. All 37 source/test files were SHA-256 compared against the retained Recycle Bin originals: zero mismatches.

Installed-package static analysis used REA Evidence `ev_a6d316ee1ef9e1e516c3a99d445dfe295feee70a3ec15570b421c1c39ff80740`. That analysis establishes packaged implementation structure, not observed inference. Recovered full TypeScript superseded decompilation as the implementation source.

The current repository ports those capabilities as Copilot Gateway. Its installed Codex CLI 0.166.0-alpha.5.1 fixture completed three requests, read a fixture, changed `before` to `after` using freeform `apply_patch`, consumed the results, and exited 0. See `codex-client-validation.json`. The fixture uses a separate temporary Codex home and deterministic local inference; personal configuration and live Copilot subscriptions were not used.
