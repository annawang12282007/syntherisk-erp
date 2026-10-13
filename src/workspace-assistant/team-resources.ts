import type {ResourceDef} from '../domain/registry';
export const teamAssistantResources:Record<string,ResourceDef>={
 company_teams:{key:'company_teams',label:['團隊','团队','Teams'],module:'team',titleField:'name',readonly:true,fields:[{key:'name',label:['團隊名稱','团队名称','Team name'],type:'text'},{key:'description',label:['說明','说明','Description'],type:'textarea'}]},
 team_board_posts:{key:'team_board_posts',label:['團隊備忘','团队备忘','Team notes'],module:'team',titleField:'title',fields:[{key:'team_id',label:['所屬團隊','所属团队','Team'],type:'reference',ref:'company_teams',required:true},{key:'title',label:['標題','标题','Title'],type:'text',required:true},{key:'body',label:['內容','内容','Content'],type:'textarea',required:true},{key:'pinned',label:['置頂','置顶','Pinned'],type:'boolean'}]},
};
export function assistantRecordLink(resource:string,id:string){return resource==='company_teams'?`/team?section=boards&team=${encodeURIComponent(id)}`:resource==='team_board_posts'?`/team?section=boards&post=${encodeURIComponent(id)}`:`/data/${resource}?record=${id}`;}
