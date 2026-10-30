# Claude gateway and client guides completion

**Completed:** 2026-10-30 UTC+1
**Completed By:** pseku

Added Codex and Claude Desktop client guides plus native Claude Desktop setup/restore actions. Setup uses the existing saved proxy key, configured port, and an available model. Exact original configuration backups survive repeated setup and key rotation. Unrelated preferences and gateway entries are preserved.

Current Codex requires Responses support, absent from this proxy. The guide explicitly documents this limit and provides an adapter-dependent configuration reference. Claude Desktop uses an unofficial upstream gateway schema; live client inference was not exercised.

Validation: TypeScript compilation, lint, repository tests, and documentation checks. Added filesystem tests for restoration, repeated setup, malformed JSON, unrelated files, and platform paths, plus guide content/button-dispatch checks.
