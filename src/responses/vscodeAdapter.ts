import type * as vscode from 'vscode';
import { Turn, ValuePart, InferenceEvent } from './types';
import { checkAbort, ProxyError } from './errors';
import { claudeTools, unwrapClaudeArguments } from './claudeTools';

export function responseMessages(turn: Turn, api: typeof vscode): vscode.LanguageModelChatMessage[] {
    const value = (part: ValuePart) => part.kind === 'text' ? new api.LanguageModelTextPart(part.text) : new api.LanguageModelDataPart(Buffer.from(part.data, 'base64'), part.mime);
    const messages: vscode.LanguageModelChatMessage[] = [];
    for (const message of turn.messages) {
        const parts = message.parts.map(part => part.kind === 'call' ? new api.LanguageModelToolCallPart(part.id, part.name, JSON.parse(part.arguments)) :
            part.kind === 'result' ? new api.LanguageModelToolResultPart(part.id, part.content.map(value)) : value(part));
        const role = message.role === 'assistant' ? api.LanguageModelChatMessageRole.Assistant : api.LanguageModelChatMessageRole.User;
        if (message.role === 'system') turn.warnings.push('system_instructions_mapped_to_user_role');
        const previous = messages.at(-1);
        if (previous?.role === role) previous.content.push(...parts);
        else messages.push(new api.LanguageModelChatMessage(role, parts));
    }
    return messages;
}

type Send = (model: vscode.LanguageModelChat, requested: string, messages: vscode.LanguageModelChatMessage[], options: vscode.LanguageModelChatRequestOptions, token: vscode.CancellationToken) => Promise<{ response: vscode.LanguageModelChatResponse; model: vscode.LanguageModelChat }>;
export async function* inferResponses(turn: Turn, signal: AbortSignal, getModel: (id: string) => Promise<vscode.LanguageModelChat | undefined>, send: Send, api: typeof vscode): AsyncGenerator<InferenceEvent> {
    checkAbort(signal);
    const model = await getModel(turn.model);
    if (!model) throw new ProxyError(503, 'No Copilot models available. Sign into Copilot and refresh models.', 'service_unavailable');
    const requested = turn.model;
    turn.model = model.id;
    const adapted = claudeTools(turn);
    const source = new api.CancellationTokenSource();
    const cancel = () => source.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try {
        checkAbort(signal);
        const options: vscode.LanguageModelChatRequestOptions = {};
        if (turn.tools.length) {
            options.tools = adapted.turn.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters }));
            options.toolMode = turn.choice === 'required' ? api.LanguageModelChatToolMode.Required : api.LanguageModelChatToolMode.Auto;
        }
        const { response, model: actual } = await send(model, requested, responseMessages(adapted.turn, api), options, source.token);
        turn.model = actual.id;
        const calls: vscode.LanguageModelToolCallPart[] = [];
        const stream = response.stream ?? (async function* () { for await (const text of response.text) yield new api.LanguageModelTextPart(text); })();
        for await (const part of stream) {
            checkAbort(signal);
            if (part instanceof api.LanguageModelTextPart) yield { kind: 'text', text: part.value };
            else if (part instanceof api.LanguageModelToolCallPart) calls.push(part);
            else if (!turn.warnings.includes('vscode_non_text_parts_omitted')) turn.warnings.push('vscode_non_text_parts_omitted');
        }
        checkAbort(signal);
        for (const [index, call] of calls.entries()) yield { kind: 'tool', index, id: call.callId, name: call.name, arguments: unwrapClaudeArguments(JSON.stringify(call.input), call.name, adapted.wrapped) };
        yield { kind: 'finish', reason: calls.length ? 'tool_calls' : 'stop' };
    } finally {
        source.cancel();
        signal.removeEventListener('abort', cancel);
        source.dispose();
    }
}
