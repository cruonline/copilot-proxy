export type Protocol = 'chat' | 'responses' | 'messages' | 'completion';
export type Media = {
    kind: 'image';
    mime: 'image/png' | 'image/jpeg' | 'image/webp';
    data: string;
};
export type Text = {
    kind: 'text';
    text: string;
};
export type ValuePart = Text | Media;
export type Part = ValuePart | {
    kind: 'call';
    id: string;
    name: string;
    arguments: string;
    custom: boolean;
} | {
    kind: 'result';
    id: string;
    content: ValuePart[];
    error?: boolean;
};
export interface Message {
    role: 'system' | 'user' | 'assistant';
    parts: Part[];
}
export interface Tool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    custom: boolean;
    namespace?: string;
    wireName?: string;
}
export type Choice = 'auto' | 'none' | 'required' | {
    name: string;
};
export interface Turn {
    protocol: Protocol;
    model: string;
    messages: Message[];
    tools: Tool[];
    choice: Choice;
    stream: boolean;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stop?: string[];
    reasoningEffort?: string;
    warnings: string[];
    toolCallsExecuted?: number;
}
export interface RegisteredTool {name:string;description:string;inputSchema:Record<string,unknown>;tags?:string[]}
export interface ToolService {list():RegisteredTool[]|Promise<RegisteredTool[]>;execute(name:string,input:Record<string,unknown>,signal:AbortSignal):Promise<string>}
export interface Model {
    id: string;
    name: string;
    family?: string;
    kind?: 'chat' | 'embedding';
    endpoints?: string[];
    upstream?: Record<string, unknown>;
    contextWindow?: number;
    access?: 'authorized' | 'setup-required';
    capabilities: {
        images: boolean | 'unknown';
        tools: boolean | 'unknown';
        generationControls: boolean;
        usage: 'upstream' | 'estimated';
    };
}
export interface Usage {
    input: number;
    output: number;
    cached?: number;
    reasoning?: number;
    estimated: boolean;
}
export type Finish = 'stop' | 'tool_calls' | 'length' | 'content_filter';
export type InferenceEvent = {
    kind: 'text';
    text: string;
} | {
    kind: 'tool';
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
} | {
    kind: 'usage';
    usage: Usage;
} | {
    kind: 'finish';
    reason: Finish;
};
export interface Backend {
    readonly kind: 'public' | 'direct';
    listModels(signal: AbortSignal): Promise<Model[]>;
    chat(turn: Turn, signal: AbortSignal): AsyncIterable<InferenceEvent>;
    countTokens(turn: Turn, signal: AbortSignal): Promise<{
        input: number;
        estimated: boolean;
    }>;
    nativeRequest?(path: string, body: unknown, signal: AbortSignal, headers?: Record<string, string>, method?: string): Promise<Response>;
    embeddings?(body: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
    usage?(signal: AbortSignal): Promise<unknown>;
    quota?(signal: AbortSignal): Promise<unknown>;
    refreshToken?(): void;
    tokenDebug?(): unknown;
    dispose(): void;
}
