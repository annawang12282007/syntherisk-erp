import {test,expect,type APIRequestContext,type BrowserContext,type Page,type Locator} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {signIn} from './helpers/sign-in';
import {translate,type Locale} from '../src/locales';
import type {Preferences,Resource} from '../src/components/types';

const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,original:Preferences,record:{resource:string;id:string}|undefined;
type AuditRow=Record<string,unknown>;
test.beforeAll(async({playwright})=>{
 test.setTimeout(120000);
 const demo=JSON.parse(await readFile('data/demo-credentials.json','utf8'));
 request=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
 expect((await signIn(request,demo.users[0])).status()).toBe(200);cookies=(await request.storageState()).cookies;
 original=(await(await request.get('/api/preferences')).json()).data;
 const resources=(await(await request.get('/api/meta')).json()).data.resources as Record<string,Resource>;
 const audit=await request.get('/api/audit');expect(audit.status()).toBe(200);
 const rows=(await audit.json()).data.rows as AuditRow[];
 for(const item of rows.filter(item=>resources[String(item.resource)]&&item.record_id).slice(0,20)){
  const candidate=await request.get(`/api/data/${item.resource}/${item.record_id}`);
  if(candidate.ok()&&((await candidate.json()).data._timeline||[]).length){record={resource:String(item.resource),id:String(item.record_id)};break;}
 }
 expect(record,'A readable existing record with an audit trail is required; this suite creates no business data.').toBeTruthy();
 await mkdir('docs/qa/browser',{recursive:true});
});
test.afterAll(async()=>{if(request){if(original)expect((await request.put('/api/preferences',{data:original})).status()).toBe(200);await request.dispose();}});

