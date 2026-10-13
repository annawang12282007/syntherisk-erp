import 'dotenv/config';
import {resolve} from 'node:path';
// Resolve runtime storage before Next changes cwd to its standalone directory.
process.env.AUTH_MAIL_DIR=resolve(process.env.AUTH_MAIL_DIR??'data/auth-mail');
process.env.ATTACHMENT_DIR=resolve(process.env.ATTACHMENT_DIR??'data/attachments');
process.env.NODE_ENV='production';
process.env.HOSTNAME=process.env.HOSTNAME??'127.0.0.1';
await import('../.next/standalone/server.js');
