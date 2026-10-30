# Configuration Reference

Complete reference for all VS Code Copilot Gateway settings.

---

## Settings Overview

All settings are prefixed with `copilotGateway.` in VS Code settings.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `port` | number | 8090 | Server port |
| `autoStart` | boolean | true | Start on activation |
| `defaultModel` | string | "" | Default model ID |
| `logRequestsToUI` | boolean | false | Show requests in UI |
| `rawLogging` | boolean | false | Verbose output logging |
| `responsesBackend` | string | "vscode" | Public VS Code adapter or opt-in native Copilot Responses (`"direct"`) |

The `copilotGateway.*` namespace is independent of the original fork's `copilotProxy.*`. Native Responses requires explicit GitHub authorization and upstream endpoint support; see [Codex setup](CODEX_SETUP.md). If multiple proxy extensions run together, give them different ports.

---

## Detailed Settings

### copilotGateway.port

**Type:** `number`
**Default:** `8090`
**Range:** 1-65535

The port number the HTTP proxy server listens on.

**Example:**

```json
{
    "copilotGateway.port": 9090
}
```

**Notes:**

- Server binds to `127.0.0.1` (localhost only)
- Changing port requires server restart
- Port conflicts show error notification

---

### copilotGateway.autoStart

**Type:** `boolean`
**Default:** `true`

Automatically start the proxy server when VS Code launches.

**Example:**

```json
{
    "copilotGateway.autoStart": false
}
```

**Notes:**

- Uses `onStartupFinished` activation event
- Can manually start via command palette

---

### copilotGateway.defaultModel

**Type:** `string`
**Default:** `""` (empty - use first available)

Default model to use when not specified in API request.

**Example:**

```json
{
    "copilotGateway.defaultModel": "copilot-gpt-4"
}
```

**Notes:**

- Leave empty to use first available model
- Can be model ID or partial name
- Uses fuzzy matching (e.g., "claude" matches Claude models)

---

### copilotGateway.logRequestsToUI

**Type:** `boolean`
**Default:** `false`

Log all API requests and responses to the status panel UI.

**Example:**

```json
{
    "copilotGateway.logRequestsToUI": true
}
```

**Notes:**

- Shows request logs in status panel table
- Includes: time, model, message count, I/O chars, duration, status
- Maximum 50 entries stored
- Clear logs via panel button

---

### copilotGateway.rawLogging

**Type:** `boolean`
**Default:** `false`

Log raw request/response content to the output channel.

**Example:**

```json
{
    "copilotGateway.rawLogging": true
}
```

**Notes:**

- Very verbose - may impact performance
- Logs full JSON request bodies
- Logs full response content
- Useful for debugging

---

## Internal Constants

These values are defined in code and not configurable via settings.

| Constant | Value | Location | Description |
|----------|-------|----------|-------------|
| `MAX_REQUEST_BODY_SIZE` | 10MB | core.ts | Maximum request size |
| `REQUEST_TIMEOUT_MS` | 120000 (2min) | core.ts | Request timeout |
| `KEEP_ALIVE_TIMEOUT_MS` | 65000 | core.ts | Connection keep-alive |
| `HEADERS_TIMEOUT_MS` | 60000 | core.ts | Headers timeout |
| `MODEL_CACHE_TTL_MS` | 60000 (1min) | core.ts | Model cache TTL |
| `MAX_REQUEST_LOGS` | 50 | extension.ts | Max log entries |

---

## Configuration via package.json

Settings are defined in `package.json` under `contributes.configuration`:

```json
{
  "contributes": {
    "configuration": {
      "title": "Copilot Gateway",
      "properties": {
        "copilotGateway.port": {
          "type": "number",
          "default": 8090,
          "description": "Port number for the proxy server"
        }
        // ... other settings
      }
    }
  }
}
```

---

## Accessing Settings in Code

**Read settings:**

```typescript
const config = vscode.workspace.getConfiguration('copilotGateway');
const port = config.get<number>('port', 8090);
```

**Update settings:**

```typescript
const config = vscode.workspace.getConfiguration('copilotGateway');
await config.update('port', 9090, vscode.ConfigurationTarget.Global);
```

---

## Settings UI

Settings can be modified via:

1. **Settings UI:** `Ctrl+,` -> Search "copilot proxy"
2. **Settings JSON:** `Ctrl+Shift+P` -> "Preferences: Open Settings (JSON)"
3. **Status Panel:** Click settings in the webview panel

---

## Environment-Specific Settings

| Scope | File | Use Case |
|-------|------|----------|
| User | `settings.json` | Personal preferences |
| Workspace | `.vscode/settings.json` | Project-specific |

**Example workspace settings:**

```json
// .vscode/settings.json
{
    "copilotGateway.port": 9090,
    "copilotGateway.autoStart": false
}
```

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
