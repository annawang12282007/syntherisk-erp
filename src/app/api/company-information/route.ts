import {handle,body} from '@/lib/http';
import {companyInformation,saveCompanyInformation} from '@/lib/company-information';
export async function GET(r:Request){return handle(r,companyInformation);}
export async function POST(r:Request){return handle(r,async ctx=>saveCompanyInformation(ctx,await body(r)));}
