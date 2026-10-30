/** Model-specific workaround ported from Ritesh's stripStreamOptionsForClaude. */
export function prepareChatBody(body:Record<string,unknown>):Record<string,unknown>{
    if(typeof body.model==='string'&&body.model.toLowerCase().includes('claude')){const {stream_options:_ignored,...rest}=body;return rest;}
    if(body.stream===true)return {...body,stream_options:{...(body.stream_options&&typeof body.stream_options==='object'?body.stream_options:{}),include_usage:true}};
    return body;
}
