import {test,expect,type APIRequestContext,type BrowserContext,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {signIn} from './helpers/sign-in';
import {translate,type Locale} from '../src/locales';

// Presentation contracts use intercepted read fixtures only. No contact, draft or delivery is persisted.
type Contact={id:string;version:number;name:string;email:string|null;do_not_contact?:boolean;contact_preference?:string;archived?:boolean};
const identifier=(n:number)=>`71000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const contacts:Contact[]=[
 {id:identifier(1),version:1,name:'Fixture Ada',email:'ada@example.invalid'},
 {id:identifier(2),version:1,name:'Fixture Ada',email:'second@example.invalid'},
 {id:identifier(3),version:1,name:'Fixture Stopped',email:'stopped@example.invalid',do_not_contact:true},
 {id:identifier(4),version:1,name:'Fixture Grace',email:null},
 {id:identifier(5),version:1,name:'Fixture Invalid',email:'invalid-address'},
 {id:identifier(6),version:1,name:'Fixture No Contact',email:'none@example.invalid',contact_preference:'none'},
];
let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,preferences:Record<string,unknown>;
const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
test.beforeAll(async({playwright})=>{
 test.setTimeout(120000);const demo=JSON.parse(await readFile('data/demo-credentials.json','utf8'));
 request=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
 expect((await signIn(request,demo.users[0])).status()).toBe(200);cookies=(await request.storageState()).cookies;
 preferences=(await(await request.get('/api/preferences')).json()).data;
});
test.beforeEach(async({context})=>{await context.addCookies(cookies);});
test.afterAll(async()=>{if(request){try{expect((await request.put('/api/preferences',{data:preferences})).status()).toBe(200);}finally{await request.dispose();}}});

async function fixtureReads(page:Page,{rows=contacts,draft,unavailableId}:{rows?:Contact[];draft?:Record<string,unknown>;unavailableId?:string}={}){
 const mutations:string[]=[];
 await page.route('**/api/data/contacts**',async route=>{
  if(route.request().method()!=='GET'){mutations.push(route.request().method());await route.abort();return;}
  const url=new URL(route.request().url()),id=url.pathname.split('/')[4];
  if(id){const contact=rows.find(row=>row.id===id);await route.fulfill({status:id===unavailableId?403:contact?200:404,json:contact&&id!==unavailableId?{data:contact}:{error:{code:'NOT_FOUND'}}});return;}
  const pageIndex=Math.max(1,Number(url.searchParams.get('page')||1));
  const term=(url.searchParams.get('q')||'').toLowerCase(),visible=rows.filter(row=>!row.archived&&`${row.name} ${row.email||''}`.toLowerCase().includes(term));
  await route.fulfill({json:{data:{rows:visible.slice((pageIndex-1)*50,pageIndex*50),total:visible.length,page:pageIndex,pageSize:50}}});
 });
 await page.route('**/api/integrations',async route=>{
  if(route.request().method()==='GET'){await route.fulfill({json:{data:{configured:{google:false,mail:false,senderAccounts:[]},connections:[],notifications:[]}}});return;}
  const action=route.request().postDataJSON()?.action;
  if(action==='messages'){await route.fulfill({json:{data:{rows:draft?[draft]:[],total:draft?1:0,page:1,pageSize:25}}});return;}
  mutations.push(String(action));await route.abort();
 });
 return mutations;
}
async function openComposer(page:Page,locale:Locale){
 expect((await request.put('/api/preferences',{data:{...preferences,locale}})).status()).toBe(200);
 await page.goto('/data/messages');await page.getByRole('button',{name:translate(locale,'compose'),exact:true}).click();
 return page.getByRole('dialog');
}
const draftFor=(contact:Contact)=>({id:identifier(90),version:1,contact_id:contact.id,contact_name:contact.name,to_address:contact.email,sender_account:'operations@example.invalid',subject:'Fixture preserved draft',body:'Presentation fixture only.',status:'draft'});
async function editFixture(page:Page){
 expect((await request.put('/api/preferences',{data:{...preferences,locale:'en'}})).status()).toBe(200);
 await page.goto('/data/messages');await page.getByRole('button').filter({hasText:'Fixture preserved draft'}).click();await page.getByRole('dialog').getByRole('button',{name:'Edit',exact:true}).click();return page.getByRole('dialog');
}

for(const locale of ['zh-TW','zh-CN','en'] as const)test(`read fixtures: recipient identity and eligibility are clear in ${locale}`,async({page})=>{
 const mutations=await fixtureReads(page),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const dialog=await openComposer(page,locale),select=dialog.locator('#field-contact_id'),status=dialog.locator('#mail-recipient-status');
 await expect(select).toHaveValue('');await expect(select.locator('option').filter({hasText:'ada@example.invalid'})).toBeAttached();
 await expect(status).toContainText(translate(locale,'mailRecipientNotSelected'));
 for(const contact of contacts.slice(2))await expect(select.locator(`option[value="${contact.id}"]`)).toBeDisabled();
 await select.selectOption(contacts[1].id);await expect(status).toContainText('Fixture Ada');await expect(status).toContainText('second@example.invalid');
 await select.selectOption('');await expect(dialog.getByRole('button',{name:translate(locale,'saveDraft'),exact:true})).toBeDisabled();
 const search=dialog.getByRole('searchbox',{name:translate(locale,'mailRecipientSearch'),exact:true});
 await search.fill('Grace');await expect(select.locator(`option[value="${contacts[3].id}"]`)).toBeAttached();await expect(select.locator(`option[value="${contacts[3].id}"]`)).toBeDisabled();
 await search.fill('second@example.invalid');await expect(select.locator('option')).toHaveCount(2);await expect(select.locator(`option[value="${contacts[1].id}"]`)).toBeAttached();
 await page.setViewportSize({width:390,height:844});expect(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth+1)).toBeTruthy();
 expect(mutations).toEqual([]);expect(errors).toEqual([]);
});
test('read fixtures: an empty eligible list links to Contacts without inventing a recipient',async({page})=>{
 const mutations=await fixtureReads(page,{rows:[contacts[2]]}),dialog=await openComposer(page,'en');
 await expect(dialog.getByText('No eligible email recipients',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('link',{name:'Manage contacts'})).toHaveAttribute('href','/data/contacts');
 await expect(dialog.locator('#field-contact_id')).toHaveValue('');await expect(dialog.getByRole('button',{name:'Save draft',exact:true})).toBeDisabled();expect(mutations).toEqual([]);
});
for(const mode of ['archived','inaccessible'] as const)test(`read fixtures: ${mode} draft recipients are preserved with a warning`,async({page})=>{
 const original={...contacts[0],archived:mode==='archived'},draft=draftFor(original);
 const mutations=await fixtureReads(page,{rows:[original,contacts[1]],draft,unavailableId:mode==='inaccessible'?original.id:undefined}),dialog=await editFixture(page);
 await expect(dialog.locator('#field-contact_id')).toHaveValue(original.id);
 const status=dialog.locator('#mail-recipient-status');await expect(status).toContainText(original.name);await expect(status).toContainText(original.email!);
 await expect(status).toContainText(mode==='archived'?'Contact archived':'Contact is currently unavailable');
 await expect(status).toContainText('The original recipient remains in the draft.');await expect(dialog.getByRole('button',{name:'Save draft',exact:true})).toBeDisabled();expect(mutations).toEqual([]);
});
test('read fixtures: a changed recipient email needs explicit confirmation before draft save',async({page})=>{
 const draft=draftFor(contacts[0]),updated={...contacts[0],email:'updated@example.invalid'};
 const mutations=await fixtureReads(page,{rows:[updated],draft}),dialog=await editFixture(page),status=dialog.locator('#mail-recipient-status');
 await expect(status).toContainText('ada@example.invalid');await expect(status).toContainText('updated@example.invalid');
 await expect(dialog.getByRole('button',{name:'Save draft',exact:true})).toBeDisabled();
 await dialog.getByRole('checkbox',{name:'Use the contact’s updated email address',exact:true}).check();
 await expect(dialog.getByRole('button',{name:'Save draft',exact:true})).toBeEnabled();expect(mutations).toEqual([]);
});


test('read fixtures: eligible contacts on later pages remain reachable without duplicate options',async({page})=>{
 const stopped=Array.from({length:50},(_,index)=>({id:identifier(200+index),version:1,name:`Stopped fixture ${index}`,email:`stopped${index}@example.invalid`,do_not_contact:true}));
 const allowed={id:identifier(300),version:1,name:'Later eligible fixture',email:'later@example.invalid'};
 const mutations=await fixtureReads(page,{rows:[...stopped,allowed]}),dialog=await openComposer(page,'en');
 const select=dialog.locator('#field-contact_id');await expect(select.locator('option')).toHaveCount(51);
 await expect(dialog.getByText('No eligible email recipients',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:translate('en','loadMore'),exact:true}).click();await expect(select.locator('option')).toHaveCount(52);
 await select.selectOption(allowed.id);await expect(dialog.locator('#mail-recipient-status')).toContainText('later@example.invalid');
 await expect(select.locator('option')).toHaveCount(52);await expect(dialog.getByRole('button',{name:translate('en','loadMore'),exact:true})).toHaveCount(0);expect(mutations).toEqual([]);
});
