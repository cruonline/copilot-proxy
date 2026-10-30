import { escapeHtml, ModelInfo } from './core';

/** Reference content uses placeholders only, never the saved credential. */
export function getConnectionGuide(port: number, models: ModelInfo[], defaultModel = '', catalogPath = 'ABSOLUTE_PATH_TO_CODEX_MODELS_JSON') {
    const root = `http://127.0.0.1:${port}`;
    const model = defaultModel || models[0]?.id || 'YOUR_MODEL_ID';
    const copy = (text: string, label: string) => `<button class="secondary-btn guide-copy" data-copy="${escapeHtml(text)}">${escapeHtml(label)}</button>`;
    const sample = (language: string, text: string) => `<div class="guide-code"><div class="guide-code-bar"><span>${escapeHtml(language)}</span>${copy(text, 'Copy example')}</div><pre><code>${escapeHtml(text)}</code></pre></div>`;
    const endpoints = [
        { method: 'POST', path: '/v1/responses', alias: '/responses', name: 'Codex Responses',
            description: 'Responses API for Codex: text, function/custom tools, results, and streaming item lifecycles.',
            input: 'Send input as a string or complete ordered history, plus optional instructions and tools. Use store:false for the public VS Code backend. Native forwarding also supports opaque reasoning and upstream compaction when available.',
            output: 'JSON response with output items, or Responses SSE events ending in response.completed, response.incomplete, or response.failed.',
            example: `curl '${root}/v1/responses' -H "Authorization: Bearer $COPILOT_GATEWAY_API_KEY" -H 'Content-Type: application/json' -d '${JSON.stringify({ model, input: 'Hello!', store: false, stream: true })}'` },
        { method: 'POST', path: '/v1/chat/completions', alias: '/chat/completions', name: 'Chat completions',
            description: 'OpenAI-compatible messages, streaming, and tool calls.',
            input: 'Send messages with role and content. model is optional; stream: true enables server-sent events. Tools use the OpenAI function format.',
            output: 'JSON chat.completion with choices, or SSE chunks ending with [DONE].',
            example: `curl '${root}/v1/chat/completions' \\\n  -H "Authorization: Bearer $COPILOT_GATEWAY_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify({ model, messages: [{ role: 'user', content: 'Hello!' }], stream: false })}'` },
        { method: 'POST', path: '/v1/messages', alias: '/messages', name: 'Anthropic messages',
            description: 'Anthropic-compatible messages for Claude Code and SDKs.',
            input: 'Send messages, model, and max_tokens. stream: true enables Anthropic SSE events. Tools use the Anthropic tool format.',
            output: 'JSON message with content blocks and stop_reason, or Anthropic SSE events.',
            example: `curl '${root}/v1/messages' \\\n  -H "x-api-key: $COPILOT_GATEWAY_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: 'Hello!' }] })}'` },
        { method: 'GET', path: '/v1/models', alias: '/models', name: 'Available models',
            description: 'Find the exact model IDs available in this VS Code session.',
            input: 'No request body. Copy an id from the returned data list into your client.',
            output: 'JSON list with data entries containing id, name, vendor, and context limits.',
            example: `curl '${root}/v1/models' -H "Authorization: Bearer $COPILOT_GATEWAY_API_KEY"` },
        { method: 'GET', path: '/v1/model-catalog', alias: '/model-catalog', name: 'Codex model catalog',
            description: 'Discover current models with Codex-native capabilities and tool metadata.',
            input: 'No request body. CLI clients can use this URL as model_catalog_url. For the Desktop model picker use the automatically maintained model_catalog_json file. Uses the same API key as inference.',
            output: 'JSON models array with slug, context window, modalities, and freeform tool metadata. Returns 503 when models are unavailable.',
            example: `curl '${root}/v1/model-catalog' -H "Authorization: Bearer $COPILOT_GATEWAY_API_KEY"` },
        { method: 'GET', path: '/v1/tools', alias: '/tools', name: 'VS Code tools',
            description: 'Inspect registered tools and their input schemas.',
            input: 'Optional query parameters: tags (comma-separated) and name (name filter). Both filters can be combined.',
            output: 'JSON list with tool names, descriptions, inputSchema, and tags.',
            example: `curl '${root}/v1/tools?tags=search&name=file' -H "Authorization: Bearer $COPILOT_GATEWAY_API_KEY"` },
        { method: 'GET', path: '/health', alias: '/', name: 'Health check',
            description: 'Check the proxy connection before sending a model request.',
            input: 'No request body. Authentication is required here too.',
            output: 'JSON with status: "ok" and models_available. This does not verify provider inference.',
            example: `curl '${root}/health' -H "Authorization: Bearer $COPILOT_GATEWAY_API_KEY"` }
    ];
    const api = `<div class="guide-intro"><h2>API guide</h2><p>Choose the protocol your client speaks. Both use the same local proxy and saved key.</p></div>
        <div class="guide-protocols">
            <div><h3>OpenAI-compatible</h3><p>Base URL</p><code>${root}/v1</code>${copy(`${root}/v1`, 'Copy base URL')}<p>Authorization: Bearer &lt;saved key&gt;</p></div>
            <div><h3>Anthropic-compatible</h3><p>Base URL</p><code>${root}</code>${copy(root, 'Copy base URL')}<p>x-api-key: &lt;saved key&gt;</p></div>
        </div>
        <p class="guide-note">All routes below require a key. Aliases behave identically. Examples use Bash and read your key from COPILOT_GATEWAY_API_KEY; set it locally first.</p>
        <div class="guide-routes">${endpoints.map(endpoint => `<details class="guide-route">
            <summary><span class="guide-method">${endpoint.method}</span><code>${endpoint.path}</code><span class="guide-route-name">${endpoint.name}</span></summary>
            <div class="guide-route-body"><p>${endpoint.description}</p><p>Alias: <code>${endpoint.alias}</code></p>
            <dl><dt>Request</dt><dd>${escapeHtml(endpoint.input)}</dd><dt>Response</dt><dd>${escapeHtml(endpoint.output)}</dd></dl>
            ${copy(root + endpoint.path, 'Copy endpoint URL')}${sample('Bash', endpoint.example)}</div></details>`).join('')}</div>
        <details class="guide-route"><summary><span class="guide-method">OPTIONS</span><code>Any path</code><span class="guide-route-name">Browser preflight</span></summary>
        <div class="guide-route-body"><p>No API key required. Returns HTTP 200 with allowed methods and headers. Browser access is limited to localhost and 127.0.0.1 origins; non-local origins do not receive an allow-origin header.</p></div></details>
        <p class="guide-note">Native Responses mode additionally forwards POST /v1/responses/compact, GET/DELETE /v1/responses/{id}, and GET /v1/models/{id}. Support is determined by the upstream Copilot endpoint. Public mode returns an explicit unsupported-feature error for stored Responses and remote compaction.</p>
        <div class="guide-troubleshooting"><h3>When a request fails</h3><dl><dt>401</dt><dd>Copy the saved key from Overview and update your client. Rotating a key invalidates the old one.</dd><dt>403</dt><dd>Use a localhost browser origin or a local native client.</dd><dt>404</dt><dd>Check the method and path. Standalone embeddings, image generation, and token-counting routes are not exposed.</dd><dt>No models</dt><dd>Open Copilot Chat, confirm a model is available, then refresh models in Overview.</dd></dl><p class="guide-note">Public API compatibility has limits: system messages become user messages and generation controls are not enforced. Responses usage is estimated and labeled. Native Responses preserves upstream controls and usage.</p></div>`;

    const clients = [
        { id: 'codex', name: 'Codex', protocol: 'OpenAI', location: '~/.codex/config.toml (CODEX_HOME/config.toml when overridden)',
            note: 'Codex connects directly using Responses. For the Desktop model picker, set the top-level model_catalog_json to the automatically maintained catalog path shown below. The installed app-server returns an empty model/list with URL discovery alone. The file updates automatically; restart Codex to reload it. CLI API discovery is available through model_catalog_url. Set COPILOT_GATEWAY_API_KEY to the saved key in the process launching Codex. For Windows Desktop, persist that user environment variable, fully quit/reopen Codex, and start a new chat. Public mode uses complete history and local compaction. For native reasoning history/compaction, authorize GitHub and set copilotGateway.responsesBackend to direct. Upstream capabilities depend on your model/account.', language: 'TOML',
            code: `model = ${JSON.stringify(model)}\nmodel_provider = "copilot_gateway"\nweb_search = "disabled"\nmodel_catalog_json = ${JSON.stringify(catalogPath)}\n\n[model_providers.copilot_gateway]\nname = "Copilot Gateway"\nbase_url = ${JSON.stringify(root + '/v1')}\nenv_key = "COPILOT_GATEWAY_API_KEY"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n\n[model_providers.copilot_gateway.capabilities]\nremote_compaction = "unsupported"\nexternal_web_access = false` },
        { id: 'claude-desktop', name: 'Claude Desktop', protocol: 'Anthropic', location: 'Claude Desktop third-party gateway configuration (Claude-3p)',
            note: 'Install Claude Desktop and fully quit it, including the tray process. Configure gateway lets you choose three distinct models and edit their dropdown labels, then writes the root URL, saved proxy key and inferenceModels list to the local Claude-3p configuration. Existing preferences and gateway entries are preserved and original files backed up. Relaunch Claude Desktop after setup or restoration. No Ollama or Python is required. This uses an unofficial, version-dependent gateway schema; chat uses /v1/messages and features requiring other endpoints may not work. Key rotation requires configuring the gateway again. The gateway credential is stored in a local JSON file.', language: 'Setup checklist',
            code: `1. Start Copilot Gateway and select an available default model.\n2. Fully quit Claude Desktop.\n3. Click Configure gateway below; choose three models and their dropdown labels.\n4. Review and save, then relaunch Claude Desktop and select one of your models.\n\nGateway base URL: ${root}/\nAuthentication: bearer (saved proxy key)\nRestore: click Restore previous configuration below.` },
        { id: 'openai-python', name: 'OpenAI Python', protocol: 'OpenAI', location: 'Python application',
            note: 'Install the openai package. Set COPILOT_GATEWAY_API_KEY in your environment to the saved key.', language: 'Python',
            code: `import os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    base_url=${JSON.stringify(root + '/v1')},\n    api_key=os.environ["COPILOT_GATEWAY_API_KEY"],\n)\nresponse = client.chat.completions.create(\n    model=${JSON.stringify(model)},\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(response.choices[0].message.content)` },
        { id: 'openai-js', name: 'OpenAI JavaScript', protocol: 'OpenAI', location: 'Node.js application',
            note: 'Install the openai package. Use this in a local Node.js process, not a public browser bundle.', language: 'JavaScript',
            code: `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: ${JSON.stringify(root + '/v1')},\n  apiKey: process.env.COPILOT_GATEWAY_API_KEY,\n});\nconst response = await client.chat.completions.create({\n  model: ${JSON.stringify(model)},\n  messages: [{ role: "user", content: "Hello!" }],\n});\nconsole.log(response.choices[0].message.content);` },
        { id: 'claude-ps', name: 'Claude Code · PowerShell', protocol: 'Anthropic', location: 'PowerShell session before running claude',
            note: 'Paste the saved key in place of YOUR_SAVED_API_KEY. Uses the root URL, not /v1. Only Messages is implemented; features needing other Anthropic endpoints may not work.', language: 'PowerShell',
            code: `$env:ANTHROPIC_BASE_URL = '${root}'\n$env:ANTHROPIC_AUTH_TOKEN = 'YOUR_SAVED_API_KEY'\nRemove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue\n$env:ANTHROPIC_MODEL = '${model.replace(/'/g, "''")}'\nclaude` },
        { id: 'claude-bash', name: 'Claude Code · Bash', protocol: 'Anthropic', location: 'Bash / Zsh session before running claude',
            note: 'Paste the saved key in place of YOUR_SAVED_API_KEY. These variables affect only this shell and its child processes. Extra Anthropic endpoints are not implemented.', language: 'Bash',
            code: `export ANTHROPIC_BASE_URL='${root}'\nexport ANTHROPIC_AUTH_TOKEN='YOUR_SAVED_API_KEY'\nunset ANTHROPIC_API_KEY\nexport ANTHROPIC_MODEL='${model.replace(/'/g, "'\\''")}'\nclaude` },
        { id: 'anthropic-python', name: 'Anthropic Python', protocol: 'Anthropic', location: 'Python application',
            note: 'Install the anthropic package. Set COPILOT_GATEWAY_API_KEY in your environment to the saved key.', language: 'Python',
            code: `import os\nfrom anthropic import Anthropic\n\nclient = Anthropic(\n    base_url=${JSON.stringify(root)},\n    api_key=os.environ["COPILOT_GATEWAY_API_KEY"],\n)\nmessage = client.messages.create(\n    model=${JSON.stringify(model)},\n    max_tokens=1024,\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(message.content[0].text)` },
        { id: 'cline', name: 'Cline / Roo Code', protocol: 'OpenAI', location: 'Client settings → API provider → OpenAI Compatible',
            note: 'Enter the values below in the client settings. Setting names vary by client version. Use Chat Completions, not the Responses API.', language: 'Settings checklist',
            code: `Provider: OpenAI Compatible\nBase URL: ${root}/v1\nAPI key: YOUR_SAVED_API_KEY\nModel ID: ${model}\nAPI: Chat Completions` },
        { id: 'langchain', name: 'LangChain Python', protocol: 'OpenAI', location: 'Python application',
            note: 'Install langchain-openai. Set COPILOT_GATEWAY_API_KEY to the saved key before running.', language: 'Python',
            code: `import os\nfrom langchain_openai import ChatOpenAI\n\nllm = ChatOpenAI(\n    base_url=${JSON.stringify(root + '/v1')},\n    api_key=os.environ["COPILOT_GATEWAY_API_KEY"],\n    model=${JSON.stringify(model)},\n)\nprint(llm.invoke("Hello!").content)` }
    ];
    const setup = `<div class="guide-intro"><h2>Connect a client</h2><p>Choose a client, copy its example, then supply your saved key locally. Examples never include your actual key.</p></div>
        <div class="guide-setup-toolbar"><label for="guideModel">Model ID</label><input id="guideModel" class="setting-input" value="${escapeHtml(model)}" readonly />${copy(model, 'Copy model ID')}<button class="secondary-btn" id="clientCopyKeyBtn">Copy Saved Key</button></div>
        <p class="guide-note">${models.length ? 'Model IDs come from this session. The configured default is preferred.' : defaultModel ? 'Using your configured default model. No models have been discovered yet; verify this ID after refreshing models in Overview.' : 'No models discovered yet. Replace YOUR_MODEL_ID with an ID from GET /v1/models, or refresh models in Overview.'} Changing the port or default model refreshes these examples. Restart a running server after changing its port. No client files or settings are changed automatically.</p>
        <div class="guide-client-layout"><nav class="guide-client-nav" aria-label="Client configurations">${clients.map((client, i) => `<button class="guide-client-choice" data-client="${client.id}" aria-controls="client-${client.id}" aria-pressed="${i === 0}">${client.name}</button>`).join('')}</nav>
        <div>${clients.map((client, i) => `<section id="client-${client.id}" class="guide-client-panel" ${i ? 'hidden' : ''} aria-labelledby="heading-${client.id}"><h3 id="heading-${client.id}">${client.name}</h3><p class="guide-location">${client.location}</p><p>${client.note}</p>
        <dl class="guide-client-facts"><dt>Base URL</dt><dd><code>${root}${client.protocol === 'OpenAI' ? '/v1' : ''}</code></dd><dt>Authentication</dt><dd>${client.protocol === 'OpenAI' ? 'Bearer token' : 'Bearer token or x-api-key'}</dd></dl>
        ${sample(client.language, client.code)}${client.id === 'claude-desktop' ? '<p><button class="secondary-btn" id="setupClaudeGatewayBtn">Configure gateway</button> <button class="secondary-btn" id="restoreClaudeGatewayBtn">Restore previous configuration</button></p>' : ''}${client.id === 'codex' ? '<p>Reference: <a href="https://developers.openai.com/codex/config-reference/">Official Codex configuration</a></p>' : ''}</section>`).join('')}</div></div><p id="guideCopyStatus" role="status" aria-live="polite"></p>`;
    return { api, setup };
}

