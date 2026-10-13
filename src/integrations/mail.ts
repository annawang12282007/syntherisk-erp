import nodemailer from 'nodemailer';
import {isRichText} from '../lib/rich-text';
import {renderMail} from '../lib/mail-format';
import { ProviderError } from './adapters';

export interface MailConfig { host: string; port: number; secure: boolean; requireTLS?:boolean; from: string; user?: string; pass?: string }
export function mailConfig(env: Record<string,string|undefined> = process.env): MailConfig {
  if (!env.SMTP_HOST || !env.SMTP_FROM) throw new ProviderError('mail_not_configured', 503);
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || /[\r\n]/.test(env.SMTP_FROM)) throw new ProviderError('invalid_mail_configuration', 503);
  const local=['localhost','127.0.0.1','::1','mailpit'].includes(env.SMTP_HOST);
  if ((!local||env.NODE_ENV==='production') && env.SMTP_SECURE !== 'true' && env.SMTP_REQUIRE_TLS !== 'true') throw new ProviderError('mail_tls_required', 503);
  if(Boolean(env.SMTP_USER)!==Boolean(env.SMTP_PASSWORD))throw new ProviderError('invalid_mail_configuration',503);
  return { host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === 'true', requireTLS:env.SMTP_REQUIRE_TLS==='true',from: env.SMTP_FROM, user: env.SMTP_USER, pass: env.SMTP_PASSWORD };
}
export interface OutgoingMail { id: string; recipient: string; subject: string; text: string; sender: string }
export interface MailReceipt { messageId: string }
export interface MailTransport { send(mail: OutgoingMail): Promise<MailReceipt> }
export class SmtpTransport implements MailTransport {
  constructor(private config: MailConfig = mailConfig()) {}
  async send(mail: OutgoingMail): Promise<MailReceipt> {
    if (mail.sender !== this.config.from || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.recipient) || /[\r\n]/.test(mail.subject + mail.recipient)) throw new ProviderError('invalid_message', 400);
    const transport = nodemailer.createTransport({ host: this.config.host, port: this.config.port, secure: this.config.secure, requireTLS: this.config.requireTLS===true, tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},auth: this.config.user ? { user: this.config.user, pass: this.config.pass } : undefined, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000, disableFileAccess: true, disableUrlAccess: true });
    try {
      const receipt = await transport.sendMail({ from: this.config.from, to: mail.recipient, subject: mail.subject, text: isRichText(mail.text)?renderMail(mail.text).plain:mail.text, ...(isRichText(mail.text)?{html:renderMail(mail.text).html,attachDataUrls:true}:{}), messageId: `<${mail.id}@syntherisk.local>`, headers: { 'X-Syntherisk-Message': mail.id } });
      if (!receipt.accepted?.length || !receipt.messageId) throw new ProviderError('mail_rejected', 422);
      return { messageId: receipt.messageId };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const e = error as { command?: string; code?: string; responseCode?: number };
      // SMTP has no idempotency API. After DATA, lost acknowledgement is ambiguous and MUST NOT auto-retry.
      if (e.command === 'DATA' || (e.code === 'ETIMEDOUT' && !['CONN', 'EHLO', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(e.command ?? ''))) throw new ProviderError('mail_delivery_uncertain', 409);
      throw new ProviderError('mail_delivery_failed', e.responseCode ?? 503, e.code === 'ECONNECTION' || (e.responseCode !== undefined && e.responseCode >= 400 && e.responseCode < 500));
    } finally { transport.close(); }
  }
}
export function renderTemplate(template: string, fields: Record<string, string>): string {
  const rendered=template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    if (!(key in fields)) throw new ProviderError('unknown_template_field', 422);
    return fields[key];
  });
  if(rendered.includes('{{')||rendered.includes('}}'))throw new ProviderError('invalid_template_field',422);
  return rendered;
}
