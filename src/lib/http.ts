import {readJson} from './request-body';
import { z } from 'zod';
import { auth } from './auth';
import { query } from './db';
import { DomainError,type Context } from './context';
export function response(data:unknown,status=200){return Response.json({data},{status,headers:{'Cache-Control':'no-store'}});}
export function failure(error:unknown){
 if(error instanceof DomainError)return Response.json({error:{code:error.code,message:error.message}},{status:error.status});
 if(error instanceof z.ZodError)return Response.json({error:{code:'VALIDATION_ERROR',message:'VALIDATION_ERROR',details:error.issues.map(i=>({path:i.path.join('.'),code:i.code}))}},{status:400});
 const authError=error as {name?:string;statusCode?:number;body?:{code?:string}};if(authError?.name==='APIError'&&authError.statusCode&&authError.statusCode<500)return Response.json({error:{code:authError.body?.code??'AUTH_REQUEST_FAILED',message:authError.body?.code??'AUTH_REQUEST_FAILED'}},{status:authError.statusCode});
 const pg=error as {code?:string};
 if(pg.code==='P0004')return Response.json({error:{code:'RETENTION_LOCKED',message:'RETENTION_LOCKED'}},{status:403});
 if(pg.code==='23505')return Response.json({error:{code:'DUPLICATE',message:'DUPLICATE'}},{status:409});
 if(pg.code==='23503'||pg.code==='23514'||pg.code==='22P02')return Response.json({error:{code:'INVALID_REFERENCE',message:'INVALID_REFERENCE'}},{status:400});
 console.error('Request failed',{name:error instanceof Error?error.name:'UnknownError',code:pg.code});
 return Response.json({error:{code:'SERVER_ERROR',message:'SERVER_ERROR'}},{status:500});
}
export function csrf(request:Request){if(['GET','HEAD','OPTIONS'].includes(request.method))return;const origin=request.headers.get('origin');const expected=new URL(process.env.APP_URL??'http://localhost:3000').origin;if(origin!==expected)throw new DomainError(403,'INVALID_ORIGIN');if(request.headers.get('sec-fetch-site')==='cross-site')throw new DomainError(403,'INVALID_ORIGIN');}
export async function context(request:Request):Promise<Context>{
 const session=await auth.api.getSession({headers:request.headers});if(!session)throw new DomainError(401,'SESSION_EXPIRED');
 const security=(await query<{must_change_password:boolean}>('SELECT must_change_password FROM account_security WHERE user_id=$1',[session.user.id]))[0];const mustChangePassword=Boolean(security?.must_change_password);if(mustChangePassword&&!['/api/me','/api/account-security'].includes(new URL(request.url).pathname))throw new DomainError(428,'PASSWORD_CHANGE_REQUIRED');
 const requested=request.headers.get('x-workspace-id');if(requested&&!z.uuid().safeParse(requested).success)throw new DomainError(400,'INVALID_WORKSPACE');
 const rows=await query<{workspace_id:string;company_id:string;roles:string[]}>('SELECT m.workspace_id,m.roles,c.id company_id FROM memberships m JOIN companies c ON c.workspace_id=m.workspace_id WHERE m.user_id=$1 AND m.status=\'active\' AND ($2::uuid IS NULL OR m.workspace_id=$2::uuid) ORDER BY m.created_at,c.created_at LIMIT 1',[session.user.id,requested]);
 if(!rows[0])throw new DomainError(403,'MEMBERSHIP_REQUIRED');const permissions=rows[0].roles.includes('admin')?[]:await query<{resource:string;operation:string;scope:string}>('SELECT resource,operation,scope FROM effective_permissions($1,$3,$2::text[])',[rows[0].workspace_id,rows[0].roles,session.user.id]);return{mustChangePassword,userId:session.user.id,workspaceId:rows[0].workspace_id,companyId:rows[0].company_id,roles:rows[0].roles,permissions};
}
export async function handle(request:Request,fn:(ctx:Context)=>Promise<unknown|Response>){try{csrf(request);const result=await fn(await context(request));if(result instanceof Response){const headers=new Headers(result.headers);headers.set('Cache-Control','no-store');return new Response(result.body,{status:result.status,statusText:result.statusText,headers});}return response(result);}catch(error){return failure(error);}}
export async function body(request:Request):Promise<Record<string,unknown>>{return z.record(z.string(),z.unknown()).parse(await readJson(request));}
