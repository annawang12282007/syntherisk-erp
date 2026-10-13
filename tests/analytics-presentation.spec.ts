import {test,expect,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {signIn} from './helpers/sign-in';
import {translate,type Locale} from '../src/locales';

let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,preferences:Record<string,unknown>;
const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
const cases:[Locale,string,string,string][]=[
 ['zh-TW','營運紀錄','已入帳','正式財務報表只包含已入帳紀錄；不同幣別分開呈現。'],
 ['zh-CN','运营记录','已入账','正式财务报表仅包含已入账记录；不同币种分别呈现。'],
 ['en','Operational records','Posted entries','Financial statements include posted entries only. Currencies remain separate.'],
];
test.beforeAll(async({playwright})=>{
 test.setTimeout(120000);
 const demo=JSON.parse(await readFile('data/demo-credentials.json','utf8'));
 request=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
 expect((await signIn(request,demo.users[0])).status()).toBe(200);
 cookies=(await request.storageState()).cookies;
 preferences=(await(await request.get('/api/preferences')).json()).data;
});
test.beforeEach(async({context})=>{await context.addCookies(cookies);});
test.afterAll(async()=>{if(request){try{expect((await request.put('/api/preferences',{data:preferences})).status()).toBe(200);}finally{await request.dispose();}}});

for(const [locale,operationalScope,postedScope,oldHint]of cases)test(`analytics presents accurate compact report scope in ${locale}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 expect((await request.put('/api/preferences',{data:{...preferences,locale}})).status()).toBe(200);
 await page.goto('/analytics');
 await expect(page.getByRole('heading',{name:translate(locale,'analytics'),exact:true})).toBeVisible();
 await expect(page.locator('.page-heading p')).toHaveCount(0);
 await expect(page.getByText(oldHint,{exact:true})).toHaveCount(0);
 await expect(page.getByText(operationalScope,{exact:true})).toBeVisible();
 await expect(page.getByText(postedScope,{exact:true})).toHaveCount(0);
 await expect(page.locator('.report-card').first()).toBeVisible();
 await page.locator('.report-tabs').getByRole('button',{name:translate(locale,'finance'),exact:true}).click();
 const statements=page.locator('section[aria-labelledby="posted-reports-heading"]');
 const management=page.locator('section[aria-labelledby="management-reports-heading"]');
 await expect(statements.getByText(postedScope,{exact:true})).toBeVisible();
 await expect(statements.locator('dd').filter({hasText:new RegExp(`^${translate(locale,'analyticsSeparateCurrencies')}$`)})).toBeVisible();
 await expect(statements.locator('details')).not.toHaveAttribute('open','');
 await expect(management.getByText(postedScope,{exact:true})).toHaveCount(0);
 for(const [key,scope,currency]of [
  ['ar_ap','analyticsScopeApproved','analyticsSeparateCurrencies'],
  ['budgets','analyticsScopeBudget','analyticsBudgetCurrency'],
  ['subscriptions','analyticsScopeSubscriptions','analyticsSeparateCurrencies'],
  ['cashflow','analyticsScopePayments','analyticsSeparateCurrencies'],
 ]){
  const card=management.locator('.report-card').filter({has:page.getByRole('heading',{name:translate(locale,key),exact:true})});
  await expect(card.getByText(translate(locale,scope),{exact:true})).toBeVisible();
  await expect(card.getByText(translate(locale,currency),{exact:true})).toBeVisible();
 }
 await page.setViewportSize({width:390,height:844});
 expect(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth+1)).toBeTruthy();
 expect(errors).toEqual([]);
});
