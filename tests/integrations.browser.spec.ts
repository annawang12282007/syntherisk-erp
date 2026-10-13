import {signIn} from './helpers/sign-in';
import {test,expect,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,preferences:Record<string,unknown>;
let contactId:string,templateId:string,campaignId:string;
const suffix=randomUUID().slice(0,8),subject=`Mail workflow ${suffix} {{name}}`,contactName=`Allowed ${suffix}`;
const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
test.beforeAll(async({playwright})=>{test.setTimeout(120000);
 const demo=JSON.parse(await readFile('data/demo-credentials.json','utf8'));request=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
 const signed=await signIn(request,{email:demo.users[0].email,password:demo.users[0].password});expect(signed.status()).toBe(200);cookies=(await request.storageState()).cookies;
 preferences=(await(await request.get('/api/preferences')).json()).data;await request.put('/api/preferences',{data:{...preferences,locale:'en'}});
 const create=async(resource:string,data:Record<string,unknown>)=>{const response=await request.post(`/api/data/${resource}`,{data});expect(response.status(),await response.text()).toBe(200);return (await response.json()).data.id as string;};
 contactId=await create('contacts',{name:contactName,email:`${suffix}@example.invalid`,do_not_contact:false});const stopped=await create('contacts',{name:`Stopped ${suffix}`,email:`stop-${suffix}@example.invalid`,do_not_contact:true});
 templateId=await create('communication_templates',{name:`Template ${suffix}`,subject,body:'Dear {{name}}, this is an isolated browser acceptance draft.'});
 const group=await create('audience_groups',{name:`Audience ${suffix}`});await create('audience_members',{group_id:group,contact_id:contactId});await create('audience_members',{group_id:group,contact_id:stopped});campaignId=await create('campaigns',{title:`Campaign ${suffix}`,template_id:templateId,group_id:group});await mkdir('docs/qa/browser',{recursive:true});
});
test.beforeEach(async({context})=>{await context.addCookies(cookies);});
test.afterAll(async()=>{if(request){await request.put('/api/preferences',{data:preferences});await request.dispose();}});
test('template draft preview, review, edit and cancel work in the browser without external delivery',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/data/messages');await expect(page.locator('.sidebar')).toBeVisible();
 await page.getByRole('button',{name:'Compose draft',exact:true}).click();let dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.locator('#field-template_id option',{}).filter({hasText:`Template ${suffix}`})).toBeAttached();
 await dialog.locator('#field-template_id').selectOption(templateId);await dialog.locator('#field-contact_id').selectOption(contactId);
 const sender=dialog.locator('#sender-account');if(await sender.count()){await sender.selectOption({index:1});}else await dialog.locator('#field-sender_account').fill('isolated@example.invalid');
 await dialog.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button').filter({hasText:subject}).first().click();dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'Preview',exact:true}).click();await expect(dialog).toContainText(`Mail workflow ${suffix} ${contactName}`);await page.screenshot({path:'docs/qa/browser/mail-template-preview.png',fullPage:true});
 await dialog.getByRole('button',{name:'Review',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button').filter({hasText:subject}).first().click();dialog=page.getByRole('dialog');await expect(dialog.locator('.badge').first()).toContainText('Reviewed');
 await dialog.getByRole('button',{name:'Edit',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('Subject',{exact:true}).fill(`Edited ${suffix}`);await dialog.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('button').filter({hasText:`Edited ${suffix}`}).first().click();dialog=page.getByRole('dialog');await expect(dialog.locator('.badge').first()).toContainText('Draft');
 const cancellation=page.waitForResponse(response=>response.url().endsWith('/api/integrations')&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='cancel_message');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect((await cancellation).status()).toBe(200);await expect(page.getByRole('dialog')).toHaveCount(0);
 const messages=(await(await request.post('/api/integrations',{data:{action:'messages'}})).json()).data.rows;expect(messages.find((message:{subject:string})=>message.subject===`Edited ${suffix}`).status).toBe('cancelled');expect(errors).toEqual([]);
});
test('campaign recipient preview excludes stopped contacts and creates drafts on a phone layout',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/data/messages');await page.getByRole('button',{name:'Prepare campaign drafts',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.locator('#field-campaign_id option').filter({hasText:`Campaign ${suffix}`})).toBeAttached();await dialog.locator('#field-campaign_id').selectOption(campaignId);
 const sender=dialog.locator('#sender-account');if(await sender.count())await sender.selectOption({index:1});else await dialog.locator('#field-sender_account').fill('isolated@example.invalid');
 await dialog.getByRole('button',{name:'Preview recipients',exact:true}).click();await expect(dialog).toContainText('1 / 2');await expect(dialog).toContainText(`Stopped ${suffix}`);expect(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth+1)).toBeTruthy();await page.screenshot({path:'docs/qa/browser/campaign-preview-phone.png',fullPage:true});await dialog.getByRole('button',{name:'Create drafts',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const result=(await(await request.post('/api/integrations',{data:{action:'messages'}})).json()).data.rows;const campaignRows=result.filter((row:{campaign_id:string})=>row.campaign_id===campaignId);expect(campaignRows).toHaveLength(1);expect(campaignRows[0].status).toBe('draft');
});

