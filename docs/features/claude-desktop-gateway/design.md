# Claude Desktop gateway and Codex guides

**Status:** Complete
**Last Updated:** 2026-10-30 by pseku

## Design

Extend the existing connection guide with Codex configuration and Claude Desktop setup. Codex requires Responses, now supplied by the recovered implementation documented in `../codex-responses/design.md`. The guide distinguishes the public adapter from optional native forwarding and provides model-catalog setup.

Claude Desktop setup uses native Node filesystem APIs and the gateway schema from the linked Claude-Desktop-Router Python script. `src/claudeGateway.ts` discovers local legacy/Store Windows, macOS, and Linux paths, preserves unrelated fields, and updates only the desktop configuration, dedicated gateway record, and registry. Before setup, save exact originals or absence markers into a private per-directory backup. Retain the first backup across reconfiguration. Restore these three files rather than deleting the whole library. Parse existing JSON before mutation and roll back a directory on write failure.

`src/extension.ts` presents available models and a concrete confirmation containing the URL, model, paths, and credential-storage implications. Read the key directly from SecretStorage. Remote windows are rejected. Serialize actions with a busy flag. Expose setup/restore in both the guide and Command Palette. Do not place credentials in guide examples, errors, or persisted webview state.

## Limits and verification

The schema is unofficial and version-dependent. No live Claude Desktop inference is implied. Different directories are processed sequentially; a failure in a later directory does not undo earlier successful directories. Restore reinstates the first originals, including overwriting later edits to those three files. Tests cover exact restoration, reconfiguration, malformed JSON, preservation of unrelated files, path discovery, guide content, and button dispatch. Compile, lint, and repository tests validate integration.
