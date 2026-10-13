import {handle} from '@/lib/http';
import {approvalInbox} from '@/domain/approval-inbox';
export async function GET(request:Request){return handle(request,approvalInbox);}