export const connectionGuideStyles = `
    [hidden] { display: none !important; }
    button, input { font-family: inherit; }
    .guide-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-widget-border); margin-bottom: 24px; }
    .guide-tab, .guide-client-choice { font: inherit; color: var(--vscode-foreground); background: transparent; border: 0; cursor: pointer; }
    .guide-tab { padding: 10px 16px; border-bottom: 2px solid transparent; }
    .guide-tab[aria-selected="true"] { border-bottom-color: var(--vscode-focusBorder); color: var(--vscode-textLink-foreground); }
    .guide-tab:hover, .guide-client-choice:hover { background: var(--vscode-list-hoverBackground); }
    button:focus-visible, summary:focus-visible, input:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 3px; }
    .guide-intro { margin-bottom: 24px; max-width: 72ch; }
    .guide-intro h2 { font-size: 1.5em; font-weight: 600; margin-bottom: 6px; }
    .guide-intro p, .guide-note, .guide-location { color: var(--vscode-descriptionForeground); }
    .guide-protocols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; background: var(--vscode-textCodeBlock-background); padding: 20px; }
    .guide-protocols h3, .guide-client-panel h3, .guide-troubleshooting h3 { font-size: 1.1em; margin-bottom: 8px; }
    .guide-protocols code { display: block; margin: 4px 0 10px; overflow-wrap: anywhere; }
    .guide-protocols p:last-child { margin-top: 12px; }
    .guide-note { margin: 16px 0 24px; max-width: 78ch; }
    .guide-route { border-bottom: 1px solid var(--vscode-widget-border); }
    .guide-route summary { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; padding: 16px 4px; cursor: pointer; }
    .guide-route summary::before { content: '+'; width: 10px; }
    .guide-route[open] summary::before { content: '−'; }
    .guide-method { min-width: 64px; font-size: 0.85em; font-weight: 600; color: var(--vscode-textLink-foreground); }
    .guide-route-name { margin-left: auto; color: var(--vscode-descriptionForeground); }
    .guide-route-body { padding: 0 20px 20px; }
    .guide-route-body p { margin-bottom: 10px; max-width: 76ch; }
    .guide-route dl, .guide-troubleshooting dl, .guide-client-facts { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 8px 16px; margin: 16px 0; }
    .guide-route dt, .guide-troubleshooting dt, .guide-client-facts dt { font-weight: 600; }
    .guide-code { margin-top: 20px; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-widget-border); border-radius: 4px; overflow: hidden; }
    .guide-code-bar { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--vscode-widget-border); }
    .guide-code pre { padding: 16px; overflow-x: auto; tab-size: 2; }
    .guide-route .guide-code pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    .guide-code code, .guide-route code, .guide-protocols code, .guide-client-facts code { font-family: var(--vscode-editor-font-family); font-size: 0.95em; }
    .guide-troubleshooting { margin-top: 28px; }
    .guide-setup-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    .guide-setup-toolbar input { flex: 1; min-width: 140px; width: auto; }
    .guide-client-layout { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 28px; align-items: start; }
    .guide-client-layout > * { min-width: 0; }
    .guide-client-nav { display: flex; flex-direction: column; gap: 4px; }
    .guide-client-choice { text-align: left; padding: 10px 12px; border-radius: 4px; }
    .guide-client-choice[aria-pressed="true"] { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .guide-client-panel > p { margin-bottom: 12px; max-width: 72ch; }
    #guideCopyStatus { min-height: 24px; margin-top: 12px; }
    @media (max-width: 650px) {
        .guide-tabs { overflow-x: auto; } .guide-tab { white-space: nowrap; padding: 10px 12px; }
        .guide-protocols, .guide-client-layout { grid-template-columns: 1fr; gap: 16px; }
        .guide-client-nav { flex-direction: row; overflow-x: auto; padding-bottom: 8px; }
        .guide-client-choice { flex-shrink: 0; } .guide-route-name { margin-left: 26px; width: 100%; }
        .guide-route summary code { overflow-wrap: anywhere; } .guide-route-body { padding: 0 4px 16px; }
        .guide-route dl, .guide-troubleshooting dl, .guide-client-facts { grid-template-columns: 1fr; gap: 4px; }
        .guide-route dd, .guide-troubleshooting dd, .guide-client-facts dd { margin-bottom: 10px; }
    }
`;

