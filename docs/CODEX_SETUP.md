# Codex setup

Copilot Gateway implements `/v1/responses` for Codex, including streaming item lifecycles, function results, namespaced tools, and custom/freeform `apply_patch`. The implementation was recovered from Auditable Copilot Proxy and ported into this extension.

Open **Copilot Gateway: Show Status > Client setup > Codex** for examples following your configured port and model. Start the gateway with Copilot authenticated, then run **Copilot Gateway: Export Codex Model Catalog**. Save the JSON file and set its absolute path below; this enables appropriate tool metadata for Copilot model IDs.

## Configuration reference

Merge these fields into `~/.codex/config.toml` (or `CODEX_HOME/config.toml` if overridden). On Windows the default is `%USERPROFILE%\.codex\config.toml`. Preserve other settings. Use an available model ID, your actual port, and the exported catalog path. The provider ID is separate from Auditable Copilot Proxy's `copilot_proxy` provider.

```toml
model = "YOUR_MODEL_ID"
model_provider = "copilot_gateway"
web_search = "disabled"
model_catalog_json = "C:/path/to/copilot-models.json"

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

Request compression supports gzip, deflate, Brotli, and zstd when the VS Code Node runtime provides it. Invalid or oversized decoded bodies are rejected. A 415 on zstd requires upgrading VS Code or disabling client request compression. If using multiple proxy extensions, choose separate ports.

## Validation

The installed Codex CLI 0.166.0-alpha.5.1 passed a deterministic three-request read/edit/result workflow through this implementation on 2026-10-30. Live Copilot inference and account-specific native endpoints were not exercised. Run `npm run test:codex` to repeat the isolated client fixture; it does not alter personal Codex settings or spend Copilot quota.

Source: [Official Codex configuration reference](https://developers.openai.com/codex/config-reference/) and [advanced configuration](https://developers.openai.com/codex/config-advanced/), checked 2026-10-30.
