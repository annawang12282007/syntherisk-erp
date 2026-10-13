import {handle,body} from '@/lib/http';
import {journalDraft,saveJournalDraft,journalCurrencyOptions} from '@/domain/journal-drafts';
import {DomainError} from '@/lib/context';
export async function GET(request:Request){return handle(request,ctx=>{const params=new URL(request.url).searchParams;if(params.get('options')==='1')return journalCurrencyOptions(ctx);const id=params.get('id');if(!id)throw new DomainError(422,'invalid_value');return journalDraft(ctx,id);});}
export async function POST(request:Request){return handle(request,async ctx=>saveJournalDraft(ctx,await body(request)));}
