# Connection Guide

**Status:** Implemented
**Last Updated:** 2026-10-30 by pseku

## Intent and design

Help local developers choose the correct protocol and configure a client without leaving the status panel. Preserve Overview and existing key management; add API guide and Client setup tabs.

The design is a protocol workbench, not a marketing dashboard. A paired base-URL reference is the signature element; method/path rows expand into request, response, and example details. Client selection sits beside the active configuration. All text is left aligned, with native VS Code typography and editor monospace only for paths and code. Spacing follows a 4/8/16/24 scale. No external fonts, images, or dependencies.

Palette roles use the active theme. Dark preview values: canvas #1f1f1f, code surface #292929, text #cccccc, secondary text #a8a8a8, rule #454545, link #75beff. These are preview values only, not forced application colors. Review rejected a generic card grid in favor of a protocol pair, route list, and client navigation matched to the actual connection task.

## Behavior

- API guide covers POST chat completions/messages, GET models/tools/health, every alias, and unauthenticated OPTIONS. Include tool filter parameters, streaming behavior, auth errors, unsupported endpoints, and compatibility caveats.
- Client setup provides nine selectable configurations: Codex, Claude Desktop, OpenAI Python, OpenAI JavaScript, Claude Code PowerShell, Claude Code Bash, Anthropic Python, Cline/Roo Code, and LangChain Python. Codex uses the recovered Responses implementation and model catalog; Claude Desktop provides explicit native setup/restore actions. See `../codex-responses/design.md` and `../claude-desktop-gateway/design.md`.
- Base URLs follow the configured port. Examples prefer the configured default model, otherwise a discovered model, otherwise YOUR_MODEL_ID. Unknown models require user replacement.
- Copy examples via the extension clipboard bridge. Never insert the saved key into snippets or HTML; use environment variables and placeholders. A separate Copy Saved Key action reuses secure key management.
- Persist only selected tab and client in webview state. Tab changes hide revealed keys; panel regeneration preserves navigation without preserving credentials. Tabs support arrow keys, Home, and End. Native details elements support keyboard expansion.
- Reference and examples remain available while stopped. Port/default-model edits refresh the guide; a running server still needs restarting after a port change.

## Verification

Test rendered route coverage, escaping, non-default ports, empty models, tab/client navigation, keyboard focus, copy messages, and secret-free persisted state. Run the existing key-management integration tests against the expanded inline script. Render desktop/tablet/mobile previews in a real headless browser and inspect screenshots. Live provider inference is not implied by these checks.
