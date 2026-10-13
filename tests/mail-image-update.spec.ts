import {test,expect,type Page} from '@playwright/test';
import {resources} from '../src/domain/registry';

// Every API call is intercepted. These checks cannot send mail or edit real data.
async function fixture(page:Page,root=true){
 const writes:Record<string,unknown>[]=[],errors:string[]=[];let draft:Record<string,unknown>={};
 let signature={mode:'generated',style:'script',signature_text:'Example',label:'Example',version:0,saved_version:null as number|null,display_width:280,data_url:'',versions:[] as unknown[]};
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE ERROR',m.text());});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():{},path=url.pathname;
  let data:unknown=[];
  if(path==='/api/me')data={user:{id:'fixture',name:'Fixture',email:'fixture@example.invalid'},workspace:{id:'fixture',name:'Fixture'},company:{id:'fixture',base_currency:'USD'},roles:['admin'],initial_administrator:root,preferences:{locale:'en'}};
  else if(path==='/api/meta')data={resources:Object.fromEntries(Object.entries(resources).map(([k,r])=>[k,{...r,capabilities:{read:true,create:!r.hidden}}]))};
  else if(path==='/api/integrations')data={connections:[{id:'connection',provider:'gmail',status:'connected',google_email:'fixture@example.invalid',paused:false}],configured:{senderAccounts:[]}};
  else if(path==='/api/mail-identities')data={identities:[],variables:{}};
  else if(path==='/api/account-security')data={email:'fixture@example.invalid',emailVerified:true,mail_configured:false};
  else if(path==='/api/signature-profile'){
   if(req.method()==='PUT'){writes.push(body);signature={...signature,...body,version:signature.version+1,saved_version:signature.version+1};signature.versions=[{revision:signature.version,label:'Example'}];}
   data=signature;
  }else if(path==='/api/workspace-services'){
   writes.push(body);
   if(body.action==='gmail_save'){
    if(draft.id&&body.version!==draft.version){await route.fulfill({status:409,json:{error:{code:'VERSION_CONFLICT'}}});return;}
    draft={...body,id:'draft',version:Number(draft.version||0)+1,status:'draft'};data=draft;
   }else if(body.action==='preview')data={id:'operation',kind:body.kind,preview:{from:'fixture@example.invalid',to:[draft.to],cc:[],bcc:[],subject:draft.subject,body:draft.body,attachments:[]}};
   else if(body.action==='confirm')data={id:'operation',status:'queued'};
   else if(body.action==='operations'){draft={...draft,version:Number(draft.version)+1};data=[{id:'operation',kind:'gmail_remote_draft',status:'succeeded'}];}
   else if(body.action==='gmail_drafts')data=[draft];
  }else if(path.startsWith('/api/data/'))data={rows:[],total:0};
  await route.fulfill({json:{data}});
 });
 return {writes,errors};
}

test('simple composer saves, refreshes a synced draft version, and reviews sending without sending',async({page})=>{
 const {writes,errors}=await fixture(page);await page.goto('/module/communications');
 await page.getByRole('button',{name:'Compose',exact:true}).click();const composer=page.getByRole('dialog',{name:'Compose mail',exact:true});
 await expect(composer.getByText(/Company mail layout|Mail signature|Apply template/)).toHaveCount(0);
 await composer.getByRole('textbox',{name:'To',exact:true}).fill('recipient@example.invalid');await composer.getByRole('textbox',{name:'Subject',exact:true}).fill('Controlled test');await composer.getByRole('textbox',{name:'Message',exact:true}).fill('Test body');
 await composer.getByRole('button',{name:'Save private draft',exact:true}).click();await expect(composer.getByText('Private draft saved',{exact:true})).toBeVisible();
 await composer.getByRole('button',{name:'Sync Gmail draft',exact:true}).click();await page.getByRole('dialog',{name:'Review message and recipients',exact:true}).getByRole('button',{name:'Confirm action',exact:true}).click();
 await expect(composer.getByRole('button',{name:'Save private draft',exact:true})).toBeEnabled();
 await composer.getByRole('textbox',{name:'Message',exact:true}).fill('Edited after Gmail sync');await composer.getByRole('button',{name:'Save private draft',exact:true}).click();await expect(composer.getByText('Private draft saved',{exact:true})).toBeVisible();
 const saves=writes.filter(w=>w.action==='gmail_save');expect(saves.at(-1)?.version).toBe(3);expect(saves.every(s=>s.body_format==='plain'&&JSON.stringify(s.mail_style)==='{}')).toBe(true);
 await composer.getByRole('button',{name:'Review and send',exact:true}).click();await expect(page.getByRole('dialog',{name:'Review message and recipients',exact:true})).toContainText('Confirmation sends to these addresses.');
 expect(writes.filter(w=>w.action==='confirm')).toHaveLength(1);expect(errors).toEqual([]);
});

