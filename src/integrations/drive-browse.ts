import {z} from 'zod';
const id=z.string().max(1000).regex(/^[a-zA-Z0-9_@.\-]*$/).optional();
const input=z.object({folder_id:id,drive_id:id,q:z.string().max(200).optional(),folders_only:z.boolean().optional(),shared_with_me:z.boolean().optional(),file_kind:z.enum(['','folder','document','spreadsheet','pdf','image']).optional(),modified_days:z.enum(['','7','30']).optional(),order_by:z.enum(['name','name_desc','modified','size']).optional(),page_token:z.string().max(2000).optional()});
/** Only known filters become provider query syntax; all user terms are quoted. */
export function driveBrowseQuery(value:unknown,now=new Date()){
 const d=input.parse(value),escape=(v:string)=>v.replaceAll('\\','\\\\').replaceAll("'","\\'"),mime={folder:'application/vnd.google-apps.folder',document:'application/vnd.google-apps.document',spreadsheet:'application/vnd.google-apps.spreadsheet',pdf:'application/pdf'};
 const kind=d.folders_only?'folder':d.file_kind,order={name:'name_natural',name_desc:'name_natural desc',modified:'modifiedTime desc',size:'quotaBytesUsed desc'}[d.order_by||'name'];
 const q=['trashed=false',...(d.folder_id?["'"+escape(d.folder_id)+"' in parents"]:[]),...(d.q?.trim()?["name contains '"+escape(d.q.trim())+"'"]:[]),...(d.shared_with_me?['sharedWithMe=true']:[]),...(kind?[kind==='image'?"mimeType contains 'image/'":"mimeType='"+mime[kind]+"'"]:[]),...(d.modified_days?["modifiedTime > '"+new Date(now.getTime()-Number(d.modified_days)*86400000).toISOString()+"'"]:[])].join(' and ');
 return new URLSearchParams({q,pageSize:'100',orderBy:order,supportsAllDrives:'true',includeItemsFromAllDrives:'true',fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,modifiedTime,size,owners(displayName,emailAddress),driveId,capabilities)',...(d.drive_id?{corpora:'drive',driveId:d.drive_id}:d.shared_with_me?{corpora:'user'}:!d.folder_id?{corpora:'allDrives'}:{}),...(d.page_token?{pageToken:d.page_token}:{})});
}

