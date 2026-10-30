# Claude Desktop gateway setup

This extension implements Claude Desktop's third-party gateway configuration based on [setup-claude-gateway.py from Claude-Desktop-Router](https://github.com/mohitsoni48/Claude-Desktop-Router/blob/master/setup-claude-gateway.py). It uses the gateway schema directly in TypeScript; no Ollama or Python installation is required.

## Setup

1. Install Claude Desktop and fully quit it, including the tray process.
2. Open a local VS Code window on the same machine. Sign into Copilot and start Copilot Gateway.
3. Open **Copilot Gateway: Show Status > Client setup > Claude Desktop > Configure gateway**, or run **Copilot Gateway: Configure Claude Desktop Gateway** from the Command Palette.
4. Choose three distinct available models in order. For each model, enter its dropdown label (the model's readable name is suggested). Claude, GPT, Gemini and other available Copilot models can be mixed. Review all three names, IDs, the gateway URL and target paths, then apply. Cancelling any step writes nothing.
5. Relaunch Claude Desktop. Its dropdown lists all three configured models using your labels. Select one and send a message. Keep VS Code running. Running the configurator again suggests your last saved choices and labels.

The configured port determines the root gateway URL, for example `http://127.0.0.1:8090/`. Do not append `/v1`: the client sends Anthropic Messages requests. The extension writes the saved key as a static bearer credential, sets `deploymentMode` to `3p`, and supplies `inferenceModels` to avoid relying on model discovery.

## Paths and backups

| Installation | Claude-3p directory |
|---|---|
| Windows legacy | `%LOCALAPPDATA%\Claude-3p` |
| Windows Store | `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude-3p` |
| macOS | `~/Library/Application Support/Claude-3p` |
| Linux | `~/.config/Claude-3p` |

Existing Windows legacy and all detected Store packages are configured. Fresh Store installations are supported even if their Claude-3p directory does not exist yet. Remote VS Code windows are rejected because they would configure the remote machine.

Before modifying each directory, the extension saves the exact original content of three files in `.copilot-proxy-gateway-backup.json`: `claude_desktop_config.json`, the dedicated gateway file in `configLibrary`, and `configLibrary/_meta.json`. It records absent files too. Repeated setup preserves this first backup. Existing preferences, other registry entries, and unrelated library files are preserved. Malformed JSON causes setup to stop without replacing it. A write failure rolls back the current directory; if a later directory fails, earlier successful directories can be restored separately through the restore action.

## Restore and updates

Fully quit Claude Desktop, then click **Restore previous configuration**, or run **Copilot Gateway: Restore Claude Desktop Configuration**. Relaunch the app afterwards. Restoration reinstates the three original files exactly, removes files that were absent originally, and leaves unrelated library files alone. Later edits to those three files are replaced, as stated in the confirmation dialog. Without a backup, restore does nothing.

After key rotation or a port/model change, configure the gateway again. The key is stored in Claude Desktop's local JSON; protect that file and the backup, which can contain previous credentials. The key is never inserted into guide HTML or code examples.

## Compatibility and troubleshooting

The gateway schema is unofficial and may change with Claude Desktop versions. Linux path support does not install Claude Desktop. Chat requires `/v1/messages`; features needing other Anthropic routes, hosted account services, or unsupported content types may fail. Live inference depends on the models available through your Copilot account.

- No models: sign into Copilot, open Copilot Chat, and refresh models before setup.
- 401: configure the gateway again using the current saved key.
- Message role errors: update the extension. Desktop instruction roles (`system`, `developer`) are moved to the Anthropic system field; OpenAI tool calls and `tool` results are converted to Anthropic content blocks while retaining their IDs.
- Connection refused: start the proxy and check its configured port.
- Gateway absent: fully quit and relaunch Desktop, check the displayed configuration paths, and verify your Desktop version supports this schema.
- Setup failure: check valid JSON and file permissions. Restore any completed directory before retrying if needed.
