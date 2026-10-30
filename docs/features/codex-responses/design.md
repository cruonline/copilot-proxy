# Codex Responses and independent gateway identity

**Status:** Complete
**Last Updated:** 2026-10-30 by pseku

## Source and design

Recover `C:\Projects\copilot-proxy` from the Recycle Bin without changing its installed extension or source. Port its parser, collector, stream serializer, direct authentication/transport, native forwarder, and catalog under `src/responses`. Retain its MIT license in `docs/AUDITABLE_PROXY_LICENSE.txt` and the recovered project. The new VS Code adapter shares this extension's model matching and stale-session retry.

Public Responses supports full JSON/SSE item lifecycles, namespace identities, function calls/results, custom/freeform patch inputs, images, complete text history, bounded compressed request decoding, cancellation, and backpressure. Client tools execute in Codex. Public API limitations are explicit: no opaque reasoning/storage/remote compaction or hosted search; usage is labeled estimated.

Optional native mode forwards raw Responses and SSE, stored-response operations, remote compaction, and model discovery/detail. It obtains a separate existing GitHub session silently, exchanges memory-only upstream credentials at checked origins, and refreshes once on 401. No automatic backend switching. Native capabilities depend on upstream support. CORS/key checks precede all new routes. A dedicated command requests GitHub consent, and another exports Codex model metadata.

Rename the extension to Copilot Gateway (`local-copilot.copilot-gateway`). Use `copilot-gateway.*` commands, `copilotGateway.*` settings, `copilot_gateway` Codex provider examples, and `COPILOT_GATEWAY_API_KEY`. New icon depicts a gold lightning bolt inside turquoise gateway brackets. Default port is 8090, separate from the original's 8080 and Auditable's 4242. Existing original and Auditable installations remain intact.

## Validation

Deterministic HTTP tests cover public text/tool/history/SSE, compressed bodies, unsupported capabilities, stream failure, disconnect cancellation, native opaque forwarding and credentials. An inert VS Code fixture checks structured image/tool history and supplementary-part filtering. The installed Codex CLI completes a real shell read, freeform patch, and tool-result round trip against this gateway's deterministic backend. That confirms client transport compatibility, not live Copilot account behavior.

Recovery source/tests pass 55 tests. Current extension compilation, lint, tests, documentation and package validation are checked independently. No live Copilot inference is claimed.
