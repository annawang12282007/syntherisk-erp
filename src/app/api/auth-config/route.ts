import {authMailConfigured} from '@/lib/auth-mail';
export async function GET(){return Response.json({data:{mailConfigured:authMailConfigured(),googleConfigured:process.env.GOOGLE_LOGIN_ENABLED==='true'&&Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET)}},{headers:{'Cache-Control':'no-store'}});}
