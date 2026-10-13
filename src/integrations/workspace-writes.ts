import {cloudManagePlan,writeCloudManage} from './cloud-library';
import {drivePermissionPlan,writeDrivePermission} from './drive-permissions';
import {cloudExportPlan,writeCloudExport} from './cloud-export';
import {DomainError} from '../lib/context';
import {type Session,type Data} from './workspace-core';
import {meetingPlan,writeMeeting} from './meeting-workspace';
import {mailPlan,sendOrSave} from './gmail';
import {drivePlan,writeDrive,sheetsPlan,writeSheet,docsPlan,writeDoc} from './files-workspace';
import {importPlan,commitWorkspaceImport,peopleWritePlan,writePerson} from './workspace-imports';
export async function planOperation(s:Session,kind:string,input:Data):Promise<Data>{
 if(kind==='cloud_manage')return cloudManagePlan(s,input);
 if(kind==='cloud_export')return cloudExportPlan(s,input);
 if(kind==='drive_permission')return drivePermissionPlan(s,input);
 if(kind==='meeting_save')return meetingPlan(s,input);
 if(kind==='gmail_send'||kind==='gmail_remote_draft')return mailPlan(s,kind,input);
 if(kind==='drive_upload')return drivePlan(s,input);
 if(kind==='sheet_export')return sheetsPlan(s,input);
 if(kind==='doc_generate')return docsPlan(s,input);
 if(kind==='import')return importPlan(s,input);
 if(kind==='people_write')return peopleWritePlan(s,input);
 throw new DomainError(422,'UNKNOWN_OPERATION');
}
export async function performOperation(s:Session,kind:string,input:Data,id:string,preview:Data):Promise<unknown>{
 if(kind==='cloud_manage')return writeCloudManage(s,id,preview);
 if(kind==='cloud_export')return writeCloudExport(s,id,preview as Awaited<ReturnType<typeof cloudExportPlan>>);
 if(kind==='drive_permission')return writeDrivePermission(s,preview);
 if(kind==='meeting_save')return writeMeeting(s,input,id,preview);
 if(kind==='gmail_send'||kind==='gmail_remote_draft')return sendOrSave(s,kind,input,preview);
 if(kind==='drive_upload')return writeDrive(s,input,preview);
 if(kind==='sheet_export')return writeSheet(s,preview);
 if(kind==='doc_generate')return writeDoc(s,id,preview);
 if(kind==='import')return commitWorkspaceImport(s,preview);
 if(kind==='people_write')return writePerson(s,preview);
 throw new DomainError(422,'UNKNOWN_OPERATION');
}
