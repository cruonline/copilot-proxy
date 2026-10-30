import { Turn, InferenceEvent, ValuePart } from '../types';
import { parseSSE } from '../sse';
import { ProxyError,checkAbort } from '../errors';
export function responseRequest(turn:Turn):Record<string,unknown>{
    const input:any[]=[];const instructions:string[]=[];
    const value=(p:ValuePart)=>p.kind==='text'?{type:'input_text',text:p.text}:{type:'input_image',image_url:`data:${p.mime};base64,${p.data}`};
    for(const message of turn.messages){
        if(message.role==='system'){instructions.push(...message.parts.filter(p=>p.kind==='text').map(p=>p.text));continue;}
        let content:any[]=[];const flush=()=>{if(content.length){input.push({role:message.role,content});content=[];}};
        for(const part of message.parts){
            if(part.kind==='call'){flush();input.push({type:'function_call',call_id:part.id,name:part.name,arguments:part.arguments});}
            else if(part.kind==='result'){flush();input.push({type:'function_call_output',call_id:part.id,output:part.content.map(value)});}
            else content.push(part.kind==='text'?{type:message.role==='assistant'?'output_text':'input_text',text:part.text}:value(part));
        }flush();
    }
    return {model:turn.model,input,instructions:instructions.join('\n\n'),stream:true,store:false,tools:turn.tools.map(t=>({type:'function',name:t.name,description:t.description,parameters:t.parameters})),tool_choice:turn.choice,...(turn.maxTokens!==undefined?{max_output_tokens:turn.maxTokens}:{}),...(turn.temperature!==undefined?{temperature:turn.temperature}:{}),...(turn.topP!==undefined?{top_p:turn.topP}:{}),...(turn.reasoningEffort?{reasoning:{effort:turn.reasoningEffort}}:{}),...(turn.stop?{stop:turn.stop}:{})};
}
/** Preserve native argument fragments while adapting Responses-only models to legacy clients. */
export async function* responseEvents(response:Response,signal:AbortSignal):AsyncGenerator<InferenceEvent>{
    if(!response.body)throw new ProxyError(502,'Missing native Responses stream.','upstream_error');
    const tools=new Map<number,{id?:string;name?:string;arguments:string;sent:number;started:boolean}>();let textSeen=false,finished=false;
    function tool(index:number){let t=tools.get(index);if(!t){t={arguments:'',sent:0,started:false};tools.set(index,t);}return t;}
    function flush(index:number):Extract<InferenceEvent,{kind:'tool'}>|undefined{const t=tool(index);if(!t.id||!t.name)return;const delta=t.arguments.slice(t.sent);const first=!t.started;t.started=true;t.sent=t.arguments.length;return {kind:'tool',index,...(first?{id:t.id,name:t.name}:{}),arguments:delta};}
    for await(const event of parseSSE(response.body,32*1024*1024)){
        checkAbort(signal);if(event.data==='[DONE]')continue;let d:any;try{d=JSON.parse(event.data);}catch{throw new ProxyError(502,'Invalid native Responses event.','upstream_error');}
        const type=d.type??event.event;const index=d.output_index??0;
        if(type==='response.output_text.delta'){textSeen=true;yield {kind:'text',text:d.delta??''};}
        if(type==='response.output_item.added'&&d.item?.type==='function_call'){const t=tool(index);t.id=d.item.call_id;t.name=d.item.name;t.arguments=d.item.arguments??'';const out=flush(index);if(out)yield out;}
        if(type==='response.function_call_arguments.delta'){const t=tool(index);t.arguments+=d.delta??'';const out=flush(index);if(out)yield out;}
        if(type==='response.function_call_arguments.done'){const t=tool(index);const full=d.arguments??t.arguments;if(!full.startsWith(t.arguments))throw new ProxyError(502,'Native tool arguments changed unexpectedly.','upstream_error');t.arguments=full;const out=flush(index);if(out&&out.arguments)yield out;}
        if(type==='response.output_item.done'&&d.item?.type==='function_call'){
            const t=tool(index);t.id=d.item.call_id;t.name=d.item.name;const full=d.item.arguments??t.arguments;if(!full.startsWith(t.arguments))throw new ProxyError(502,'Native tool arguments changed unexpectedly.','upstream_error');t.arguments=full;const out=flush(index);if(out&&(out.arguments||out.id))yield out;
        }
        if(type==='response.failed'||type==='error'||d.error)throw new ProxyError(502,'Native Responses inference failed.','upstream_error');
        if(type==='response.completed'||type==='response.incomplete'){
            const r=d.response??{};
            for(const [i,item] of (r.output??[]).entries()){
                if(item.type==='message'&&!textSeen)for(const part of item.content??[])if(part.type==='output_text')yield {kind:'text',text:part.text};
                if(item.type==='function_call'&&!tools.get(i)?.started){const t=tool(i);t.id=item.call_id;t.name=item.name;t.arguments=item.arguments??'';const out=flush(i);if(out)yield out;}
            }
            if(r.usage)yield {kind:'usage',usage:{input:r.usage.input_tokens??0,output:r.usage.output_tokens??0,cached:r.usage.input_tokens_details?.cached_tokens,reasoning:r.usage.output_tokens_details?.reasoning_tokens,estimated:false}};
            finished=true;yield {kind:'finish',reason:type==='response.incomplete'?'length':tools.size?'tool_calls':'stop'};
        }
    }
    if(!finished)throw new ProxyError(502,'Native Responses stream ended without completion.','upstream_error');
}