export const connectionGuideScript = `
    const guideTabs = Array.from(document.querySelectorAll('[data-guide-tab]'));
    const clientChoices = Array.from(document.querySelectorAll('[data-client]'));
    const guideState = vscode.getState?.() || {};
    function selectGuideTab(id, focus = false) {
        if (!guideTabs.some(tab => tab.dataset.guideTab === id)) id = 'overview';
        guideTabs.forEach(tab => {
            const active = tab.dataset.guideTab === id;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            document.getElementById('panel-' + tab.dataset.guideTab).hidden = !active;
            if (active && focus) tab.focus();
        });
        hideApiKey();
        guideState.tab = id;
        vscode.setState?.({ tab: guideState.tab, client: guideState.client });
    }
    guideTabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectGuideTab(tab.dataset.guideTab));
        tab.addEventListener('keydown', event => {
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % guideTabs.length;
            if (event.key === 'ArrowLeft') next = (index + guideTabs.length - 1) % guideTabs.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = guideTabs.length - 1;
            if (next !== undefined) { event.preventDefault(); selectGuideTab(guideTabs[next].dataset.guideTab, true); }
        });
    });
    function selectClient(id) {
        if (!clientChoices.some(choice => choice.dataset.client === id)) id = 'openai-python';
        clientChoices.forEach(choice => {
            const active = choice.dataset.client === id;
            choice.setAttribute('aria-pressed', String(active));
            document.getElementById('client-' + choice.dataset.client).hidden = !active;
        });
        guideState.client = id;
        vscode.setState?.({ tab: guideState.tab, client: guideState.client });
    }
    clientChoices.forEach(choice => choice.addEventListener('click', () => selectClient(choice.dataset.client)));
    document.querySelectorAll('.guide-copy').forEach(button => button.addEventListener('click', () => {
        vscode.postMessage({ command: 'copyGuide', text: button.dataset.copy });
    }));
    document.getElementById('clientCopyKeyBtn').addEventListener('click', () => vscode.postMessage({ command: 'copyApiKey' }));
    document.getElementById('setupClaudeGatewayBtn').addEventListener('click', () => vscode.postMessage({ command: 'setupClaudeGateway' }));
    document.getElementById('restoreClaudeGatewayBtn').addEventListener('click', () => vscode.postMessage({ command: 'restoreClaudeGateway' }));
    window.addEventListener('message', event => {
        if (event.data.command === 'guideCopyResult') {
            document.getElementById('guideCopyStatus').textContent = event.data.text;
        }
        if (event.data.command === 'apiKeyResult') document.getElementById('guideCopyStatus').textContent = event.data.text;
    });
    selectGuideTab(guideState.tab || 'overview');
    selectClient(guideState.client || 'openai-python');
`;
