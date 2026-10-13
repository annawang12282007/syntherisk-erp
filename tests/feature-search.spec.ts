import {test,expect,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {signIn} from './helpers/sign-in';
import {translate,type Locale} from '../src/locales';
import type {Preferences} from '../src/components/types';
const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,original:Preferences;
test.beforeAll(async({playwright})=>{test.setTimeout(120000);const demo=JSON.parse(await readFile('data/demo-credentials.json','utf8'));request=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});expect((await signIn(request,demo.users[0])).status()).toBe(200);cookies=(await request.storageState()).cookies;original=(await(await request.get('/api/preferences')).json()).data;});
test.afterAll(async()=>{if(request){if(original)expect((await request.put('/api/preferences',{data:original})).status()).toBe(200);await request.dispose();}});
for(const locale of ['zh-TW','zh-CN','en'] as Locale[])test(`function search navigates to settings and create destinations in ${locale}`,async({context,page})=>{
 const t=(key:string)=>translate(locale,key);expect((await request.put('/api/preferences',{data:{...original,locale}})).status()).toBe(200);await context.addCookies(cookies);await page.goto('/');
 await page.locator('.global-search-trigger').click();let dialog=page.getByRole('dialog');await dialog.getByRole('textbox').fill(locale==='en'?'appearance':locale==='zh-CN'?'字体':'字體');
 await dialog.getByRole('region',{name:t('searchFunctions'),exact:true}).getByRole('button',{name:new RegExp(t('appearance'))}).click();await expect(page).toHaveURL(/settings\?section=appearance/);await expect(page.locator('.settings-nav button.active')).toHaveText(t('appearance'));
 await page.locator('.global-search-trigger').click();dialog=page.getByRole('dialog');await dialog.getByRole('textbox').fill(locale==='en'?'quick create':'快捷新增');await dialog.locator('.function-results button').first().click();await expect(page).toHaveURL(/settings\?section=profile/);await expect(page.locator('.settings-nav button.active')).toHaveText(t('profile'));
 await page.locator('.global-search-trigger').click();dialog=page.getByRole('dialog');const contact=locale==='en'?'Contacts':locale==='zh-CN'?'联系人':'聯絡人';await dialog.getByRole('textbox').fill(`${t('add')} ${contact}`);await dialog.locator('.function-results').getByRole('button',{name:`${t('add')} · ${contact} ${t('quickCreate')}`,exact:true}).click();await expect(page).toHaveURL(/data\/contacts\?new=1/);await expect(page.getByRole('dialog',{name:`${t('add')} · ${contact}`,exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();
});
