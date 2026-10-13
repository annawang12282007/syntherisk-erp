import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export class ProviderError extends Error {
  constructor(public code: string, public status: number, public retryable = false) { super(code); }
}
export function networkError(error:unknown):ProviderError {
 const cause=(error as {cause?:{code?:string}})?.cause?.code;
 return ['EACCES','EPERM'].includes(cause??'')?new ProviderError('provider_network_blocked',503):new ProviderError('provider_unavailable',503,true);
}
export type Fetcher = typeof fetch;
export const SCOPES = {
  calendar: ['openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'],
  drive: ['openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.metadata.readonly'],
  meet: ['openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/meetings.space.readonly'],
  gmail: ['openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/gmail.readonly'],
  sheets: ['openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/spreadsheets.readonly','https://www.googleapis.com/auth/drive.metadata.readonly'],
  docs: ['openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/documents.readonly','https://www.googleapis.com/auth/drive.metadata.readonly'],
  forms: ['openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/forms.body.readonly','https://www.googleapis.com/auth/forms.responses.readonly'],
  people: ['openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/contacts.readonly'],
} as const;
export type Provider = keyof typeof SCOPES;
export const CAPABILITY_SCOPES: Partial<Record<Provider,Record<string,string[]>>> = {
 drive:{content:['https://www.googleapis.com/auth/drive.readonly'],manage:['https://www.googleapis.com/auth/drive']},
 meet:{artifacts:['https://www.googleapis.com/auth/drive.meet.readonly']},
 gmail:{draft:['https://www.googleapis.com/auth/gmail.compose'],send:['https://www.googleapis.com/auth/gmail.send']},
 sheets:{write:['https://www.googleapis.com/auth/spreadsheets']},
 docs:{write:['https://www.googleapis.com/auth/documents','https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/drive.readonly']},
 people:{write:['https://www.googleapis.com/auth/contacts']},
};
export function requestedScopes(provider:Provider,capability?:string):string[]{
 if(capability&&!CAPABILITY_SCOPES[provider]?.[capability])throw new ProviderError('invalid_capability',422);
 return [...new Set([...SCOPES[provider],...(capability?CAPABILITY_SCOPES[provider]![capability]:[])])];
}
export interface GoogleConfig { clientId: string; clientSecret: string; redirectUri: string; encryptionKey: string }
export interface Tokens { access_token: string; refresh_token?: string; expires_at: number; scope: string }
export function googleConfig(env: Record<string,string|undefined> = process.env): GoogleConfig {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_INTEGRATION_REDIRECT_URI, INTEGRATION_ENCRYPTION_KEY } = env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_INTEGRATION_REDIRECT_URI || !INTEGRATION_ENCRYPTION_KEY) throw new ProviderError('integration_not_configured', 503);
  if (Buffer.from(INTEGRATION_ENCRYPTION_KEY, 'base64').length !== 32) throw new ProviderError('invalid_encryption_key', 503);
  const url = new URL(GOOGLE_INTEGRATION_REDIRECT_URI);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new ProviderError('insecure_redirect_uri', 503);
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: GOOGLE_INTEGRATION_REDIRECT_URI, encryptionKey: INTEGRATION_ENCRYPTION_KEY };
}
export function seal(value: unknown, key: string, associatedData: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString('base64url')).join('.');
}
export function unseal<T>(value: string, key: string, associatedData: string): T {
  const parts = value.split('.');
  if (parts.length !== 3) throw new ProviderError('invalid_token_storage', 500);
  const [iv, tag, encrypted] = parts.map(p => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  decipher.setAAD(Buffer.from(associatedData)); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')) as T;
}
export function authorization(config: GoogleConfig, provider: Provider, capability?:string) {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: SCOPES[provider].join(' '), access_type: 'offline', prompt: 'consent select_account', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  const scopes=requestedScopes(provider,capability);
  url.searchParams.set('scope',scopes.join(' '));url.searchParams.set('include_granted_scopes','true');
  return { state, verifier, url: url.toString(),scopes };
}
export function classifyError(status: number): ProviderError {
  if (status === 401) return new ProviderError('authorization_expired', 401);
  if (status === 403) return new ProviderError('provider_permission_denied', 403);
  if (status === 404) return new ProviderError('provider_resource_not_found', 404);
  if (status === 409 || status === 412) return new ProviderError('sync_conflict', 409);
  if (status === 410) return new ProviderError('sync_token_expired', 410);
  return new ProviderError('provider_unavailable', status, status === 429 || status >= 500);
}
export class GoogleAdapter {
  constructor(public config: GoogleConfig, private fetcher: Fetcher = fetch) {}
  private async token(params: Record<string, string>): Promise<Tokens> {
    let response: Response;
    try { response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ ...params, client_id: this.config.clientId, client_secret: this.config.clientSecret }), signal: AbortSignal.timeout(20_000) }); }
    catch(error) { throw networkError(error); }
    const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
    if (!response.ok || !body.access_token) throw new ProviderError(body.error === 'invalid_grant' ? 'authorization_expired' : 'oauth_exchange_failed', response.status, response.status >= 500);
    return { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: Date.now() + Number(body.expires_in ?? 3600) * 1000, scope: body.scope ?? '' };
  }
  exchange(code: string, verifier: string) { return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: this.config.redirectUri }); }
  async refresh(tokens: Tokens): Promise<Tokens> {
    if (!tokens.refresh_token) throw new ProviderError('authorization_expired', 401);
    const refreshed=await this.token({ grant_type:'refresh_token',refresh_token:tokens.refresh_token });
    return {...tokens,...refreshed,scope:refreshed.scope||tokens.scope,refresh_token:tokens.refresh_token};
  }
  async identity(tokens:Tokens){
    let response:Response;try{response=await this.fetcher('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(20_000)});}catch(error){throw networkError(error);}
    if(!response.ok)throw classifyError(response.status);
    const user=await response.json() as {email?:string;email_verified?:boolean;sub?:string;hd?:string};
    if(!user.email||!user.sub||user.email_verified!==true)throw new ProviderError('google_identity_unverified',403);
    return {email:user.email.toLowerCase(),subject:user.sub,domain:user.hd??''};
  }
  async revoke(tokens: Tokens) {
    let response: Response;
    try { response = await this.fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: tokens.refresh_token ?? tokens.access_token }), signal: AbortSignal.timeout(20_000) }); }
    catch(error) { throw networkError(error); }
    if (!response.ok && response.status !== 400) throw classifyError(response.status);
  }
  async download(tokens:Tokens,fileId:string,exportMime?:string){
    if(!/^[A-Za-z0-9_-]+$/.test(fileId))throw new ProviderError('invalid_file_id',422);
    if(exportMime&&!['text/plain','application/pdf','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(exportMime))throw new ProviderError('invalid_export_format',422);
    const path=exportMime?`/export?mimeType=${encodeURIComponent(exportMime)}`:'?alt=media&supportsAllDrives=true';
    const response=await this.fetcher(`https://www.googleapis.com/drive/v3/files/${fileId}${path}`,{headers:{Authorization:`Bearer ${tokens.access_token}`},redirect:'error',signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw classifyError(response.status);
    if(Number(response.headers.get('content-length'))>10_000_000)throw new ProviderError('file_too_large',413);
    const reader=response.body?.getReader();if(!reader)throw new ProviderError('empty_response',502);const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10_000_000){await reader.cancel();throw new ProviderError('file_too_large',413);}chunks.push(value);}}finally{reader.releaseLock();}
    return {bytes:Buffer.concat(chunks),mime:response.headers.get('content-type')??'application/octet-stream'};
  }
  async request<T>(tokens: Tokens, path: string, init: RequestInit = {}): Promise<T> {
    let base = 'https://www.googleapis.com';
    const services:Record<string,string>={'/meet/v2/':'https://meet.googleapis.com/v2/','/gmail/v1/':'https://gmail.googleapis.com/gmail/v1/','/sheets/v4/':'https://sheets.googleapis.com/v4/','/docs/v1/':'https://docs.googleapis.com/v1/','/forms/v1/':'https://forms.googleapis.com/v1/','/people/v1/':'https://people.googleapis.com/v1/'};
    const service=Object.keys(services).find(prefix=>path.startsWith(prefix));
    if(service){base=services[service];path=path.slice(service.length);}
    else if (!path.startsWith('/calendar/v3/') && !path.startsWith('/drive/v3/') && !path.startsWith('/upload/drive/v3/')) throw new ProviderError('invalid_provider_path', 400);
    if(path.includes('..')||path.includes('\\'))throw new ProviderError('invalid_provider_path',400);
    let response: Response;
    try { response = await this.fetcher(base + path, { ...init, redirect:'error',headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(30_000) }); }
    catch(error) { throw networkError(error); }
    if (!response.ok) {
      const body=await response.json().catch(()=>({})) as {error?:{errors?:{reason?:string}[];details?:{reason?:string}[];status?:string}};
      const reasons=[...(body.error?.errors??[]),...(body.error?.details??[])].map(v=>v.reason);
      if(reasons.some(v=>['rateLimitExceeded','userRateLimitExceeded','RATE_LIMIT_EXCEEDED'].includes(v??'')))throw new ProviderError('provider_rate_limited',429,true);
      if(reasons.some(v=>['ACCESS_TOKEN_SCOPE_INSUFFICIENT','insufficientPermissions'].includes(v??'')))throw new ProviderError('scope_missing',403);
      if(reasons.some(v=>['SERVICE_DISABLED','accessNotConfigured'].includes(v??'')))throw new ProviderError('api_not_enabled',403);
      throw classifyError(response.status);
    }
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
  async calendars(tokens: Tokens) { const items: {id:string;summary:string;accessRole:string;timeZone?:string;conferenceProperties?:{allowedConferenceSolutionTypes:string[]}}[]=[];let pageToken='';do{const page=await this.request<{items?:typeof items;nextPageToken?:string}>(tokens,'/calendar/v3/users/me/calendarList?maxResults=250'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));items.push(...page.items??[]);pageToken=page.nextPageToken??'';}while(pageToken);return {items}; }
  listEvents(tokens: Tokens, calendar: string, syncToken?: string, pageToken?: string) {
    const q = new URLSearchParams({ maxResults: '250', showDeleted: 'true', singleEvents: 'false' });
    if (syncToken) q.set('syncToken', syncToken); if (pageToken) q.set('pageToken', pageToken);
    return this.request<{ items: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }>(tokens, `/calendar/v3/calendars/${encodeURIComponent(calendar)}/events?${q}`);
  }
  getEvent(tokens: Tokens, calendar: string, id: string) { return this.request<GoogleEvent>(tokens, `/calendar/v3/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(id)}`); }
  async putEvent(tokens: Tokens, calendar: string, event: GoogleEvent, etag?: string) {
    const path = `/calendar/v3/calendars/${encodeURIComponent(calendar)}/events`;
    // PATCH only ERP-owned fields; preserve attendees, attachments and existing Meet data.
    if (etag) return this.request<GoogleEvent>(tokens, `${path}/${encodeURIComponent(event.id)}?sendUpdates=none`, { method: 'PATCH', headers: { 'If-Match': etag }, body: JSON.stringify(event) });
    try { return await this.request<GoogleEvent>(tokens, `${path}?sendUpdates=none`, { method: 'POST', body: JSON.stringify(event) }); }
    catch (error) {
      // A deterministic ID makes retries safe after an uncertain successful insert.
      if (error instanceof ProviderError && error.code === 'sync_conflict') {
        const existing=await this.getEvent(tokens, calendar, event.id);
        const fields=(value:GoogleEvent)=>JSON.stringify([value.summary??'',value.description??'',value.location??'',value.start?.date??value.start?.dateTime,value.end?.date??value.end?.dateTime,value.start?.timeZone??null,value.recurrence??[]]);
        if(fields(existing)!==fields(event))throw new ProviderError('sync_conflict',409);
        return existing;
      }
      throw error;
    }
  }
  async cancelEvent(tokens: Tokens, calendar: string, id: string, etag?: string) {
    try { await this.request(tokens, `/calendar/v3/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(id)}?sendUpdates=none`, { method: 'DELETE', headers: etag ? { 'If-Match': etag } : {} }); }
    catch (error) { if (!(error instanceof ProviderError && ['provider_resource_not_found', 'sync_token_expired'].includes(error.code))) throw error; }
  }
  async drives(tokens: Tokens) {const drives:{id:string;name:string}[]=[];let pageToken='';do{const page=await this.request<{drives?:typeof drives;nextPageToken?:string}>(tokens,'/drive/v3/drives?pageSize=100'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));drives.push(...page.drives??[]);pageToken=page.nextPageToken??'';}while(pageToken);return {drives};}
  driveFiles(tokens: Tokens, driveId?: string, folderId?: string, pageToken?: string) {
    if(folderId&&!/^[A-Za-z0-9_-]+$/.test(folderId))throw new ProviderError('invalid_folder_id',422);
    const q = new URLSearchParams({ pageSize: '100', fields: 'nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,driveId,capabilities(canDownload,canEdit,canAddChildren))', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', q: `trashed = false${folderId ? ` and '${folderId.replace(/'/g, "\\'")}' in parents` : ''}` });
    if (driveId) { q.set('corpora', 'drive'); q.set('driveId', driveId); } if (pageToken) q.set('pageToken', pageToken);
    return this.request<{ files: DriveFile[]; nextPageToken?: string }>(tokens, `/drive/v3/files?${q}`);
  }
  driveFile(tokens: Tokens, id: string) { return this.request<DriveFile>(tokens, `/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,modifiedTime,driveId,capabilities(canDownload,canEdit,canAddChildren)`); }
  async upload(tokens: Tokens, folderId: string, filename: string, mimeType: string, data: Uint8Array) {
    const parent = await this.driveFile(tokens, folderId);
    if (parent.mimeType !== 'application/vnd.google-apps.folder' || !parent.capabilities?.canAddChildren) throw new ProviderError('provider_permission_denied', 403);
    const boundary = 'syntherisk_' + randomBytes(16).toString('hex');
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: filename, parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`), Buffer.from(data), Buffer.from(`\r\n--${boundary}--`)]);
    return this.request<DriveFile>(tokens, '/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,webViewLink,modifiedTime,driveId', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  }
}
export interface GoogleEvent { id: string; hangoutLink?: string; etag?: string; summary?: string; description?: string; status?: string; location?: string; start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string }; recurrence?: string[]; recurringEventId?: string; originalStartTime?: { dateTime?: string; date?: string }; extendedProperties?: { private?: Record<string, string> } }
export interface DriveFile { id: string; name: string; mimeType: string; webViewLink?: string; modifiedTime?: string; driveId?: string; capabilities?: { canDownload?: boolean; canEdit?: boolean; canAddChildren?: boolean } }
export function eventExternalId(workspaceId: string, eventId: string) { return createHash('sha256').update(`${workspaceId}:${eventId}`).digest('hex'); }
