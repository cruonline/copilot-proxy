import { Backend, InferenceEvent, Model, Turn, ValuePart } from '../types';
import { ProxyError, checkAbort, errorInfo } from '../errors';
import { parseSSE } from '../sse';
import { estimatedInput, object } from '../normalize';
import {prepareChatBody} from './chat-options';
import {responseRequest,responseEvents} from './responses-bridge';
import { messagesRequest, messagesEvents } from './messages-bridge';
import { claudeTools, unwrapClaudeEvents } from '../claudeTools';
export type Fetch = typeof fetch;
const allowedCopilot = new Set(['api.githubcopilot.com', 'api.individual.githubcopilot.com', 'api.business.githubcopilot.com', 'api.enterprise.githubcopilot.com']);
export function approvedURL(value: string, github = false): URL {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.search || (github ? !(url.hostname === 'api.github.com' || /^api\.[a-z0-9-]+\.ghe\.com$/.test(url.hostname)) : !(allowedCopilot.has(url.hostname) || /^copilot-api\.[a-z0-9-]+\.ghe\.com$/.test(url.hostname))))
        throw new ProxyError(502, 'Unapproved upstream origin.', 'upstream_error');
    return url;
}
type Token = {
    value: string;
    base: string;
    expires: number;
};
/** Credentials are never persisted. An epoch prevents stale refreshes restoring signed-out sessions. */
export class CopilotAuth {
    private cached?: Token;
    private refreshing?: Promise<Token>;
    private epoch = 0;
    constructor(private session: () => Promise<string>, private request: Fetch = fetch, private onSecrets: (values: string[]) => void = () => { }, private versions = { editor: '1.143.1', plugin: 'unknown' }, private accountType:()=>string=()=> 'auto', private githubApi:()=>string=()=> 'https://api.github.com') { }
    clear(): void { this.epoch++; this.cached = undefined; this.refreshing = undefined; this.onSecrets([]); }
    async get(signal: AbortSignal, force = false): Promise<Token> {
        checkAbort(signal);
        if (force) {
            this.cached = undefined;
        }
        if (this.cached && this.cached.expires > Date.now() / 1000 + 60)
            return this.cached;
        if (!this.refreshing) {
            const epoch = this.epoch;
            // One request cannot cancel a shared credential refresh for other clients.
            const pending = this.load(AbortSignal.timeout(30000)).then(token => { if (epoch !== this.epoch)
                throw new ProxyError(401, 'GitHub session changed. Run setup again.', 'authentication_error'); this.cached = token; return token; }).finally(() => { if (this.refreshing === pending)
                this.refreshing = undefined; });
            this.refreshing = pending;
        }
        const token = await this.refreshing;
        checkAbort(signal);
        return token;
    }
    private async load(signal: AbortSignal): Promise<Token> {
        const githubToken = await this.session();
        if (!githubToken)
            throw new ProxyError(401, 'Sign in to GitHub using Copilot Gateway: Setup and Authorize.', 'authentication_error');
        this.onSecrets([githubToken]);
        const response = await this.request(approvedURL(this.githubApi() + '/copilot_internal/v2/token', true), { signal, redirect: 'error', headers: { Authorization: `token ${githubToken}`, 'Accept': 'application/json', 'User-Agent': 'CopilotGateway/0.0.18', 'Editor-Version': `vscode/${this.versions.editor}`, 'Editor-Plugin-Version': `copilot-chat/${this.versions.plugin}` } });
        if (!response.ok)
            throw new ProxyError(response.status === 401 ? 401 : response.status === 403 ? 403 : 502, 'Copilot token exchange failed. Check GitHub sign-in and subscription access.', 'authentication_error');
        const data = object(await response.json());
        if (typeof data.token !== 'string' || !data.token || !Number.isFinite(data.expires_at) || data.expires_at <= Date.now() / 1000)
            throw new ProxyError(502, 'Invalid Copilot token response.', 'upstream_error');
        let base = typeof data.endpoints?.api === 'string' ? data.endpoints.api : data.token.includes('proxy-ep=proxy.enterprise.') ? 'https://api.enterprise.githubcopilot.com' : data.token.includes('proxy-ep=proxy.business.') ? 'https://api.business.githubcopilot.com' : 'https://api.githubcopilot.com';
        const account=this.accountType();
        if(account==='individual')base='https://api.githubcopilot.com';
        else if(account==='business'||account==='enterprise')base=`https://api.${account}.githubcopilot.com`;
        base = approvedURL(base).origin;
        this.onSecrets([githubToken, data.token]);
        return { value: data.token, base, expires: data.expires_at };
    }
    debugToken():unknown {return {token:this.cached?.value??null,expires_at:this.cached?.expires??null};}
    async usage(signal:AbortSignal):Promise<unknown>{
        const githubToken=await this.session();if(!githubToken)throw new ProxyError(401,'Sign in to GitHub before requesting quota information.','authentication_error');
        this.onSecrets([githubToken,...(this.cached?[this.cached.value]:[])]);
        const response=await this.request(approvedURL(this.githubApi() + '/copilot_internal/user',true),{signal,redirect:'error',headers:{Authorization:`token ${githubToken}`,Accept:'application/json','User-Agent':'CopilotGateway/0.0.18'}});
        if(!response.ok)throw new ProxyError(response.status,`GitHub quota API returned ${response.status}.`,'upstream_error');
        return response.json();
    }
    async quota(signal:AbortSignal):Promise<unknown>{
        const token=await this.get(signal);const claims:Record<string,string>={};
        for(const part of token.value.split(';')){const eq=part.indexOf('=');if(eq>=0)claims[part.slice(0,eq).trim()]=part.slice(eq+1).trim();}
        const flags:Record<string,string>={chat:'chat',ssc:'suggestions',sn:'snippy',malfil:'malicious_filter',editor_preview_features:'editor_preview_features',agent_mode:'agent_mode',agent_mode_auto_approval:'agent_mode_auto_approval',mcp:'mcp',ccr:'code_review',client_byok:'bring_your_own_key',blackbird_external_indexing:'external_indexing'};
        const features:Record<string,boolean>={};for(const [key,label] of Object.entries(flags))if(key in claims)features[label]=!['0','false',''].includes(claims[key]!);
        return {auth_ok:true,sku:claims.sku??'unknown',account_type:this.accountType(),proxy_endpoint:claims['proxy-ep']??token.base,token_expires_at:token.expires,features};
    }
}
function content(parts: ValuePart[]): any[] { return parts.map(p => p.kind === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } }); }
export function upstreamBody(turn: Turn): any {
    const messages: any[] = [];
    for (const m of turn.messages) {
        let pending: ValuePart[] = [];
        let calls: any[] = [];
        const flush = () => { if (!pending.length && !calls.length)
            return; messages.push({ role: m.role, content: pending.length ? content(pending) : null, ...(calls.length ? { tool_calls: calls } : {}) }); pending = []; calls = []; };
        for (const p of m.parts) {
            if (p.kind === 'result') {
                flush();
                messages.push({ role: 'tool', tool_call_id: p.id, content: content(p.error ? [{ kind: 'text', text: 'Tool returned an error.' }, ...p.content] : p.content) });
            }
            else if (p.kind === 'call')
                calls.push({ id: p.id, type: 'function', function: { name: p.name, arguments: p.arguments } });
            else
                pending.push(p);
        }
        flush();
    }
    return { model: turn.model, messages, stream: true, ...(turn.tools.length ? { tools: turn.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })), tool_choice: turn.choice } : {}), ...(turn.maxTokens !== undefined ? { max_tokens: turn.maxTokens } : {}), ...(turn.temperature !== undefined ? { temperature: turn.temperature } : {}), ...(turn.topP !== undefined ? { top_p: turn.topP } : {}), ...(turn.stop ? { stop: turn.stop } : {}), ...(turn.reasoningEffort ? { reasoning_effort: turn.reasoningEffort } : {}) };
}
export class DirectBackend implements Backend {
    readonly kind = 'direct' as const;
    private catalog?:Model[];
    constructor(private auth: CopilotAuth, private request: Fetch = fetch, private versions = { editor: '1.143.1', plugin: 'unknown' }) { }
    private async fetch(path: string, signal: AbortSignal, init: RequestInit = {}, allowErrors=false): Promise<Response> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const token = await this.auth.get(signal, attempt === 1);
            const url = approvedURL(token.base + path);
            const extras:Record<string,string>={};
            const incoming=new Headers(init.headers);for(const name of ['anthropic-version','anthropic-beta','openai-beta']){const value=incoming.get(name);if(value)extras[name]=value;}
            if(path.startsWith('/messages')&&!extras['anthropic-version'])extras['anthropic-version']='2023-06-01';
            const response = await this.request(url, { ...init, signal, redirect: 'error', headers: { ...extras,'Authorization': `Bearer ${token.value}`, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'User-Agent': 'CopilotGateway/0.0.18', 'Editor-Version': `vscode/${this.versions.editor}`, 'Editor-Plugin-Version': `copilot-chat/${this.versions.plugin}`, 'Copilot-Integration-Id': 'vscode-chat','X-Github-Api-Version':'2025-04-01', 'X-Request-Id': crypto.randomUUID() } });
            if (response.status === 401 && attempt === 0) {
                await response.body?.cancel();
                continue;
            }
            if (!response.ok && !allowErrors) {
                let detail = '';
                if (response.status === 400 && response.body) {
                    // Read only a bounded diagnostic; errorInfo exposes recognized
                    // validation errors and keeps arbitrary provider content private.
                    const reader = response.body.getReader();
                    const chunks: Uint8Array[] = [];
                    let size = 0;
                    try {
                        while (size < 65536) {
                            const chunk = await reader.read();
                            if (chunk.done) break;
                            size += chunk.value.byteLength;
                            if (size < 65536) chunks.push(chunk.value);
                        }
                    } finally { await reader.cancel(); reader.releaseLock(); }
                    if (size < 65536) {
                        const rejection = errorInfo(new Error(Buffer.concat(chunks).toString('utf8')));
                        if (rejection.status === 400) throw rejection;
                        detail = Buffer.concat(chunks).toString('utf8').replace(/\s+/g, ' ').slice(0, 300);
                    }
                }
                await response.body?.cancel();
                const status = [401, 403, 404, 429].includes(response.status) ? response.status : 502;
                throw new ProxyError(status, `Copilot returned HTTP ${response.status}. Check model availability, permissions and quota.${detail ? " Upstream: " + detail : ""}`, status === 429 ? 'rate_limit_error' : 'upstream_error');
            }
            return response;
        }
        throw new ProxyError(401, 'Copilot authentication failed.', 'authentication_error');
    }
    async listModels(signal: AbortSignal): Promise<Model[]> {
        const response = await this.fetch('/models', signal);
        const body = object(await response.json());
        if (!Array.isArray(body.data))
            throw new ProxyError(502, 'Invalid upstream model catalog.', 'upstream_error');
        this.catalog=body.data.filter((m: any) => m && typeof m.id === 'string').map((m: any) => ({ id: m.id, name: typeof m.name === 'string' ? m.name : m.id,family:typeof m.family==='string'?m.family:undefined,kind:['embedding','embeddings'].includes(m.capabilities?.type)?'embedding':'chat',endpoints:Array.isArray(m.supported_endpoints)?m.supported_endpoints.filter((p:unknown)=>typeof p==='string'):undefined,upstream:m,reasoningEfforts:Array.isArray(m.capabilities?.supports?.reasoning_effort)?m.capabilities.supports.reasoning_effort.filter((e:unknown)=>typeof e==='string'):undefined, ...(Number.isSafeInteger(m.capabilities?.limits?.max_prompt_tokens) && m.capabilities.limits.max_prompt_tokens > 0 ? { contextWindow: m.capabilities.limits.max_prompt_tokens } : {}), access: 'authorized', capabilities: { images: typeof m.capabilities?.supports?.vision === 'boolean' ? m.capabilities.supports.vision : 'unknown', tools: typeof m.capabilities?.supports?.tool_calls === 'boolean' ? m.capabilities.supports.tool_calls : 'unknown', generationControls: true, usage: 'upstream' } }));
        return this.catalog!;
    }
    /** Drop an effort the upstream model does not list; Copilot rejects it with HTTP 400. */
    private supportedEffort(modelId: unknown, effort: unknown): boolean {
        const list = this.catalog?.find(m => m.id === modelId)?.reasoningEfforts;
        return typeof effort !== 'string' || !list || !list.length || list.includes(effort);
    }
    private sanitizeNativeBody(body: unknown): unknown {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
        const b = { ...(body as Record<string, any>) };
        if (!this.supportedEffort(b.model, b.reasoning_effort)) delete b.reasoning_effort;
        if (b.reasoning && typeof b.reasoning === 'object' && !this.supportedEffort(b.model, b.reasoning.effort)) {
            const { effort: _dropped, ...rest } = b.reasoning;
            if (Object.keys(rest).length) b.reasoning = rest; else delete b.reasoning;
        }
        // Prefixes describe the item type, not the model family. In particular,
        // freeform apply_patch is a custom tool call, not a function call.
        if (Array.isArray(b.input)) {
            b.input = b.input.map((item: any) => {
                if (!item || typeof item !== 'object' || typeof item.id !== 'string') return item;
                const prefix = item.type === 'custom_tool_call' ? 'ctc_' : item.type === 'function_call' ? 'fc_' : undefined;
                if (!prefix || !/^(fc_|ctc_)/.test(item.id)) return item;
                return { ...item, id: prefix + item.id.replace(/^(fc_|ctc_)/, '') };
            });
        }
        return b;
    }
    /** Ritesh-style upstream forwarding, extended to native Responses/Messages. */
    async nativeRequest(path:string,body:unknown,signal:AbortSignal,headers:Record<string,string>={},method='POST'):Promise<Response>{
        if(!/^\/(?:chat\/completions|responses(?:\/(?:compact|[A-Za-z0-9_-]{1,256}))?|messages(?:\/count_tokens)?|embeddings|completions|models(?:\/[A-Za-z0-9_.-]{1,256})?)$/.test(path))throw new ProxyError(400,'Unsupported native upstream path.');
        if(path==='/chat/completions'||path==='/responses')body=this.sanitizeNativeBody(body);
        if(path==='/chat/completions'&&body&&typeof body==='object')body=prepareChatBody(body as Record<string,unknown>);
        return this.fetch(path,signal,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})},true);
    }
    async embeddings(body:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{const response=await this.nativeRequest('/embeddings',body,signal);if(!response.ok)throw new ProxyError(response.status,`Copilot embeddings returned HTTP ${response.status}.`,'upstream_error');return response.json();}
    usage(signal:AbortSignal):Promise<unknown>{return this.auth.usage(signal);}
    quota(signal:AbortSignal):Promise<unknown>{return this.auth.quota(signal);}
    tokenDebug():unknown{return this.auth.debugToken();}
    refreshToken():void{this.auth.clear();}
    async *chat(turn: Turn, signal: AbortSignal): AsyncGenerator<InferenceEvent> {
        const adapted = claudeTools(turn);
        yield* unwrapClaudeEvents(this.chatRaw(adapted.turn, signal), adapted.wrapped);
    }
    private async *chatRaw(turn: Turn, signal: AbortSignal): AsyncGenerator<InferenceEvent> {
        const model=this.catalog?.find(m=>m.id===turn.model);if(turn.reasoningEffort&&!this.supportedEffort(turn.model,turn.reasoningEffort))turn={...turn,reasoningEffort:undefined};
        if (model?.endpoints?.includes('/messages') && !model.endpoints.includes('/chat/completions') && !model.endpoints.includes('/responses')) {
            const response = await this.fetch('/messages', signal, { method: 'POST', body: JSON.stringify(messagesRequest(turn)) });
            yield* messagesEvents(response, signal); return;
        }
        if(model?.endpoints?.includes('/responses')&&!model.endpoints.includes('/chat/completions')){
            // The Responses bridge is the normal Direct-mode path for GPT and
            // Claude models. Normalize prior gateway output IDs here too; the
            // nativeRequest helper is not involved in this path.
            const request = this.sanitizeNativeBody(responseRequest(turn));
            const response=await this.fetch('/responses',signal,{method:'POST',body:JSON.stringify(request)});yield* responseEvents(response,signal);return;
        }
        const response = await this.fetch('/chat/completions', signal, { method: 'POST', body: JSON.stringify(prepareChatBody(upstreamBody(turn))) });
        if (!response.body)
            throw new ProxyError(502, 'Missing Copilot response body.', 'upstream_error');
        const media = response.headers.get('content-type') ?? '';
        if (!media.includes('text/event-stream'))
            throw new ProxyError(502, 'Copilot did not return an event stream.', 'upstream_error');
        let completed = false;
        let finishSeen = false;
        for await (const event of parseSSE(response.body as unknown as AsyncIterable<Uint8Array>)) {
            checkAbort(signal);
            if (event.data === '[DONE]') {
                completed = true;
                break;
            }
            let data: any;
            try {
                data = JSON.parse(event.data);
            }
            catch {
                throw new ProxyError(502, 'Invalid upstream SSE JSON.', 'upstream_error');
            }
            if (data.error)
                throw new ProxyError(502, 'Copilot stream reported an error.', 'upstream_error');
            if (data.usage)
                yield { kind: 'usage', usage: { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0, cached: data.usage.prompt_tokens_details?.cached_tokens, reasoning: data.usage.completion_tokens_details?.reasoning_tokens, estimated: false } };
            for (const c of data.choices ?? []) {
                if (c.index !== undefined && c.index !== 0)
                    throw new ProxyError(502, 'Unexpected multiple upstream choices.', 'upstream_error');
                const delta = c.delta ?? {};
                if (typeof delta.content === 'string' && delta.content)
                    yield { kind: 'text', text: delta.content };
                if (delta.reasoning_content)
                    turn.warnings.push('upstream_reasoning_not_exposed');
                for (const call of delta.tool_calls ?? [])
                    yield { kind: 'tool', index: call.index, id: call.id, name: call.function?.name, arguments: call.function?.arguments };
                if (c.finish_reason) {
                    if (!['stop', 'tool_calls', 'length', 'content_filter'].includes(c.finish_reason))
                        throw new ProxyError(502, 'Unsupported upstream finish reason.', 'upstream_error');
                    finishSeen = true;
                    yield { kind: 'finish', reason: c.finish_reason };
                }
            }
        }
        if (!completed && !finishSeen)
            throw new ProxyError(502, 'Copilot stream ended prematurely.', 'upstream_error');
    }
    async countTokens(turn: Turn, _signal: AbortSignal): Promise<{
        input: number;
        estimated: boolean;
    }> { return { input: estimatedInput(turn), estimated: true }; }
    dispose(): void { this.auth.clear(); }
}
