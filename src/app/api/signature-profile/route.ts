import {handle,body} from '@/lib/http';
import {getSignatureProfile,saveSignatureProfile,activateSignatureVersion,deleteSignatureVersion} from '@/lib/signature-profile';
export async function GET(request:Request){return handle(request,getSignatureProfile);}
export async function PUT(request:Request){return handle(request,async ctx=>saveSignatureProfile(ctx,await body(request)));}
export async function POST(request:Request){return handle(request,async ctx=>activateSignatureVersion(ctx,await body(request)));}

export async function DELETE(request:Request){return handle(request,async ctx=>deleteSignatureVersion(ctx,await body(request)));}