test('signature size is proportional, saved with a version, and retained after reload',async({page})=>{
 const {writes,errors}=await fixture(page);await page.goto('/settings?section=profile');const panel=page.locator('.signature-profile');
 await panel.getByRole('spinbutton',{name:'Image width value',exact:true}).fill('420');
 await expect(panel.locator('.personal-signature-image')).toHaveCSS('width','420px');
 await panel.getByRole('button',{name:'Save and use a new version',exact:true}).click();await expect.poll(()=>writes.some(w=>w.display_width===420)).toBe(true);
 await page.reload();await expect(page.locator('.signature-profile').getByRole('spinbutton',{name:'Image width value',exact:true})).toHaveValue('420');
 await expect(page.getByText('Mail signature',{exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});

test('company logo size can be saved without showing retired mail layout fields',async({page})=>{
 const {errors}=await fixture(page);let width='230';
 await page.route('**/api/company-information',async route=>{
  if(route.request().method()==='POST')width=route.request().postDataJSON().fields.logo_width;
  await route.fulfill({json:{data:{version:1,can_manage_access:false,fields:[{key:'logo_width',label:['LOGO 寬度','Logo width'],value:width,can_edit:true},{key:'mail_header',label:['封頁','Mail header'],value:'old header',can_edit:true},{key:'mail_footer',label:['頁尾','Mail footer'],value:'old footer',can_edit:true}]}}});
 });
 await page.goto('/settings?section=company');const panel=page.locator('section.settings-card').filter({hasText:'Company information & brand'});
 await panel.getByRole('spinbutton',{name:'Image width value',exact:true}).fill('320');await expect(panel.locator('.brand-settings img')).toHaveCSS('width','320px');
 await panel.getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>width).toBe('320');await page.reload();await expect(panel.getByRole('spinbutton',{name:'Image width value',exact:true})).toHaveValue('320');
 await expect(panel.getByText('Mail header',{exact:true})).toHaveCount(0);await expect(panel.getByText('Mail footer',{exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});

for(const root of [false,true])test(`policy editing hides protected roles and withdrawn templates (root=${root})`,async({page})=>{
 const {errors}=await fixture(page,root);
 const roles=['admin','operations','member'].map(code=>({code,name:code,description:'',active:true,builtin:true,version:0,can_edit_policy:code==='member'||root&&code==='operations'}));
 const permissions=roles.map(role=>({id:role.code,role_code:role.code,resource:'tasks',operation:'read',scope:'all',can_edit:role.can_edit_policy}));
 await page.route('**/api/access',route=>route.fulfill({json:{data:{roles,permissions,grants:[],operation_options:{tasks:['read','create','edit'],contacts:['read','create','edit']}}}}));
 await page.goto('/settings?section=permissions');
 for(const role of roles){
  // Locate by API order to avoid coupling protection checks to translated labels.
  const policyRow=page.locator('.access-settings .data-table').first().locator('tbody tr').nth(roles.indexOf(role));
  await expect(policyRow.getByRole('button',{name:'Edit',exact:true})).toHaveCount(role.can_edit_policy?1:0);
 }
 await page.locator('.access-settings > header button').click();
 const modal=page.getByRole('dialog');await expect(modal.locator('#access-role option[value="admin"]')).toHaveCount(0);
 await expect(modal.locator('#access-role option[value="operations"]')).toHaveCount(root?1:0);
 await expect(modal.locator('#access-resource option[value="communication_templates"]')).toHaveCount(0);
 await expect(modal.locator('#access-role option[value="member"]')).toHaveCount(1);expect(errors).toEqual([]);
});

test('team settings omit mail layout inputs and saving does not submit old hidden values',async({page})=>{
 const {errors}=await fixture(page,false);const writes:Record<string,unknown>[]=[];
 const board={id:'board',version:1,name:'Co-founders',description:'Example',role:'manager',can_post:true,mail_header:'Old header',mail_footer:'Old footer',members:[{user_id:'fixture',name:'Fixture',role:'manager',can_post:true}],posts:[]};
 await page.route('**/api/team',route=>route.fulfill({json:{data:{members:board.members}}}));
 await page.route('**/api/team-boards**',route=>{const req=route.request();if(req.method()==='POST')writes.push(req.postDataJSON());return route.fulfill({json:{data:req.method()==='POST'||new URL(req.url()).searchParams.has('team_id')?board:{can_create:true,teams:[board]}}});});
 await page.goto('/team?section=boards');await page.getByRole('button',{name:'Co-founders',exact:true}).click();await page.getByRole('button',{name:'Manage team',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Team settings'});await expect(modal.locator('textarea')).toHaveCount(1);await expect(modal.getByText(/header|footer|mail layout/i)).toHaveCount(0);
 await modal.getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).not.toHaveProperty('mail_header');expect(writes[0]).not.toHaveProperty('mail_footer');expect(errors).toEqual([]);
});

test('account list hides peer edit and disable actions while permitting lower account management',async({page})=>{
 const {errors}=await fixture(page,false);
 await page.route('**/api/identity',route=>route.fulfill({json:{data:{members:[{id:'peer',user_id:'peer',name:'Peer account',email:'peer@example.invalid',roles:['admin'],status:'active',can_edit:false,can_disable:false},{id:'lower',name:'Lower account',email:'lower@example.invalid',roles:['member'],status:'active',can_edit:true,can_disable:true}]}}}));
 await page.route('**/api/admin-accounts',route=>route.fulfill({json:{data:{invitations:[]}}}));
 await page.route('**/api/organization',route=>route.fulfill({json:{data:{can_manage:false,is_initial_admin:false,departments:[],jobs:[],members:[],assignments:[],operator:{name:'Operator'},policy_resources:{}}}}));
 await page.goto('/settings?section=members');const rows=page.locator('.members-list > div');await expect(rows).toHaveCount(2);await expect(rows.nth(0).getByRole('button')).toHaveCount(0);await expect(rows.nth(1).getByRole('button')).toHaveCount(2);expect(errors).toEqual([]);
});
