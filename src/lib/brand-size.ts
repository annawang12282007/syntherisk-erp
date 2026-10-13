import type {Context} from './context';
import {query} from './db';
export async function companyLogoWidth(ctx:Context){
 const [row]=await query("SELECT fields->>'logo_width' AS width FROM company_information WHERE workspace_id=$1 AND company_id=$2",[ctx.workspaceId,ctx.companyId]);
 const width=Number(row?.width);return Number.isInteger(width)&&width>=80&&width<=400?width:230;
}
