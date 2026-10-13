import {test,expect,type APIRequestContext,type BrowserContext,type Locator,type Page} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {signIn} from './helpers/sign-in';
import {translate,localeIndex,type Locale} from '../src/locales';
import type {Preferences,Resource} from '../src/components/types';

const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,original:Preferences,resources:Record<string,Resource>,feedbackId:string|undefined;
const settings=[
 {key:'approval_policies',summary:'policySummary',purpose:'policyPurpose',hints:{min_minor:'policyMinHint',max_minor:'policyMaxHint',category_id:'policyCategoryHint',project_id:'policyProjectHint',reviewer_id:'policyReviewerHint',delegate_id:'policyDelegateHint',owner_id:'configOwnerHint'}},
 {key:'expense_categories',summary:'categorySummary',purpose:'categoryPurpose',hints:{account_id:'categoryAccountHint',owner_id:'configOwnerHint'}},
 {key:'currencies',summary:'currencySummary',purpose:'currencyPurpose',hints:{code:'currencyCodeHint',minor_digits:'currencyDigitsHint',owner_id:'configOwnerHint'}},
 {key:'tax_rates',summary:'taxSummary',purpose:'taxPurpose',hints:{rate:'taxRateHint',jurisdiction:'taxJurisdictionHint',account_id:'taxRule',owner_id:'configOwnerHint'}},
] as const;
const recordFields={
 guide:{label:['訪談大綱','访谈大纲','Interview outline'],hint:'interviewGuideHelp'},
 direct_record:{label:['訪談紀錄','访谈记录','Interview record'],hint:'interviewRecordHelp'},
 interpretation:{label:['分析摘要','分析摘要','Analysis summary'],hint:'interviewAnalysisHelp'},
 evidence_source:{label:['資料來源','资料来源','Source reference'],hint:'evidenceSourceHelp'},
 direct_quote:{label:['原始引述','原始引述','Original quotation'],hint:'feedbackQuoteHelp'},
} as const;
const recordForms=[{key:'interviews',fields:['guide','direct_record','interpretation','evidence_source']},{key:'feedback',fields:['direct_quote','interpretation','evidence_source']},{key:'validation_records',fields:['evidence_source']}] as const;
const replacedLabels=[['訪綱','直接紀錄','解釋','證據來源','直接引述'],['访纲','直接记录','解释','证据来源','直接引述'],['Guide','Direct record','Interpretation','Evidence source','Direct quote']];

test.beforeAll(async({playwright})=>{
 test.setTimeout(120000);
 const demo=JSON.parse(await readFile('data/demo-credentials.json','utf8'));
 request=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
 expect((await signIn(request,demo.users[0])).status()).toBe(200);
 cookies=(await request.storageState()).cookies;
 original=(await(await request.get('/api/preferences')).json()).data;
 resources=(await(await request.get('/api/meta')).json()).data.resources;
 const feedback=await request.get('/api/data/feedback?pageSize=1');expect(feedback.status()).toBe(200);feedbackId=(await feedback.json()).data.rows[0]?.id;
 await mkdir('docs/qa/browser',{recursive:true});
});
test.afterAll(async()=>{if(request){if(original)expect((await request.put('/api/preferences',{data:original})).status()).toBe(200);await request.dispose();}});

async function ready(page:Page){await expect(page.locator('.settings-layout')).toBeVisible();await expect(page.locator('.page-loading,.boot-screen,main .loading')).toHaveCount(0);}
async function selectExisting(select:Locator){await expect.poll(()=>select.locator('option').count()).toBeGreaterThan(1);await select.selectOption({index:1});await expect(select).not.toHaveValue('');}