async function prepare(page:Page,context:BrowserContext,locale:Locale){expect((await request.put('/api/preferences',{data:{...original,locale,timezone:'America/Los_Angeles'}})).status()).toBe(200);await context.addCookies(cookies);await page.setViewportSize({width:1440,height:1100});}
async function openAudit(page:Page,locale:Locale){await page.goto('/settings');await expect(page.locator('.settings-layout')).toBeVisible();const response=page.waitForResponse(result=>new URL(result.url()).pathname==='/api/audit'&&result.request().method()==='GET');await page.locator('.settings-nav').getByRole('button',{name:translate(locale,'audit'),exact:true}).click();const fetched=await response;expect(fetched.status()).toBe(200);await expect(page.locator('.history-timeline .history-entry').first()).toBeVisible();return(await fetched.json()).data.rows as AuditRow[];}
async function closedSummary(entry:Locator,item:AuditRow,locale:Locale){
 const t=(key:string)=>translate(locale,key),basis=String(item.actor_role_basis||'unknown');
 await expect(entry).not.toHaveAttribute('open','');await expect(entry.locator('.history-expanded')).not.toBeVisible();
 const summary=entry.locator('summary');expect(await summary.locator(':scope > *').count()).toBe(4);
 await expect(summary.locator('.history-actor')).toHaveText(basis==='system'?t('historySystem'):String(item.actor_name||item.actor||t('historyUnknownActor')));
 const time=new Date(String(item.created_at));
 await expect(summary.locator('time')).toHaveText(new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short',timeZone:'America/Los_Angeles'}).format(time));
 await expect(summary.locator('time')).toHaveAttribute('datetime',time.toISOString());
 if(basis==='current'&&Array.isArray(item.actor_roles)&&item.actor_roles.length)await expect(summary.locator('.history-roles small')).toHaveText(t('historyCurrentRole'));
 await expect(summary.locator('.history-action,.history-change-list,.history-snapshot')).toHaveCount(0);
}

for(const locale of ['zh-TW','zh-CN','en'] as Locale[]){
 test(`real audit and record activity use collapsed localized timelines in ${locale}`,async({page,context})=>{
  await prepare(page,context,locale);const writes:string[]=[];
  page.on('request',event=>{if(!['GET','HEAD','OPTIONS'].includes(event.method())&&/\/api\/(data\/|access|identity)/.test(event.url()))writes.push(event.method()+' '+new URL(event.url()).pathname);});
  const rows=await openAudit(page,locale);expect(rows.length).toBeGreaterThan(0);
  const ordered=[...rows].sort((a,b)=>new Date(String(b.created_at)).getTime()-new Date(String(a.created_at)).getTime());
  const first=page.locator('.history-entry').first();await closedSummary(first,ordered[0],locale);
  await expect(page.locator('.history-entry[open]')).toHaveCount(0);
  await first.locator('summary').focus();await page.keyboard.press('Enter');await expect(first).toHaveAttribute('open','');
  await expect(first.locator('.history-action')).toBeVisible();await expect(first.locator('pre')).toHaveCount(0);
  await page.screenshot({path:`docs/qa/browser/history-audit-${locale}.png`,fullPage:true});
  const response=page.waitForResponse(result=>new URL(result.url()).pathname===`/api/data/${record!.resource}/${record!.id}`&&result.request().method()==='GET');
  await page.goto(`/data/${record!.resource}?record=${record!.id}`);const fetched=await response;expect(fetched.status()).toBe(200);const timeline=(await fetched.json()).data._timeline as AuditRow[];
  const detail=page.getByRole('dialog');await expect(detail).toBeVisible();await detail.locator('.tabs').getByRole('button',{name:translate(locale,'activity'),exact:true}).click();
  const recordEntry=detail.locator('.history-entry').first();await expect(recordEntry).toBeVisible();await closedSummary(recordEntry,timeline[0],locale);
  await expect(detail.locator('.history-entry[open]')).toHaveCount(0);
  await recordEntry.locator('summary').click();await expect(recordEntry.locator('.history-expanded')).toBeVisible();await expect(recordEntry.locator('pre')).toHaveCount(0);
  await page.screenshot({path:`docs/qa/browser/history-record-${locale}.png`,fullPage:true});
  await detail.getByRole('button',{name:translate(locale,'close'),exact:true}).click();expect(writes).toEqual([]);
 });
}

test('intercepted presentation edge cases: snapshots, changed fields, role provenance and private metadata on a phone',async({page,context})=>{
 test.setTimeout(120000);
 const edgeRows=[
  {id:'legacy',resource:'tasks',action:'create',actor_name:'Legacy reader',actor_roles:['finance'],actor_role_basis:'current',created_at:'2026-10-06T12:00:00Z',details:{title:'Earlier note',owner_id:'legacy-reference-123',password:'NEVER_RENDER_PASSWORD',workspace_id:'NEVER_RENDER_WORKSPACE'}},
  {id:'unknown',resource:'tasks',action:'update',actor_name:null,actor_roles:[],actor_role_basis:'unknown',actor_id:'NEVER_RENDER_ACTOR',created_at:'2026-10-06T13:00:00Z',before_data:{title:'Retained'},after_data:{title:'Retained'}},
  {id:'system',resource:'tasks',action:'update',actor_name:null,actor_roles:[],actor_role_basis:'system',created_at:'2026-10-06T14:00:00Z',after_data:{title:'System task'}},
  {id:'recent',resource:'tasks',action:'update',actor_name:'Current editor',actor_roles:['member'],actor_role_basis:'event',created_at:'2026-10-06T15:00:00Z',before_data:{title:'Before title',status:'todo',owner_id:'previous-reference-123',notes:'Unchanged note',reference_notes:{project_id:'Original full unlinked project description'}},after_data:{title:'After title',status:'done',owner_id:'next-reference-123',notes:'Unchanged note',reference_notes:{project_id:'Updated full unlinked project description'},access_token:'NEVER_RENDER_TOKEN'}},
 ];
 await page.route('**/api/audit*',route=>route.fulfill({json:{data:{rows:edgeRows,page:1,pageSize:100}}}));
 for(const locale of ['zh-TW','zh-CN','en'] as Locale[]){
  const t=(key:string)=>translate(locale,key);await prepare(page,context,locale);await page.setViewportSize({width:390,height:844});await openAudit(page,locale);
  const entries=page.locator('.history-entry');await expect(entries).toHaveCount(4);await expect(entries.locator('.history-actor')).toHaveText(['Current editor',t('historySystem'),t('historyUnknownActor'),'Legacy reader']);
  await expect(page.locator('.history-entry[open]')).toHaveCount(0);
  const recent=entries.nth(0);await recent.locator('summary').focus();await page.keyboard.press('Space');await expect(recent).toHaveAttribute('open','');
  await expect(recent.locator('[data-history-field="title"] [data-value="before"]')).toContainText('Before title');await expect(recent.locator('[data-history-field="title"] [data-value="after"]')).toContainText('After title');
  await expect(recent.locator('[data-history-field="status"] [data-value="before"]')).toContainText(t('todo'));await expect(recent.locator('[data-history-field="status"] [data-value="after"]')).toContainText(t('done'));
  await expect(recent.locator('[data-history-field="owner_id"] [data-value="before"]')).toContainText(`${t('historyLinkedRecord')} · previous`);await expect(recent.locator('[data-history-field="owner_id"] [data-value="after"] span')).toHaveAttribute('title','next-reference-123');
  await expect(recent.locator('[data-history-field="notes"]')).toHaveCount(0);await expect(recent.locator('[data-history-field="reference_notes"] [data-value="before"]')).toContainText('Original full unlinked project description');await expect(recent.locator('[data-history-field="reference_notes"] [data-value="after"]')).toContainText('Updated full unlinked project description');await expect(recent.locator('[data-history-field="reference_notes"]')).not.toContainText(t('historyLinkedRecord'));
  await expect(entries.nth(1).locator('.history-roles')).toHaveText(t('historySystem'));await expect(entries.nth(2).locator('.history-roles')).toHaveText(t('historyUnknownRole'));
  await entries.nth(2).locator('summary').click();await expect(entries.nth(2).locator('.history-expanded')).toContainText(t('historyNoFieldChanges'));
  const legacy=entries.nth(3);await expect(legacy.locator('.history-roles')).toContainText(t('financeRole'));await expect(legacy.locator('.history-roles small')).toHaveText(t('historyCurrentRole'));await legacy.locator('summary').click();await expect(legacy.locator('.history-snapshot')).toContainText('Earlier note');
  await expect(page.locator('.history-timeline')).not.toContainText('NEVER_RENDER');await expect(page.locator('.history-timeline pre')).toHaveCount(0);
  expect(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`docs/qa/browser/history-edge-phone-${locale}.png`,fullPage:true});
 }
});
