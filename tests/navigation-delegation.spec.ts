import {test,expect,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {signIn} from './helpers/sign-in';
import {existingReadableRecord} from './helpers/existing-record';
import {translate,type Locale} from '../src/locales';
import {navigationOrder} from '../src/components/navigation-order';
import type {Preferences,Resource,Row} from '../src/components/types';

const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,original:Preferences,resources:Record<string,Resource>,budget:Row|undefined,targetResource:string,currentUserId:string;
test.beforeAll(async({playwright})=>{
 test.setTimeout(120000);const demo=JSON.parse(await readFile('data/demo-credentials.json','utf8'));request=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
 expect((await signIn(request,demo.users[0])).status()).toBe(200);cookies=(await request.storageState()).cookies;original=(await(await request.get('/api/preferences')).json()).data;resources=(await(await request.get('/api/meta')).json()).data.resources;currentUserId=(await(await request.get('/api/me')).json()).data.user.id;
 const existing=await existingReadableRecord(request);budget=existing.row;targetResource=existing.resource;await mkdir('docs/qa/browser',{recursive:true});
});
test.afterAll(async()=>{if(request){if(original)expect((await request.put('/api/preferences',{data:original})).status()).toBe(200);await request.dispose();}});

for(const locale of ['zh-TW','zh-CN','en'] as Locale[]){
 test(`sidebar visibility persists without hiding CRM tabs and delegation forms select real linked records in ${locale}`,async({page,context})=>{
  const t=(key:string)=>translate(locale,key),index=locale==='en'?2:locale==='zh-CN'?1:0,label=(key:string)=>resources[key].label[index];
  expect((await request.put('/api/preferences',{data:{...original,locale,sidebar:{...original.sidebar,order:navigationOrder,hidden:[],shortcuts:[],collapsed:false},views:{...original.views,delegations:{}}}})).status()).toBe(200);
  await context.addCookies(cookies);await page.setViewportSize({width:locale==='en'?1440:390,height:1000});page.on('dialog',dialog=>dialog.accept());const businessWrites:string[]=[];page.on('request',event=>{if(!['GET','HEAD','OPTIONS'].includes(event.method())&&/\/api\/data\//.test(event.url()))businessWrites.push(event.method()+' '+event.url());});
  await page.goto('/settings');await page.locator('.settings-nav').getByRole('button',{name:t('profile'),exact:true}).click();const organizations=page.locator('.sidebar-order-item[data-id="organizations"]');await organizations.getByRole('checkbox',{name:`${t('sidebarShow')}: ${t('organizations')}`,exact:true}).uncheck();
  await page.locator('.settings-content').getByRole('button',{name:t('save'),exact:true}).click();await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).data.sidebar.hidden).toEqual(['organizations']);
  await page.reload();await expect(page.locator('.sidebar nav .nav-item:not(.shortcut)')).toHaveText(navigationOrder.filter(key=>key!=='organizations').map(t));
  await page.goto('/data/contacts');await page.locator('.module-nav').getByRole('button',{name:label('organizations'),exact:true}).click();await expect(page.locator('main .page-heading h1')).toHaveText(label('organizations'));await expect(page.locator('.sidebar nav').getByRole('button',{name:t('organizations'),exact:true})).toHaveCount(0);
  await page.goto('/data/delegations');await expect(page.locator('.module-nav').getByRole('button',{name:label('delegations'),exact:true})).toBeVisible();await expect(page.locator('.delegation-guide details')).not.toHaveAttribute('open','');
  await page.locator('.delegation-scope-tabs').getByRole('button',{name:t('delegationSent'),exact:true}).click();await expect(page.locator('.delegation-scope-tabs').getByRole('button',{name:t('delegationSent'),exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('main .heading-actions .btn.primary').click();const form=page.getByRole('dialog');await expect(form.locator('#field-title')).toHaveValue('');await expect(form.locator('#field-assignee_id')).toHaveValue('');await expect(form.locator('#field-assignee_id')).toHaveAttribute('required','');await expect(form.locator(`#field-assignee_id option[value="${currentUserId}"]`)).toHaveCount(0);await expect(form.locator('#field-review_required')).toBeChecked();await expect(form.locator('#field-access_level')).toHaveValue('read');await expect(form.locator('#field-target_resource')).toHaveValue('');await expect(form.locator('#field-target_id')).toHaveCount(0);
  await form.locator('#field-target_resource').selectOption(targetResource);await expect(form.locator('#field-target_id')).toHaveAttribute('required','');await expect(form.locator(`#field-target_id option[value="${budget!.id}"]`)).toBeAttached();await form.locator('#field-target_id').selectOption(budget!.id);await expect(form.locator('#field-target_id')).toHaveValue(budget!.id);await form.locator('#field-target_resource').selectOption('engagements');await expect(form.locator('#field-target_id')).toHaveValue('');
  await form.locator('#field-target_resource').selectOption('');await expect(form.locator('#field-target_id')).toHaveCount(0);await form.getByRole('button',{name:t('cancel'),exact:true}).click();
  await page.goto(`/data/${targetResource}?record=${budget!.id}`);const detail=page.getByRole('dialog');await detail.getByRole('button',{name:t('delegationCreate'),exact:true}).click();const linkedForm=page.locator('dialog').last();await expect(linkedForm.locator('#field-target_resource')).toHaveValue(targetResource);await expect(linkedForm.locator('#field-target_resource')).toBeDisabled();await expect(linkedForm.locator('#field-target_id')).toHaveValue(budget!.id);await expect(linkedForm.locator('#field-assignee_id')).toBeEnabled();await expect(linkedForm.locator('#field-title')).toHaveValue('');await linkedForm.getByRole('button',{name:t('cancel'),exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:t('close'),exact:true}).click();await page.goto('/data/delegations');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`docs/qa/browser/delegation-navigation-${locale}.png`,fullPage:true});expect(businessWrites).toEqual([]);
 });
}
