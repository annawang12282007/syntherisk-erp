import {test,expect,type APIRequestContext,type BrowserContext,type Page} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {signIn} from './helpers/sign-in';
import {defaultTheme,darkTheme} from '../src/components/theme';
import {translate,type Locale} from '../src/locales';

const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,original:Record<string,unknown>;
const initialTheme={...defaultTheme,primary:'#315EA8',background:'#F2F5FA',surface:'#FFFFFF',text:'#182C46',border:'#D2DCEB'};
test.beforeAll(async({playwright})=>{
 test.setTimeout(120000);
 const demo=JSON.parse(await readFile('data/demo-credentials.json','utf8'));
 request=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
 expect((await signIn(request,demo.users[0])).status()).toBe(200);
 cookies=(await request.storageState()).cookies;
 original=(await(await request.get('/api/preferences')).json()).data;
 await mkdir('docs/qa/browser',{recursive:true});
});
test.beforeEach(async({context,page})=>{
 expect((await request.put('/api/preferences',{data:{...original,locale:'en',theme:initialTheme}})).status()).toBe(200);
 await context.addCookies(cookies);await page.emulateMedia({colorScheme:'light'});
});
test.afterAll(async()=>{if(request){expect((await request.put('/api/preferences',{data:original})).status()).toBe(200);await request.dispose();}});
async function ready(page:Page){await expect(page.locator('.appearance-settings')).toBeVisible();await expect(page.locator('.page-loading,.boot-screen,main .loading')).toHaveCount(0);}
async function token(page:Page,key:string){return page.locator('html').evaluate((element,name)=>getComputedStyle(element).getPropertyValue(`--${name}`).trim().toUpperCase(),key);}
async function slider(page:Page,name:string,steps:number){const input=page.getByRole('slider',{name,exact:true});await input.focus();await input.press('Home');for(let i=0;i<steps;i++)await input.press('ArrowRight');}

test('theme modes separate preset colors from custom palette and preserve shared settings across save and reload',async({page})=>{
 await page.goto('/settings');await ready(page);
 await expect(page.getByRole('button',{name:'Light',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.custom-palette')).toHaveCount(0);
 expect(await token(page,'primary')).toBe(defaultTheme.primary.toUpperCase());
 await page.getByRole('button',{name:'Custom',exact:true}).click();
 await expect(page.locator('.custom-palette input[type=color]')).toHaveCount(5);
 await page.getByRole('textbox',{name:'Primary HEX',exact:true}).fill('#285A91');
 await expect.poll(()=>token(page,'primary')).toBe('#285A91');
 await slider(page,'Font size',6);await slider(page,'Corner radius',10);
 await page.getByRole('combobox',{name:'Density',exact:true}).selectOption('compact');
 await page.getByRole('button',{name:'Dark',exact:true}).click();
 await expect(page.locator('.custom-palette')).toHaveCount(0);
 await expect(page.getByRole('slider',{name:'Font size',exact:true})).toHaveValue('18');
 await expect.poll(()=>token(page,'primary')).toBe(darkTheme.primary.toUpperCase());
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).data.theme).toMatchObject({mode:'dark',primary:'#285A91',fontSize:18,radius:10,density:'compact'});
 await page.reload();await ready(page);
 await expect(page.getByRole('button',{name:'Dark',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('slider',{name:'Font size',exact:true})).toHaveValue('18');
 await expect(page.getByRole('slider',{name:'Corner radius',exact:true})).toHaveValue('10');
 await expect(page.getByRole('combobox',{name:'Density',exact:true})).toHaveValue('compact');
 await page.getByRole('button',{name:'Custom',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Primary HEX',exact:true})).toHaveValue('#285A91');
 await expect.poll(()=>token(page,'primary')).toBe('#285A91');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).data.theme.mode).toBe('custom');
 await page.reload();await ready(page);
 await expect.poll(()=>token(page,'primary')).toBe('#285A91');
 await page.screenshot({path:'docs/qa/browser/appearance-custom-preserved.png',fullPage:true});
});

test('unsaved system preview follows device changes and restores saved appearance when leaving settings',async({page})=>{
 await page.goto('/settings');await ready(page);
 await page.getByRole('button',{name:'System',exact:true}).click();
 await expect.poll(()=>token(page,'background')).toBe(defaultTheme.background.toUpperCase());
 await page.emulateMedia({colorScheme:'dark'});
 await expect.poll(()=>token(page,'background')).toBe(darkTheme.background.toUpperCase());
 expect((await(await request.get('/api/preferences')).json()).data.theme.mode).toBe('light');
 await page.emulateMedia({colorScheme:'light'});
 await expect.poll(()=>token(page,'background')).toBe(defaultTheme.background.toUpperCase());
 await page.getByRole('button',{name:'Custom',exact:true}).click();
 await page.emulateMedia({colorScheme:'dark'});
 await expect.poll(()=>token(page,'background')).toBe(initialTheme.background.toUpperCase());
 await page.locator('.settings-nav').getByRole('button',{name:'Personal settings',exact:true}).click();
 await expect.poll(()=>token(page,'background')).toBe(defaultTheme.background.toUpperCase());
 await page.locator('.settings-nav').getByRole('button',{name:'Appearance & layout',exact:true}).click();
 await page.getByRole('button',{name:'System',exact:true}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).data.theme.mode).toBe('system');
 await page.reload();await ready(page);
 await expect(page.getByRole('button',{name:'System',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>token(page,'background')).toBe(darkTheme.background.toUpperCase());
 await page.emulateMedia({colorScheme:'light'});
 await expect.poll(()=>token(page,'background')).toBe(defaultTheme.background.toUpperCase());
 await page.screenshot({path:'docs/qa/browser/appearance-system-mode.png',fullPage:true});
});

test('appearance sample is clearly non-record content in all languages and fits a phone',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 for(const locale of ['zh-TW','zh-CN','en'] as Locale[]){
  expect((await request.put('/api/preferences',{data:{...original,locale,theme:initialTheme}})).status()).toBe(200);
  await page.goto('/settings');await ready(page);
  const sample=page.getByRole('region',{name:translate(locale,'themePreviewTitle'),exact:true});
  await expect(sample).toContainText(translate(locale,'themePreviewHint'));
  await expect(sample).not.toContainText(translate(locale,'draftHint'));
  await expect(sample.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('group',{name:translate(locale,'theme'),exact:true}).getByRole('button')).toHaveCount(4);
  await expect(page.getByRole('slider',{name:translate(locale,'fontSize'),exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:translate(locale,'density'),exact:true})).toBeVisible();
  expect(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:`docs/qa/browser/appearance-phone-${locale}.png`,fullPage:true});
 }
});
