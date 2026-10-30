import { ServerResponse } from 'node:http';
import { parseSSE } from './sse';
import { write } from './wire';
import { Usage } from './types';
import { ProxyError, checkAbort } from './errors';

export interface NativeObservation {usage?:Usage;firstTokenAt?:number;failed:boolean;preview?:unknown;outputChars?:number;errorMessage?:string}
function usageOf(raw:any,previous?:Usage):Usage|undefined {
    if(!raw||typeof raw!=='object')return previous;
    const input=raw.input_tokens??raw.prompt_tokens??previous?.input;
    const output=raw.output_tokens??raw.completion_tokens??previous?.output;
    if(input===undefined&&output===undefined)return previous;
    if(![input??0,output??0].every(n=>Number.isSafeInteger(n)&&n>=0))return previous;
    return {input:input??0,output:output??0,cached:raw.input_tokens_details?.cached_tokens??raw.prompt_tokens_details?.cached_tokens??raw.cache_read_input_tokens??previous?.cached,reasoning:raw.output_tokens_details?.reasoning_tokens??raw.completion_tokens_details?.reasoning_tokens??previous?.reasoning,estimated:input===undefined||output===undefined};
}
/** Native events and request fields remain upstream-owned, including thinking and hosted tools. */
export async function forwardNative(response:Response,res:ServerResponse,signal:AbortSignal,sanitize:(text:string)=>string,capture=false,maxBytes=32*1024*1024,onActivity:()=>void=()=>{}):Promise<NativeObservation>{
    const observed:NativeObservation={failed:!response.ok};
    const contentType=response.headers.get('content-type')??'application/json';
    const headers:Record<string,string>={'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Copilot-Proxy-Transport':'native'};
    for(const name of ['retry-after','x-request-id','request-id']){const value=response.headers.get(name);if(value)headers[name]=value;}
    if(!response.body){res.writeHead(response.status,headers);res.end();return observed;}
    if(!contentType.includes('text/event-stream')){
        const chunks:Uint8Array[]=[];let size=0;
        for await(const chunk of response.body){checkAbort(signal);size+=chunk.byteLength;if(size>maxBytes)throw new ProxyError(502,'Native upstream response exceeds limit.','upstream_error');chunks.push(chunk);}
        const bytes=Buffer.concat(chunks);let output:Uint8Array=bytes;
        if(contentType.includes('json')){
            const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
            // Error payloads are allowed to preserve their wire structure, never credentials.
            const safe=response.ok?text:sanitize(text);output=Buffer.from(safe);
            try{const data=JSON.parse(safe);observed.usage=usageOf(data.usage);if(capture)observed.preview=data;
                observed.outputChars=(data.output??[]).reduce((sum:number,item:any)=>sum+(item.content??[]).reduce((n:number,part:any)=>n+(typeof part.text==='string'?part.text.length:0),0),0);
                if(data.error?.message)observed.errorMessage=sanitize(String(data.error.message));
            }catch{throw new ProxyError(502,'Native upstream returned invalid JSON.','upstream_error');}
        }
        res.writeHead(response.status,headers);await write(res,output,signal);res.end();return observed;
    }
    res.writeHead(response.status,{...headers,'Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
    let size=0;const captured:string[]=[];let previewSize=0;let truncated=false;
    async function* chunks(){
        for await(const chunk of response.body!){
            checkAbort(signal);onActivity();size+=chunk.byteLength;if(size>maxBytes)throw new ProxyError(502,'Native upstream stream exceeds limit.','upstream_error');
            await write(res,chunk,signal);yield chunk;
        }
    }
    for await(const event of parseSSE(chunks(),maxBytes)){
        if(event.data==='[DONE]')continue;
        let data:any;try{data=JSON.parse(event.data);}catch{continue;}
        if(capture){
            const safe=sanitize(JSON.stringify({event:event.event,payload:data},function(key,value){
                if(['authorization','x-api-key','accessToken','token','apiKey'].includes(key))return '[redacted]';
                if(['data','b64_json','partial_image_b64','image_base64'].includes(key)&&typeof value==='string')return '[inline data omitted]';
                if(key==='result'&&this?.type==='image_generation_call')return '[inline image omitted]';
                if(typeof value==='string'&&value.startsWith('data:image/'))return '[inline image omitted]';return value;
            }));
            const budget=128*1024-previewSize;
            if(budget>0){const bytes=Buffer.from(safe);const kept=bytes.subarray(0,budget);captured.push(kept.toString('utf8'));previewSize+=kept.length;if(kept.length<bytes.length)truncated=true;}
            else truncated=true;
        }
        observed.usage=usageOf(data.usage??data.response?.usage??data.message?.usage,observed.usage);
        if(data.type==='response.output_text.delta'&&typeof data.delta==='string')observed.outputChars=(observed.outputChars??0)+data.delta.length;
        if(data.type==='response.completed'&&observed.outputChars===undefined)observed.outputChars=(data.response?.output??[]).reduce((sum:number,item:any)=>sum+(item.content??[]).reduce((n:number,part:any)=>n+(typeof part.text==='string'?part.text.length:0),0),0);
        if(observed.firstTokenAt===undefined&&(data.delta?.text||data.type?.endsWith('.delta')||data.choices?.some((c:any)=>c.delta?.content||c.delta?.tool_calls)))observed.firstTokenAt=performance.now();
        if(data.type==='response.failed'||data.type==='error'||data.error){observed.failed=true;const message=data.error?.message??data.response?.error?.message;if(message)observed.errorMessage=sanitize(String(message));}
    }
    if(capture)observed.preview=captured.join('\n')+(truncated?'\n[preview truncated]':'');
    res.end();return observed;
}
