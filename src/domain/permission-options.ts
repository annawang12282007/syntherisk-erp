import {isRetiredResource} from './retired-features';
import {resources} from './registry';
export const builtinRoles=['admin','operations','finance','reviewer','member','external'];
export const scopeOptions=['all','created','responsible','assigned','granted','none'];
export function permittedOperations(resource:string):string[]{
 if(resource==='workforce')return ['read','clock','schedule','payroll'];
 if(isRetiredResource(resource))return [];
 if(['team_directory','team_private'].includes(resource))return ['read','edit'];
 if(resource==='team_boards')return ['create'];
 if(resource==='google_integrations')return ['connect'];
 if(resource==='analytics')return ['read','export'];
 if(resource==='announcements')return ['read','create','edit','publish'];
 const definition=resources[resource];
 if(resource==='*')return ['read','create','edit','export'];
 if(!definition)return [];
 const actions=definition.actions??[];
 return [...new Set(['read',...(!definition.readonly?['create','edit',...(!definition.parent&&!definition.hidden&&definition.module!=='settings'&&definition.module!=='finance'?['delete','delete_review']:[])]:[]),'export',...(actions.includes('approve')?['approve']:[]),...(actions.includes('pay')||actions.includes('refund')?['pay']:[]),...(actions.includes('post')||actions.includes('reverse')?['post']:[]),...actions.filter(action=>!['approve','pay','post','refund','reverse'].includes(action)).map(action=>`action:${action}`)])];
}
export function normalizeScopes(scopes:string[]){
 const values=[...new Set(scopes)];
 if(!values.length||values.some(value=>!scopeOptions.includes(value)&&value!=='own'))throw new Error('INVALID_POLICY_SCOPE');
 if(values.includes('none')&&values.length!==1||values.includes('all')&&values.length!==1)throw new Error('EXCLUSIVE_POLICY_SCOPE');
 return values.sort().join(',');
}
