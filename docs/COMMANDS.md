# Commands and Activation Reference

Documents all extension commands and activation events.

---

## Commands

The extension contributes seven commands accessible via the Command Palette, under the independent `copilot-gateway.*` namespace.

### copilot-gateway.start

**Title:** Copilot Gateway: Start Server

**Description:** Starts the HTTP proxy server.

**Behavior:**

1. Reads port from settings
2. Creates HTTP server bound to `127.0.0.1`
3. Loads available models from Copilot
4. Updates status bar and panel
5. Shows success/error notification

**Error Cases:**

- Port already in use: Shows error message
- Server already running: Shows info message

---

### copilot-gateway.stop

**Title:** Copilot Gateway: Stop Server

**Description:** Stops the HTTP proxy server.

**Behavior:**

1. Closes HTTP server
2. Updates status bar and panel
3. Shows success notification

**Error Cases:**

- Server not running: Shows info message

---

### copilot-gateway.status

**Title:** Copilot Gateway: Show Status

**Description:** Opens the status webview panel.

**Behavior:**

1. Refreshes model cache
2. Creates or reveals webview panel
3. Shows:
   - Server status (running/stopped)
   - Available models
   - API endpoints
   - Settings
   - Request logs (if enabled)

---

## Command Registration

### copilot-gateway.authorizeDirectResponses

**Title:** Copilot Gateway: Authorize Native Codex Responses

Explicitly obtains GitHub `read:user` session consent for the optional native Responses backend. Set `copilotGateway.responsesBackend` to `direct` afterwards. HTTP requests use silent session lookup and cannot open consent.

### copilot-gateway.exportCodexCatalog

**Title:** Copilot Gateway: Export Codex Model Catalog

Exports discovered model metadata to a chosen JSON file. Set its absolute path as `model_catalog_json` in Codex config.toml to enable Copilot model context limits and freeform patch-tool metadata.

### copilot-gateway.setupClaudeGateway

**Title:** Copilot Gateway: Configure Claude Desktop Gateway

Choose an available model and confirm the gateway URL, target directories, and local credential storage. Backs up and writes Claude Desktop third-party gateway configuration using the saved proxy key. Requires a local VS Code window; fully quit Claude Desktop first and relaunch afterwards.

### copilot-gateway.restoreClaudeGateway

**Title:** Copilot Gateway: Restore Claude Desktop Configuration

After confirmation, restores the three original files from the first setup backup in each detected directory. Later edits to those files are replaced; unrelated library files are preserved. Does nothing when no backup exists. Fully quit and relaunch Claude Desktop around restoration.

Commands are registered in `activate()`:

```typescript
context.subscriptions.push(
    vscode.commands.registerCommand('copilot-gateway.start', startServer),
    vscode.commands.registerCommand('copilot-gateway.stop', stopServer),
    vscode.commands.registerCommand('copilot-gateway.status', showStatus),
    vscode.commands.registerCommand('copilot-gateway.setupClaudeGateway', () => configureClaudeDesktop()),
    vscode.commands.registerCommand('copilot-gateway.restoreClaudeGateway', () => configureClaudeDesktop(true))
);
```

---

## Activation Events

### onStartupFinished

**Location:** `package.json` -> `activationEvents`

```json
{
  "activationEvents": [
    "onStartupFinished"
  ]
}
```

**Description:** Extension activates after VS Code startup completes.

**Behavior:**

1. Creates output channel
2. Creates status bar item
3. Registers commands
4. Sets up model change listener
5. Auto-starts server (if `autoStart: true`)

---

## Extension Lifecycle

### activate(context)

**Called:** When extension activates (onStartupFinished)

**Actions:**

1. Create output channel for logging
2. Create status bar item
3. Register all commands
4. Subscribe to model changes
5. Check autoStart setting
6. Start server if autoStart enabled

**Code:**

```typescript
export function activate(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('Copilot Gateway');
    context.subscriptions.push(outputChannel);
    outputChannel.show(true);

    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right, 100
    );
    statusBarItem.command = 'copilot-gateway.status';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-gateway.start', startServer),
        vscode.commands.registerCommand('copilot-gateway.stop', stopServer),
        vscode.commands.registerCommand('copilot-gateway.status', showStatus)
    );

    // Listen for model changes
    context.subscriptions.push(
        vscode.lm.onDidChangeChatModels(() => {
            log('Chat models changed, refreshing...');
            refreshModels();
        })
    );

    // Auto-start
    const config = vscode.workspace.getConfiguration('copilotGateway');
    if (config.get<boolean>('autoStart', true)) {
        startServer();
    }
}
```

---

### deactivate()

**Called:** When extension deactivates (VS Code closing)

**Actions:**

1. Close HTTP server
2. Dispose webview panel
3. Log deactivation

**Code:**

```typescript
export function deactivate(): void {
    if (server) {
        server.close();
        server = null;
    }
    if (statusPanel) {
        statusPanel.dispose();
        statusPanel = undefined;
    }
    log('Extension deactivated');
}
```

---

## Status Bar Interaction

The status bar item triggers `copilot-gateway.status` when clicked.

**States:**

| State | Text | Icon |
|-------|------|------|
| Running | `Copilot Gateway: 8080` | `$(radio-tower)` |
| Stopped | `Copilot Gateway: Off` | `$(circle-slash)` |

**Tooltip:**

- Shows running state
- Shows model count
- Shows "Click to show status"

---

## Webview Message Commands

The status panel webview sends these commands:

| Command | Description | Handler Action |
|---------|-------------|----------------|
| `start` | Start server | Call `startServer()` |
| `stop` | Stop server | Call `stopServer()` |
| `copy` | Copy URL | Write to clipboard |
| `showLogs` | Show output | Reveal output channel |
| `openSettings` | Open settings | Execute VS Code command |
| `updateSetting` | Change setting | Update configuration |
| `refreshModels` | Reload models | Call `refreshModels()` |
| `clearLogs` | Clear request logs | Reset log array |

---

## Command Palette Entries

Commands appear in Command Palette with these titles:

- `Copilot Gateway: Start Server`
- `Copilot Gateway: Stop Server`
- `Copilot Gateway: Show Status`

To invoke: `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
