import {test,expect,type APIRequestContext,type BrowserContext,type Page} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {signIn} from './helpers/sign-in';
import {translate,type Locale} from '../src/locales';
import type {Preferences} from '../src/components/types';

const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000',recordId='11111111-1111-4111-8111-111111111111';
let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,original:Preferences,accountName:string;
test.beforeAll(async({playwright})=>{test.setTimeout(120000);const demo=JSON.parse(await readFile('data/demo-credentials.json','utf8'));request=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});expect((await signIn(request,demo.users[0])).status()).toBe(200);cookies=(await request.storageState()).cookies;original=(await(await request.get('/api/preferences')).json()).data;accountName=(await(await request.get('/api/me')).json()).data.user.name;await mkdir('docs/qa/browser',{recursive:true});});
test.afterAll(async()=>{if(request){if(original)expect((await request.put('/api/preferences',{data:original})).status()).toBe(200);await request.dispose();}});

async function fixture(page:Page){
 let version=7,status='under_review',failNext=false;const previews:Record<string,unknown>[]=[],actions:Record<string,unknown>[]=[];
 const row=()=>({id:recordId,version,title:'Signature presentation example',status,parties:'Presentation-only example',owner_id:null,project_id:null,reference_notes:{project_id:'Complete unlinked project reference text for signature review'}});
 await page.route(`**/api/data/contracts/${recordId}`,route=>route.fulfill({json:{data:{...row(),_timeline:[],_attachments:[]}}}));
 await page.route(`**/api/data/contracts/${recordId}/actions/*`,async route=>{const body=route.request().postDataJSON();actions.push(body);if(failNext){failNext=false;version++;await route.fulfill({status:409,json:{error:{code:'signature_snapshot_changed'}}});return;}version++;status='signed';await route.fulfill({json:{data:row()}});});
 await page.route('**/api/signature-requests**',route=>route.fulfill({json:{data:{supported:true,record_version:version,configuration_version:0,enabled:false,parties:[],eligible_members:[],can_configure:false,requests:[]}}}));
 await page.route('**/api/signatures**',async route=>{
  const url=new URL(route.request().url());
  if(route.request().method()==='POST'){const body=route.request().postDataJSON();previews.push(body);await route.fulfill({json:{data:{required:true,reviewed_hash:String(previews.length).repeat(64),consent_version:'internal-confirmation-v1',operation:body.operation,values:body.values,snapshot:{resource:'contracts',record_id:recordId,record:row(),children:[],related:[],attachments:[],currency_units:{USD:2}}}}});return;}
  if(url.searchParams.has('id')){const filename=`Syntherisk-signature-${url.searchParams.get('id')}.json`,checksum=url.searchParams.get('format')==='sha256';await route.fulfill({headers:{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename+(checksum?'.sha256':''))}`},body:checksum?'a'.repeat(64)+'  '+filename+'\n':JSON.stringify({presentationOnly:true,signature:'example'}),contentType:checksum?'text/plain':'application/json'});return;}
  await route.fulfill({json:{data:{rows:[{id:'current',operation:'sign',actor_name:accountName,actor_roles:['admin'],typed_name:accountName,signed_at:'2026-10-07T14:00:00Z',record_version:6,result_version:7,sha256:'a'.repeat(64),matches_current:true,integrity_valid:true},{id:'previous',operation:'sign',actor_name:'Previous signer',actor_roles:['member'],typed_name:'Previous signer',signed_at:'2026-10-06T14:00:00Z',record_version:3,result_version:4,sha256:'b'.repeat(64),matches_current:false,integrity_valid:true}]}}});
 });
 return {previews,actions,failOnce:()=>{failNext=true;}};
}
async function openAction(page:Page,locale:Locale){const t=(key:string)=>translate(locale,key);await page.goto(`/data/contracts?record=${recordId}`);const detail=page.getByRole('dialog',{name:'Signature presentation example',exact:true});await expect(detail).toBeVisible();await detail.locator('.workflow-section').getByRole('button',{name:t('sign'),exact:true}).click();const action=page.locator('dialog').last();await action.locator('#field-signed_document_url').fill('https://example.com/presentation-contract.pdf');return action;}
async function prepare(page:Page,context:BrowserContext,locale:Locale){expect((await request.put('/api/preferences',{data:{...original,locale,timezone:'America/Los_Angeles'}})).status()).toBe(200);await context.addCookies(cookies);await page.setViewportSize({width:locale==='en'?1440:390,height:1000});}

for(const locale of ['zh-TW','zh-CN','en'] as Locale[]){
 test(`intercepted signature presentation requires review, name and consent, and preserves prior signatures in ${locale}`,async({page,context})=>{
  const t=(key:string)=>translate(locale,key);await prepare(page,context,locale);const data=await fixture(page);const action=await openAction(page,locale);
  await action.getByRole('button',{name:t('signatureReviewButton'),exact:true}).click();await expect(action.locator('.signature-review')).toBeVisible();expect(data.previews).toHaveLength(1);expect(data.actions).toHaveLength(0);
  await expect(action.locator('#signature-name')).toHaveValue('');await expect(action.locator('#signature-consent')).not.toBeChecked();const confirm=action.getByRole('button',{name:t('signatureConfirm'),exact:true});await expect(confirm).toBeDisabled();
  await action.locator('#signature-name').fill('Wrong name');await action.locator('#signature-consent').check();await expect(confirm).toBeDisabled();await action.locator('#signature-name').fill(accountName);await expect(confirm).toBeEnabled();
  await action.locator('.signature-snapshot summary').click();await expect(action.locator('.signature-snapshot')).toContainText('Presentation-only example');await expect(action.locator('.signature-snapshot')).toContainText('Complete unlinked project reference text for signature review');await expect(action.locator('.signature-review pre')).toHaveCount(0);
  await page.screenshot({path:`docs/qa/browser/signature-review-${locale}.png`,fullPage:true});await action.getByRole('button',{name:t('cancel'),exact:true}).click();expect(data.actions).toHaveLength(0);
  const detail=page.getByRole('dialog',{name:'Signature presentation example',exact:true});await detail.locator('.tabs').getByRole('button',{name:t('signatures'),exact:true}).click();await expect(detail.locator('.signature-entry')).toHaveCount(2);await expect(detail.locator('.signature-entry[open]')).toHaveCount(0);
  const current=detail.locator('.signature-entry[data-matches-current="true"]'),previous=detail.locator('.signature-entry[data-matches-current="false"]');await expect(current.locator('.signature-hash')).not.toBeVisible();await current.locator('summary').focus();await page.keyboard.press('Enter');await expect(current.locator('.signature-match')).toHaveText(t('signatureCurrent'));await expect(current.locator('.signature-hash')).toHaveText('a'.repeat(64));
  const receipt=page.waitForEvent('download');await current.getByRole('button',{name:t('signatureReceipt'),exact:true}).click();expect((await receipt).suggestedFilename()).toBe('Syntherisk-signature-current.json');
  await previous.locator('summary').click();await expect(previous.locator('.signature-match')).toHaveText(t('signaturePrevious'));await page.screenshot({path:`docs/qa/browser/signature-history-${locale}.png`,fullPage:true});expect(data.actions).toHaveLength(0);
 });
}

test('intercepted signature review is invalidated by action edits and server conflicts before retry',async({page,context})=>{
 const t=(key:string)=>translate('en',key);await prepare(page,context,'en');const data=await fixture(page);const action=await openAction(page,'en');
 await action.getByRole('button',{name:t('signatureReviewButton'),exact:true}).click();await expect(action.locator('.signature-review')).toBeVisible();await action.locator('#signature-name').fill(accountName);await action.locator('#signature-consent').check();
 await action.locator('#field-signed_document_url').fill('https://example.com/changed-contract.pdf');await expect(action.locator('.signature-review')).toHaveCount(0);await action.getByRole('button',{name:t('signatureReviewButton'),exact:true}).click();await expect(action.locator('#signature-name')).toHaveValue('');await expect(action.locator('#signature-consent')).not.toBeChecked();
 expect((data.previews[1].values as Record<string,unknown>).signed_document_url).toBe('https://example.com/changed-contract.pdf');await action.locator('#signature-name').fill(accountName);await action.locator('#signature-consent').check();data.failOnce();
 await action.getByRole('button',{name:t('signatureConfirm'),exact:true}).click();await expect(action.locator('.signature-review')).toHaveCount(0);await expect(action.getByRole('alert')).toContainText(t('error_signature_snapshot_changed'));
 await action.getByRole('button',{name:t('signatureReviewButton'),exact:true}).click();await expect(action.locator('#signature-name')).toHaveValue('');await expect(action.locator('#signature-consent')).not.toBeChecked();expect((data.previews[2].values as Record<string,unknown>).version).toBe(8);
 await action.locator('#signature-name').fill(accountName);await action.locator('#signature-consent').check();await action.getByRole('button',{name:t('signatureConfirm'),exact:true}).click();await expect(page.locator('dialog')).toHaveCount(1);expect(data.actions).toHaveLength(2);
 const signature=data.actions[1].signature as Record<string,unknown>;expect(signature).toEqual({typed_name:accountName.trim().normalize('NFC'),consent:true,reviewed_hash:'3'.repeat(64)});expect(data.actions[1]).not.toHaveProperty('actor_name');expect(data.actions[1]).not.toHaveProperty('actor_roles');
});
