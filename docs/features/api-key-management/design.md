# API Key Management

**Status:** Implemented
**Last Updated:** 2026-10-30 by pseku

## Behavior

- Generate a 256-bit random key on activation; persist in VS Code SecretStorage before accepting requests. Concurrent initialization shares one operation; failed initialization can be retried.
- Require Bearer authorization or x-api-key on every non-OPTIONS route, including health, models, and tools. Missing or invalid credentials produce HTTP 401 before routing or logging. Preserve localhost origin restrictions.
- Compare equal-length key buffers using timingSafeEqual. Pasted keys must contain 16-256 visible ASCII characters without spaces.
- API Key UI starts with a password field and no secret in its HTML. Reveal obtains the value through the extension bridge only on demand. Copy uses the host clipboard without sending the saved key to the webview.
- Save and Generate New Key confirm replacement and serialize UI rotations. Persist before changing the in-memory key; storage errors preserve the working key. Rotation affects new requests, not requests already in progress.
- Unsaved edits do not affect authentication. Refresh reconstructs the panel with an empty password field. No keys are stored in settings, logs, or documentation.

## Implementation

- apiKey.ts owns generation, initialization, validation, storage, and header verification without depending on the VS Code runtime.
- extension.ts integrates initialization, request authentication, and webview controls. core.ts permits the x-api-key CORS header.
- Existing clients must configure the key. Auditable Copilot Proxy is a separate extension and is not modified.

## Verification

Unit tests cover generation, persistence, failed initialization/replacement, rotation, and malformed credentials. Integration tests execute the real extension using a simulated VS Code host and real HTTP requests, checking endpoint gates and webview messages. Live VS Code installation and smoke-test results are recorded in TASKS.md.
