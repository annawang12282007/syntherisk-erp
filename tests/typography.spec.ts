import {test,expect,type APIRequestContext,type BrowserContext,type Page,type CDPSession} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {signIn} from './helpers/sign-in';
import {defaultTheme} from '../src/components/theme';

const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,original:Record<string,unknown>;
const evidence:unknown[]=[];
test.beforeAll(async({playwright})=>{
 test.setTimeout(120000);
 const demo=JSON.parse(await readFile('data/demo-credentials.json','utf8'));
 request=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
 expect((await signIn(request,demo.users[0])).status()).toBe(200);
 cookies=(await request.storageState()).cookies;
 original=(await(await request.get('/api/preferences')).json()).data;
 await mkdir('docs/qa/browser',{recursive:true});
});
test.beforeEach(async({context})=>{await context.addCookies(cookies);});
test.afterAll(async()=>{
 if(request){expect((await request.put('/api/preferences',{data:original})).status()).toBe(200);await request.dispose();}
 await writeFile('docs/qa/typography-rendered-fonts.json',JSON.stringify(evidence,null,2));
});
async function renderedFonts(cdp:CDPSession,selector:string){
 const {root}=await cdp.send('DOM.getDocument');
 const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
 return (await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;
}
async function checkChinese(page:Page,cdp:CDPSession,selector:string,region:string){
 await page.evaluate(()=>document.fonts.ready);
 const fonts=await renderedFonts(cdp,selector);
 expect(fonts.length).toBeGreaterThan(0);
 for(const font of fonts){expect(font.isCustomFont,`${selector}: ${font.familyName}`).toBe(true);expect(font.familyName).toMatch(new RegExp(`Noto Sans ${region}`));}
 return fonts;
}
for(const locale of ['zh-TW','zh-CN','en'] as const)test(`self-hosted CJK glyphs at real UI weights and responsive layout: ${locale}`,async({page,context})=>{
 expect((await request.put('/api/preferences',{data:{...original,locale,theme:defaultTheme}})).status()).toBe(200);
 const failed:string[]=[],externalFonts:string[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.url().includes('/fonts/')&&response.status()>=400)failed.push(response.url());});
 page.on('request',r=>{if(r.resourceType()==='font'&&new URL(r.url()).origin!==origin)externalFonts.push(r.url());});
 await page.setViewportSize({width:1440,height:1000});await page.goto('/');
 await expect(page.locator('main h1')).toBeVisible();
 await expect(page.locator('.table-loading,.page-loading,.boot-screen,main .loading')).toHaveCount(0);
 const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const region=locale==='zh-CN'?'SC':'TC',results:unknown[]=[];
 if(locale!=='en')results.push({selector:'main h1',fonts:await checkChinese(page,cdp,'main h1',region)});
 await page.screenshot({path:`docs/qa/browser/typography-overview-${locale}.png`,fullPage:true});
 await page.goto('/settings');await expect(page.locator('.appearance-settings')).toBeVisible();
 if(locale!=='en')results.push({selector:'.appearance-preview h3',fonts:await checkChinese(page,cdp,'.appearance-preview h3',region)});
 // Chinese-only probes reveal platform fallback even when computed font-family looks correct.
 for(const weight of [400,500,600,700]){
  await page.evaluate(({weight,text})=>{const sample=document.createElement('span');sample.id=`glyphs-${weight}`;sample.textContent=text;sample.style.fontWeight=String(weight);document.body.append(sample);},{weight,text:locale==='zh-CN'?'工作总览字体设置草稿重新登入继续边框圆角密度':'工作總覽字體設定草稿重新登入繼續邊框圓角密度'});
  results.push({weight,fonts:await checkChinese(page,cdp,`#glyphs-${weight}`,region)});
  await page.locator(`#glyphs-${weight}`).evaluate(element=>element.remove());
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.fonts.ready);
 expect(await page.locator('body').evaluate(element=>element.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:`docs/qa/browser/typography-settings-${locale}-phone.png`,fullPage:true});
 expect(failed).toEqual([]);expect(externalFonts).toEqual([]);expect(errors).toEqual([]);
 evidence.push({locale,results,failed,externalFonts,errors});
});

test('financial print uses the same self-hosted Chinese fonts',async({page,context})=>{
 expect((await request.put('/api/preferences',{data:{...original,locale:'zh-TW'}})).status()).toBe(200);
 const response=await request.get('/api/data/customer_quotes?pageSize=1');expect(response.status()).toBe(200);
 const record=(await response.json()).data.rows[0];expect(record,'seeded demo quote required').toBeTruthy();
 const print=await page.goto(`/api/print?resource=customer_quotes&id=${record.id}`);expect(print?.status()).toBe(200);
 await expect(page.locator('.sheet h1')).toBeVisible();
 const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const fonts=await checkChinese(page,cdp,'.sheet h1','TC');
 await page.emulateMedia({media:'print'});await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:'docs/qa/browser/typography-print.png',fullPage:true});
 evidence.push({view:'financial-print',fonts});
});