for(const locale of ['zh-TW','zh-CN','en'] as Locale[]){
 test(`settings and interview forms clarify their fields in ${locale} without changing business data`,async({context,page})=>{
  test.setTimeout(120000);
  const t=(key:string)=>translate(locale,key);
  const writes:string[]=[];
  page.on('request',event=>{const url=new URL(event.url());if(!['GET','HEAD','OPTIONS'].includes(event.method())&&(/^\/api\/data\//.test(url.pathname)||['/api/access','/api/identity'].includes(url.pathname)))writes.push(`${event.method()} ${url.pathname}`);});
  expect((await request.put('/api/preferences',{data:{...original,locale}})).status()).toBe(200);
  await context.addCookies(cookies);await page.setViewportSize({width:1440,height:1100});
  await page.goto('/settings');await ready(page);
  const nav=page.locator('.settings-nav');
  for(const setting of settings){
   const resourceLabel=resources[setting.key].label[localeIndex(locale)];
   await nav.getByRole('button',{name:resourceLabel,exact:true}).click();await ready(page);
   const resource=page.locator('.settings-content .resource-view');
   await expect(resource.locator('.page-heading h1')).toHaveText(resourceLabel);
   await expect(resource.locator('.page-heading p')).toHaveText(t(setting.summary));
   const help=resource.locator(`details.configuration-help[data-resource="${setting.key}"]`);
   await expect(help).not.toHaveAttribute('open','');
   await expect(help.locator('.configuration-help-body')).not.toBeVisible();
   await help.locator('summary').click();
   await expect(help).toHaveAttribute('open','');
   await expect(help.locator('.configuration-help-body')).toContainText(t(setting.purpose));
   await resource.getByRole('button',{name:`${t('add')} ${resourceLabel}`,exact:true}).click();
   const form=page.getByRole('dialog',{name:`${t('add')} · ${resourceLabel}`,exact:true});
   await expect(form).toBeVisible();
   const formHelp=form.locator('details.configuration-help');
   await expect(formHelp).not.toHaveAttribute('open','');
   await formHelp.locator('summary').click();
   await expect(formHelp).toContainText(t(setting.purpose));
   for(const [field,key] of Object.entries(setting.hints)){
    await expect(form.locator(`#field-${field}-help`)).toHaveText(t(key));
    await expect(form.locator(`#field-${field}`)).toHaveAttribute('aria-describedby',`field-${field}-help`);
   }
   if(setting.key==='approval_policies'){
    await expect(form.locator('#field-min_minor')).toHaveAccessibleName(locale==='en'?'Minimum amount (minor units)':locale==='zh-CN'?'最低金额（最小单位）':'最低金額（最小單位）');
    await expect(form.locator('#field-max_minor')).toHaveAccessibleName(locale==='en'?'Maximum amount (0 = unlimited)':locale==='zh-CN'?'最高金额（0＝不限）':'最高金額（0＝不限）');
    await expect(form.locator('#field-max_minor')).toHaveValue('0');
   }
   if(setting.key==='currencies'){
    const digits=form.locator('#field-minor_digits');
    await expect(digits).toHaveAttribute('type','number');await expect(digits).toHaveAttribute('required','');await expect(digits).toHaveValue('2');
    await digits.fill('');expect(await digits.evaluate(element=>(element as HTMLInputElement).validity.valueMissing)).toBe(true);
    page.once('dialog',dialog=>dialog.accept());
   }
   await form.getByRole('button',{name:t('close'),exact:true}).click();await expect(form).not.toBeVisible();
  }

  await nav.getByRole('button',{name:t('permissions'),exact:true}).click();await ready(page);
  const access=page.locator('.access-settings');
  await expect(access.getByText(t('accessPolicyOverview'),{exact:true})).toBeVisible();
  await expect(access.getByText(t('accessGrantOverview'),{exact:true})).toBeVisible();
  await expect(access.locator('details.access-permission-details')).not.toHaveAttribute('open','');
  await access.getByRole('button',{name:t('accessAddGrant'),exact:true}).click();
  const grant=page.getByRole('dialog',{name:t('accessAddGrant'),exact:true});
  await expect(grant.getByText(t('accessDefaultReadOnly'),{exact:true})).toBeVisible();
  const record=grant.locator('#field-record_id'),recipient=grant.locator('#field-user_id');
  await expect(record).toHaveAccessibleName(new RegExp(t('accessRecordToShare')));
  await expect(recipient).toHaveAccessibleName(new RegExp(t('accessRecipient')));
  await expect(recipient).toHaveAttribute('aria-describedby','field-user_id-help');
  await expect(grant.locator('#field-user_id-help')).toHaveText(t('accessRecipientHint'));
  const editing=grant.getByRole('checkbox',{name:t('accessAllowEditing'),exact:true});
  await expect(editing).not.toBeChecked();
  const save=grant.getByRole('button',{name:t('accessGrantAccess'),exact:true});
  await expect(save).toBeDisabled();
  await selectExisting(record);await expect(save).toBeDisabled();
  await selectExisting(recipient);await expect(save).toBeEnabled();
  const selectedRecipient=await recipient.inputValue();
  await grant.getByRole('combobox',{name:t('accessRecordType'),exact:true}).selectOption('organizations');
  await expect(record).toHaveValue('');await expect(recipient).toHaveValue(selectedRecipient);await expect(save).toBeDisabled();
  const permissionDetails=grant.locator('details.access-permission-details');
  await expect(permissionDetails).not.toHaveAttribute('open','');await permissionDetails.locator('summary').click();
  for(const key of ['accessRecordScope','accessMemberDetails','accessGrantLimits','accessExistingRights'])await expect(permissionDetails).toContainText(t(key));
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`docs/qa/browser/access-sharing-${locale}.png`,fullPage:true});
  await grant.getByRole('button',{name:t('close'),exact:true}).click();await expect(grant).not.toBeVisible();

  await access.getByRole('button',{name:t('permissionPolicy'),exact:true}).click();
  const policy=page.getByRole('dialog',{name:t('permissionPolicy'),exact:true});
  await expect(policy.locator('#access-resource')).toHaveValue('contacts');await expect(policy.locator('#access-role')).toHaveValue('member');await expect(policy.locator('#access-operation')).toHaveValue('read');await expect(policy.locator('#access-scope')).toHaveValue('own');
  await policy.locator('#access-resource').selectOption('tax_rates');await policy.locator('#access-role').selectOption('reviewer');await policy.locator('#access-operation').selectOption('approve');await policy.locator('#access-scope').selectOption('granted');
  await policy.getByRole('button',{name:t('close'),exact:true}).click();
  await access.getByRole('button',{name:t('permissionPolicy'),exact:true}).click();
  await expect(policy.locator('#access-resource')).toHaveValue('contacts');await expect(policy.locator('#access-role')).toHaveValue('member');await expect(policy.locator('#access-operation')).toHaveValue('read');await expect(policy.locator('#access-scope')).toHaveValue('own');
  await policy.getByRole('button',{name:t('close'),exact:true}).click();
  await nav.getByRole('button',{name:t('profile'),exact:true}).click();
  await expect(page.locator('ol.sidebar-order')).toBeVisible();await expect(page.locator('.sidebar-order-hint')).toHaveCount(0);

  await page.locator('.sidebar nav').getByRole('button',{name:t('validation'),exact:true}).click();
  await expect(page.locator('.module-nav')).toBeVisible();
  for(const spec of recordForms){
   const resourceLabel=resources[spec.key].label[localeIndex(locale)];
   await page.locator('.module-nav').getByRole('button',{name:resourceLabel,exact:true}).click();
   const resource=page.locator('main .resource-view');
   await expect(resource.locator('.page-heading h1')).toHaveText(resourceLabel);
   await expect(page.locator('.page-loading,.boot-screen,main .loading')).toHaveCount(0);
   await resource.getByRole('button',{name:`${t('add')} ${resourceLabel}`,exact:true}).click();
   const form=page.getByRole('dialog',{name:`${t('add')} · ${resourceLabel}`,exact:true});
   await expect(form).toBeVisible();
   for(const field of spec.fields){
    const expected=recordFields[field];
    const hint=spec.key==='feedback'&&field==='interpretation'?'feedbackAnalysisHelp':expected.hint;
    await expect(form.locator(`#field-${field}`)).toHaveAccessibleName(expected.label[localeIndex(locale)]);
    await expect(form.locator(`#field-${field}`)).toHaveAttribute('aria-describedby',`field-${field}-help`);
    await expect(form.locator(`#field-${field}-help`)).toHaveText(t(hint));
   }
   await expect(form.locator('#field-project_id option[value=""]')).toHaveText(t('unassigned'));
   await expect(form.locator('#field-project_id')).toHaveValue('');
   const labels=await form.locator('.field > label').allTextContents();
   for(const old of replacedLabels[localeIndex(locale)])expect(labels.map(text=>text.trim())).not.toContain(old);
   if(spec.key==='interviews')await page.screenshot({path:`docs/qa/browser/interview-fields-${locale}.png`,fullPage:true});
   await form.getByRole('button',{name:t('cancel'),exact:true}).click();await expect(form).not.toBeVisible();
  }
  const issueLabel=['問題回報','问题报告','Issue reports'][localeIndex(locale)];
  await expect(page.locator('.module-nav').getByRole('button',{name:issueLabel,exact:true})).toBeVisible();
  await page.locator('.module-nav').getByRole('button',{name:issueLabel,exact:true}).click();
  await expect(page.locator('main .resource-view .page-heading h1')).toHaveText(issueLabel);
  await page.locator('main .resource-view').getByRole('button',{name:`${t('add')} ${issueLabel}`,exact:true}).click();
  const issueForm=page.getByRole('dialog',{name:`${t('add')} · ${issueLabel}`,exact:true});
  await expect(issueForm).toBeVisible();
  await issueForm.getByRole('button',{name:t('cancel'),exact:true}).click();await expect(issueForm).not.toBeVisible();
  await page.goto('/data/contracts');await expect(page.locator('main .resource-view')).toBeVisible();
  const contractLabel=resources.contracts.label[localeIndex(locale)];
  await page.locator('main .resource-view').getByRole('button',{name:`${t('add')} ${contractLabel}`,exact:true}).click();
  const contractForm=page.getByRole('dialog',{name:`${t('add')} · ${contractLabel}`,exact:true});
  await expect(contractForm.locator('#field-document_id')).toHaveAccessibleName(locale==='en'?'Linked contract document':locale==='zh-CN'?'关联合约文件':'關聯合約文件');
  await expect(contractForm.locator('#field-document_id')).toHaveAttribute('aria-describedby','field-document_id-help');await expect(contractForm.locator('#field-document_id-help')).toHaveText(t('contractDocumentHelp'));
  await expect(contractForm.locator('#field-project_id option[value=""]')).toHaveText(t('unassigned'));await expect(contractForm.locator('#field-project_id')).toHaveValue('');
  await contractForm.getByRole('button',{name:t('cancel'),exact:true}).click();await expect(contractForm).not.toBeVisible();
  await page.goto('/data/handoffs');await expect(page.locator('main .resource-view')).toBeVisible();
  const handoffLabel=resources.handoffs.label[localeIndex(locale)];await page.locator('main .resource-view').getByRole('button',{name:`${t('add')} ${handoffLabel}`,exact:true}).click();
  const handoffForm=page.getByRole('dialog',{name:`${t('add')} · ${handoffLabel}`,exact:true});
  await expect(handoffForm.locator('#field-task_id')).not.toHaveAttribute('required','');await expect(handoffForm.locator('#field-task_id')).toHaveValue('');
  await expect(handoffForm.locator('#field-task_id-help')).toHaveText(t('handoffTaskHelp'));await expect(handoffForm.locator('#field-task_id')).toHaveAttribute('aria-describedby','field-task_id-help');
  await expect(handoffForm.locator('#field-to_user_id')).toHaveAttribute('required','');await expect(handoffForm.locator('#field-to_user_id')).toHaveValue('');
  await handoffForm.getByRole('button',{name:t('cancel'),exact:true}).click();await expect(handoffForm).not.toBeVisible();
  if(feedbackId){
   await page.goto(`/data/feedback?record=${encodeURIComponent(feedbackId)}`);
   const detail=page.getByRole('dialog');await expect(detail.locator('dl.detail-fields')).toBeVisible();
   for(const field of ['direct_quote','interpretation','evidence_source'] as const)await expect(detail.locator('dt').filter({hasText:new RegExp(`^${recordFields[field].label[localeIndex(locale)]}$`)})).toHaveCount(1);
   const labels=await detail.locator('dt').allTextContents();for(const old of replacedLabels[localeIndex(locale)])expect(labels).not.toContain(old);
   await expect(detail.getByRole('button',{name:['建立問題回報','创建问题报告','Create issue report'][localeIndex(locale)],exact:true})).toBeVisible();
   await detail.getByRole('button',{name:t('close'),exact:true}).click();await expect(detail).not.toBeVisible();
  }
  expect(writes).toEqual([]);
 });
}
