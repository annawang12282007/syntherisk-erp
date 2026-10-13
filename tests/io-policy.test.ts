import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {query} from '../src/lib/db';
import {exportRecords,previewImport} from '../src/lib/io';
import {commitImport,list} from '../src/domain/service';
import type {Context} from '../src/lib/context';
it('export permissions intersect read access and apply beyond the first 200-row page',async()=>{
 const workspaceId=randomUUID(),companyId=randomUUID(),userId=randomUUID(),other=randomUUID();
 await query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Isolated export scope']);await query('INSERT INTO companies(id,workspace_id) VALUES($1,$2)',[companyId,workspaceId]);for(const id of[userId,other]){await query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[id,'Isolated export user',`${id}@example.invalid`]);await query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspaceId,id,['member']]);}
 await query("INSERT INTO contacts(workspace_id,company_id,created_by,updated_by,owner_id,name) SELECT $1,$2,$3,$3,$3,'Other '||g::text FROM generate_series(1,205)g",[workspaceId,companyId,other]);
 const own=(await query("INSERT INTO contacts(workspace_id,company_id,created_by,updated_by,owner_id,name) VALUES($1,$2,$3,$3,$3,'Own last record') RETURNING id",[workspaceId,companyId,userId]))[0];
 const ctx:Context={workspaceId,companyId,userId,roles:['member'],permissions:[{resource:'contacts',operation:'read',scope:'all'},{resource:'contacts',operation:'export',scope:'own'}]};
 const output=JSON.parse((await exportRecords(ctx,'contacts',{sort:'name',order:'asc'},'json')).content);expect(output.records.map((r:{id:string})=>r.id)).toEqual([own.id]);
 await expect(exportRecords({...ctx,permissions:[{resource:'contacts',operation:'export',scope:'none'}]},'contacts',{})).rejects.toMatchObject({status:403});
 await expect(exportRecords({...ctx,roles:['external'],permissions:[]},'contacts',{})).rejects.toMatchObject({status:403});
 const denied=JSON.parse((await exportRecords({...ctx,permissions:[{resource:'contacts',operation:'read',scope:'none'},{resource:'contacts',operation:'export',scope:'all'}]},'contacts',{},'json')).content);expect(denied.records).toEqual([]);
 const finance={...ctx,roles:['finance'],permissions:[]};const preview=await previewImport(finance,{resource:'bank_transactions',csv:'reference,transaction_date,currency,amount_minor\nNEGATIVE-IMPORT,2026-10-07,CAD,-1234\n',duplicate_strategy:'reject'});expect(preview.errors).toEqual([]);await commitImport(finance,preview.preview_id);expect((await list(finance,'bank_transactions')).rows[0].amount_minor).toBe('-1234');
});
