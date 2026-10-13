/** Used only after registry validation; aliases and parameter expressions are internal constants. */
export function coResponsiblePredicate(resource:string,alias='r',user='$3'){
 if(!/^[a-z][a-z0-9_]*$/.test(resource))throw new Error('Invalid responsibility resource');
 return `EXISTS(SELECT 1 FROM record_responsibles rr WHERE rr.workspace_id=${alias}.workspace_id AND rr.company_id=${alias}.company_id AND rr.resource='${resource}' AND rr.record_id=${alias}.id AND rr.user_id=${user})`;
}
export function responsiblePredicate(resource:string,alias='r',user='$3'){return `(${alias}.owner_id=${user} OR ${coResponsiblePredicate(resource,alias,user)})`;}

export function anyResponsiblePredicate(resource:string,alias:string,users:string){
 if(!/^[a-z][a-z0-9_]*$/.test(resource))throw new Error('Invalid responsibility resource');
 return `(${alias}.owner_id=ANY(${users}::text[]) OR EXISTS(SELECT 1 FROM record_responsibles rr WHERE rr.workspace_id=${alias}.workspace_id AND rr.company_id=${alias}.company_id AND rr.resource='${resource}' AND rr.record_id=${alias}.id AND rr.user_id=ANY(${users}::text[])))`;
}
