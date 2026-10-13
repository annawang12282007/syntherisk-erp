import {z} from 'zod';
import {DomainError} from '../lib/context';
import {assistantSystem,planSchema} from './schema';

// Pin the model and account for actual token charges in the per-user usage ledger.
// Other applications sharing the key are excluded.
export const MODEL='claude-sonnet-5-5',MAX_INPUT=100_000,MAX_OUTPUT=12_000,RESERVATION=1_000_000;
export function configuration(){
 const key=process.env.ANTHROPIC_API_KEY?.trim();
 const budget=Number(process.env.CLAUDE_MONTHLY_BUDGET_USD??'10');
 return {key,workspace:process.env.ANTHROPIC_WORKSPACE_ID?.trim(),model:MODEL,budgetMicrousd:Math.floor(Math.min(10,Math.max(0,Number.isFinite(budget)?budget:0))*1_000_000),configured:Boolean(key)&&(!process.env.ANTHROPIC_MODEL||process.env.ANTHROPIC_MODEL===MODEL)};
}
export class AssistantProviderError extends DomainError{
 constructor(code:string,public uncertain=false){super(502,code);}
}
function schema(outputSchema:z.ZodType=planSchema){
 const prune=(v:unknown):unknown=>Array.isArray(v)?v.map(prune):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['$schema','minLength','maxLength','minItems','maxItems','pattern','format'].includes(k)).map(([k,x])=>[k,prune(x)])):v;
 return prune(z.toJSONSchema(outputSchema));
}
export type GenerationProfile={system:string;schema:z.ZodType};
function request(content:Record<string,unknown>[],profile?:GenerationProfile){return{model:MODEL,system:profile?.system??assistantSystem,messages:[{role:'user',content}],thinking:{type:'adaptive'},output_config:{effort:'high',format:{type:'json_schema',schema:schema(profile?.schema)}}};}
async function call(path:string,payload:unknown,paid:boolean):Promise<Record<string,unknown>>{
 const cfg=configuration();if(!cfg.configured)throw new DomainError(503,'ASSISTANT_NOT_CONFIGURED');
 let response:Response;
 try{response=await fetch('https://api.anthropic.com/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':cfg.key!,'anthropic-version':'2023-06-01',...(cfg.workspace?{'anthropic-workspace-id':cfg.workspace}:{})},body:JSON.stringify(payload),signal:AbortSignal.timeout(paid?180_000:60_000),redirect:'error'});}catch{throw new AssistantProviderError('ASSISTANT_PROVIDER_UNCERTAIN',paid);}
 if(!response.ok){await response.body?.cancel();const known=[400,401,403,404,413,422,429].includes(response.status);throw new AssistantProviderError(response.status===401||response.status===403?'ASSISTANT_CREDENTIALS':response.status===429?'ASSISTANT_PROVIDER_LIMIT':'ASSISTANT_PROVIDER_ERROR',paid&&!known);}
 // Do not log provider bodies, which can include uploaded content.
 try{let size=0;const chunks:Uint8Array[]=[];const reader=response.body!.getReader();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000){await reader.cancel();throw new Error();}chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AssistantProviderError('ASSISTANT_PROVIDER_UNCERTAIN',paid);}
}
export async function countInput(content:Record<string,unknown>[],profile?:GenerationProfile){const result=await call('messages/count_tokens',request(content,profile),false);const count=Number(result.input_tokens);if(!Number.isSafeInteger(count)||count<1||count>MAX_INPUT)throw new DomainError(422,'ASSISTANT_INPUT_TOO_LARGE');return count;}
export async function generate(content:Record<string,unknown>[],profile?:GenerationProfile){
 const result=await call('messages',{...request(content,profile),max_tokens:MAX_OUTPUT},true);
 const usage=result.usage as Record<string,unknown>|undefined,input=Number(usage?.input_tokens),output=Number(usage?.output_tokens);
 if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0)throw new AssistantProviderError('ASSISTANT_PROVIDER_UNCERTAIN',true);
 const cost=input*2+output*10; // micro-USD; output includes thinking. No cache or server tools.
 const blocks=Array.isArray(result.content)?result.content:[];
 const texts=blocks.filter((x:{type?:string})=>x.type==='text');let value:unknown;
 if(result.stop_reason==='end_turn'&&texts.length===1){try{value=JSON.parse(texts[0].text);}catch{/* Return usage even for malformed output. */}}
 return {input,output,cost,value};
}
