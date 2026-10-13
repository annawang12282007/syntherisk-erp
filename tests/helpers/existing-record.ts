import {expect,type APIRequestContext} from '@playwright/test';
import type {Row} from '../../src/components/types';

/** Read-only UI coverage should not depend on a particular seeded financial module. */
export async function existingReadableRecord(request:APIRequestContext,candidates=['budgets','projects','documents','contacts']){
 for(const resource of candidates){const response=await request.get(`/api/data/${resource}?pageSize=100`);if(response.status()===403)continue;expect(response.status(),`Read existing ${resource}`).toBe(200);const rows=(await response.json()).data.rows as Row[];const row=rows.find(row=>!row.archived&&!row.is_private&&row.visibility!=='restricted');if(row)return {resource,row};}
 throw new Error(`No existing readable team record in ${candidates.join(', ')}; this read-only test creates no fixture.`);
}
