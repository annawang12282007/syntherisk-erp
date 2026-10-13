export interface Context { mustChangePassword?:boolean; userId:string; workspaceId:string; companyId:string; roles:string[]; permissions?:{resource:string;operation:string;scope:string}[] }
export class DomainError extends Error { constructor(public status:number, public code:string, message?:string){super(message??code);this.name='DomainError';} }
export const hasRole=(ctx:Context,...roles:string[])=>ctx.roles.some(role=>roles.includes(role));
export function requireRole(ctx:Context,...roles:string[]){if(!hasRole(ctx,...roles))throw new DomainError(403,'FORBIDDEN');}
