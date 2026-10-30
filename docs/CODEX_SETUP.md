# Codex setup

Copilot Gateway implements `/v1/responses` for Codex, including streaming item lifecycles, function results, namespaced tools, and custom/freeform `apply_patch`. The implementation was recovered from Auditable Copilot Proxy and ported into this extension.

Open **Copilot Gateway: Show Status > Client setup > Codex** for examples following your configured port and model, including the absolute catalog path. For the Desktop model picker, set the top-level `model_catalog_json` to the automatically maintained file. On the installed Codex build, URL discovery works with `codex exec` but the app-server's `model/list` returns an empty list; the same catalog loaded from a file populates the picker. Restart Codex after changing config or refreshing the file.

The extension generates `codex-models.json` in its global storage directory and prints the path in **Output > Copilot Gateway**. On Windows this is `%APPDATA%/Code/User/globalStorage/local-copilot.copilot-gateway/codex-models.json`. Use the expanded absolute path in TOML, not the environment variable expression. It updates on activation, successful refreshes and every five minutes. Empty or failed discovery preserves the last valid JSON.

The authenticated `/v1/model-catalog` endpoint remains available for CLI API discovery: set `model_catalog_url` inside the provider and omit the top-level file override for that workflow. Keep VS Code and the gateway running when starting Codex. The endpoint returns 503 when discovery is unavailable.

For an existing catalog path, set **Copilot Gateway: Codex Catalog Path** to its absolute JSON path. **Export Codex Model Catalog** also remembers the last exported local path and keeps it updated. Remote VS Code windows do not write local Codex catalogs. This enables appropriate tool metadata for Copilot model IDs without repeated manual exports.

## Configuration reference

Merge these fields into `~/.codex/config.toml` (or `CODEX_HOME/config.toml` if overridden). On Windows the default is `%USERPROFILE%\.codex\config.toml`. Preserve other settings. Use an available model ID and your actual port. The provider ID is separate from Auditable Copilot Proxy's `copilot_proxy` provider.

```toml
model = "YOUR_MODEL_ID"
model_provider = "copilot_gateway"
web_search = "disabled"
model_catalog_json = "C:/Users/YOUR_USER/AppData/Roaming/Code/User/globalStorage/local-copilot.copilot-gateway/codex-models.json"

[model_providers.copilot_gateway]
name = "Copilot Gateway"
base_url = "http://127.0.0.1:8090/v1"
env_key = "COPILOT_GATEWAY_API_KEY"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false

[model_providers.copilot_gateway.capabilities]
remote_compaction = "unsupported"
external_web_access = false
```

Copy the proxy's saved key from **Show Status**. Set it in the environment of the process launching Codex:

```powershell
$env:COPILOT_GATEWAY_API_KEY = 'YOUR_SAVED_API_KEY'
codex
```

```bash
export COPILOT_GATEWAY_API_KEY='YOUR_SAVED_API_KEY'
codex
```

For Windows Codex Desktop, also persist the environment variable for GUI launches:

```powershell
[Environment]::SetEnvironmentVariable('COPILOT_GATEWAY_API_KEY', 'YOUR_SAVED_API_KEY', 'User')
```

Fully quit and reopen Desktop, then start a new chat. Existing chats may retain their previous provider. Keep VS Code running and update the key after rotation.

## Public and native transports

The default `copilotGateway.responsesBackend = "vscode"` uses the public model API. Send complete history with `store:false`; hosted search, encrypted reasoning history, server-side storage, and remote compaction are explicitly unsupported. System/developer instructions become user messages. Usage is estimated and marked in response metadata. Model generation controls remain limited by VS Code.

For native capabilities, run **Copilot Gateway: Authorize Native Codex Responses**, then set `copilotGateway.responsesBackend` to `direct`. Native `/responses`, `/responses/compact`, stored response retrieval/deletion, and model discovery/detail are forwarded to Copilot without converting opaque history, tools, or SSE payloads. Authentication uses a separate existing GitHub session and memory-only upstream token; the local proxy key is never forwarded upstream. HTTP requests cannot open GitHub consent dialogs. Upstream origins and redirects are restricted.

Native support depends on the Copilot model/account and internal endpoints. It does not create hosted capabilities. Enable hosted search or remote compaction in Codex only after verifying upstream support. Direct mode applies to Responses and model discovery; existing Chat Completions and Anthropic Messages still use VS Code. This implements Codex's inference protocol, not every hosted OpenAI product API.

In direct mode, models whose catalog supports Chat Completions or Messages instead of Responses (including Claude models) use a translation adapter for `/responses`. Text, images and tool history are translated to the model's supported endpoint. Send complete history and use local compaction for these models; native storage, encrypted reasoning history and hosted tools require a model with native Responses support. Requests and errors from both transports appear in **Show Status > Request logs** when UI logging is enabled.

Claude rejects tool schemas with root-level `oneOf`, `allOf`, or `anyOf`. For Responses requests through both VS Code and direct adapters, the gateway nests these schemas inside an upstream-only `arguments` property, translates matching history, and unwraps tool calls before returning them to Codex. Tool names, IDs, original argument values and schema constraints are preserved. Other models retain their original schemas. Recognized Copilot schema rejections are shown as HTTP 400 errors with the schema diagnostic instead of a generic reconnect failure.

Request compression supports gzip, deflate, Brotli, and zstd when the VS Code Node runtime provides it. Invalid or oversized decoded bodies are rejected. A 415 on zstd requires upgrading VS Code or disabling client request compression. If using multiple proxy extensions, choose separate ports.

## Validation

The installed Codex CLI 0.166.0-alpha.5.1 fetched the catalog over authenticated HTTP and passed a deterministic three-request read/edit/result workflow with no local catalog JSON on 2026-10-30. The app-server picker check reproduces an empty `model/list` with URL-only discovery and verifies the fixture model is selectable with the automatically generated file. Run `npm run test:codex` to repeat the isolated client fixture; it asserts both the HTTP catalog request and file-backed picker result and does not alter personal Codex settings or spend Copilot quota.

Source: [Official Codex configuration reference](https://developers.openai.com/codex/config-reference/) and [advanced configuration](https://developers.openai.com/codex/config-advanced/), checked 2026-10-30.
