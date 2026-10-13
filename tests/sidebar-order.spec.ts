import {test,expect,type APIRequestContext,type BrowserContext,type Page} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {signIn} from './helpers/sign-in';
import {translate} from '../src/locales';
import type {Preferences} from '../src/components/types';

const origin=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
import {navigationOrder as navigation} from '../src/components/navigation-order';
let request:APIRequestContext,cookies:Awaited<ReturnType<BrowserContext['cookies']>>,original:Preferences;
const label=(key:string)=>translate('en',key);
const item=(page:Page,key:string)=>page.locator(`.sidebar-order-item[data-id="${key}"]`);
const order=(page:Page)=>page.locator('.sidebar-order-item').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-id')));

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
 expect((await request.put('/api/preferences',{data:{...original,locale:'en',sidebar:{...original.sidebar,order:navigation,hidden:[],collapsed:false,shortcuts:[]}}})).status()).toBe(200);
 await context.addCookies(cookies);
 await page.setViewportSize({width:1440,height:1100});
 await page.emulateMedia({reducedMotion:'reduce'});
});
test.afterAll(async()=>{if(request){if(original)expect((await request.put('/api/preferences',{data:original})).status()).toBe(200);await request.dispose();}});

async function openProfile(page:Page){
 await page.goto('/settings');
 await expect(page.locator('.settings-layout')).toBeVisible();
 await expect(page.locator('.page-loading,.boot-screen,main .loading')).toHaveCount(0);
 await page.locator('.settings-nav').getByRole('button',{name:'Personal settings',exact:true}).click();
 await expect(page.locator('ol.sidebar-order')).toBeVisible();
 await expect(page.locator('.sidebar-order-item')).toHaveCount(navigation.length);
 await page.evaluate(()=>document.fonts.ready);
}
async function rects(page:Page){return page.locator('.sidebar-order-item').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {id:node.getAttribute('data-id'),x:box.x,y:box.y,width:box.width,height:box.height};}));}
function inserted(values:string[],from:number,to:number){const next=[...values];const [moved]=next.splice(from,1);next.splice(to,0,moved);return next;}
async function screenshot(page:Page,path:string){await page.evaluate(()=>window.scrollTo(0,0));await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);await page.screenshot({path,fullPage:true});}
async function saveAndVerify(page:Page,expected:string[]){
 await page.locator('.settings-content').getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).data.sidebar.order).toEqual(expected);
 await expect(page.locator('.sidebar nav .nav-item:not(.shortcut)')).toHaveText(expected.map(label));
 await page.reload();
 await expect(page.locator('.settings-layout')).toBeVisible();
 await expect(page.locator('.sidebar nav .nav-item:not(.shortcut)')).toHaveText(expected.map(label));
 await page.locator('.settings-nav').getByRole('button',{name:'Personal settings',exact:true}).click();
 await expect.poll(()=>order(page)).toEqual(expected);
}

test('desktop order flows down the left column before the right, and arrows follow that sequence through the boundary',async({page})=>{
 await openProfile(page);await expect.poll(()=>order(page)).toEqual(navigation);
 const initial=await rects(page),half=Math.ceil(initial.length/2);
 for(let i=0;i<half;i++){
  expect(Math.abs(initial[i].x-initial[0].x)).toBeLessThan(2);
  if(initial[i+half]){expect(Math.abs(initial[i+half].x-initial[half].x)).toBeLessThan(2);expect(Math.abs(initial[i].y-initial[i+half].y)).toBeLessThan(2);}
  if(i){expect(initial[i].y).toBeGreaterThan(initial[i-1].y);if(initial[i+half])expect(initial[i+half].y).toBeGreaterThan(initial[i+half-1].y);}
 }
 expect(initial[half].x).toBeGreaterThan(initial[0].x+initial[0].width);
 await expect(item(page,'overview').getByRole('button',{name:/^Move up/})).toBeDisabled();
 await expect(item(page,'settings').getByRole('button',{name:/^Move down/})).toBeDisabled();
 await item(page,'contacts').getByRole('button',{name:/^Move down/}).click();
 let expected=inserted(navigation,1,2);
 await expect.poll(()=>order(page)).toEqual(expected);
 const afterDown=(await rects(page)).find(row=>row.id==='contacts')!;
 expect(Math.abs(afterDown.x-initial[1].x)).toBeLessThan(2);
 expect(afterDown.y).toBeGreaterThan(initial[1].y);
 const boundary=navigation[half-1];await item(page,boundary).getByRole('button',{name:/^Move down/}).click();
 expected=inserted(expected,half-1,half);
 await expect.poll(()=>order(page)).toEqual(expected);
 const atBoundary=await rects(page),calendar=atBoundary.find(row=>row.id===boundary)!;
 expect(Math.abs(calendar.x-atBoundary[half+1].x)).toBeLessThan(2);
 expect(Math.abs(calendar.y-atBoundary[0].y)).toBeLessThan(2);
 expect(atBoundary[half-1].id).toBe(navigation[half]);
 await saveAndVerify(page,expected);
 await screenshot(page,'docs/qa/browser/sidebar-order-arrows.png');
});

test('pointer drag inserts Settings across columns, shifts intermediate items and matches the saved sidebar after reload',async({page})=>{
 await openProfile(page);
 const handle=item(page,'settings').locator('.sidebar-drag-handle');
 await handle.scrollIntoViewIfNeeded();
 const source=await handle.boundingBox(),target=await item(page,'organizations').boundingBox();
 expect(source).not.toBeNull();expect(target).not.toBeNull();
 const from={x:source!.x+source!.width/2,y:source!.y+source!.height/2};
 const to={x:target!.x+target!.width/2,y:target!.y+target!.height/2};
 await page.mouse.move(from.x,from.y);await page.mouse.down();
 await page.mouse.move(from.x-10,from.y-10,{steps:3});
 await page.mouse.move(to.x,to.y,{steps:20});await page.mouse.up();
 const expected=inserted(navigation,navigation.indexOf('settings'),2);
 await expect.poll(()=>order(page)).toEqual(expected);
 expect((await order(page)).slice(3)).toEqual(navigation.slice(2,navigation.indexOf('settings')));
 await saveAndVerify(page,expected);
 await expect(page.locator('.sidebar nav .nav-item:not(.shortcut)').nth(2)).toHaveText('Settings');
 await screenshot(page,'docs/qa/browser/sidebar-order-drag-insertion.png');
});

test('keyboard drag crosses the column boundary, Escape cancels, and phone order becomes one vertical column',async({page})=>{
 await page.setViewportSize({width:1440,height:640});
 await openProfile(page);
 const boundaryIndex=Math.ceil(navigation.length/2)-1,boundary=navigation[boundaryIndex],next=navigation[boundaryIndex+1];const handle=item(page,boundary).locator('.sidebar-drag-handle');
 await handle.focus();await page.keyboard.press('Space');
 await expect(item(page,boundary)).toHaveClass(/is-dragging/);
 await expect(handle).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('ArrowDown');
 let expected=inserted(navigation,boundaryIndex,boundaryIndex+1);
 await expect.poll(()=>order(page)).toEqual(expected);
 await expect(handle).toBeFocused();
 expect((await(await request.get('/api/preferences')).json()).data.sidebar.order).toEqual(navigation);
 await page.keyboard.press('Space');
 await expect(item(page,boundary)).not.toHaveClass(/is-dragging/);
 const cancelHandle=item(page,next).locator('.sidebar-drag-handle');
 await cancelHandle.focus();await page.keyboard.press('Space');
 await expect(item(page,next)).toHaveClass(/is-dragging/);
 await expect(cancelHandle).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('ArrowDown');
 await expect.poll(()=>order(page)).toEqual(inserted(expected,boundaryIndex,boundaryIndex+1));
 await expect(cancelHandle).toBeFocused();
 await page.keyboard.press('Escape');
 await expect.poll(()=>order(page)).toEqual(expected);
 await expect(item(page,next)).not.toHaveClass(/is-dragging/);
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('ol.sidebar-order')).toBeVisible();
 const mobile=await rects(page);
 for(let i=0;i<mobile.length;i++){
  expect(Math.abs(mobile[i].x-mobile[0].x)).toBeLessThan(2);
  if(i)expect(mobile[i].y).toBeGreaterThan(mobile[i-1].y);
 }
 const down=item(page,'overview').getByRole('button',{name:/^Move down/});
 await down.focus();await page.keyboard.press('Enter');
 expected=inserted(expected,0,1);
 await expect.poll(()=>order(page)).toEqual(expected);
 expect(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth+1)).toBe(true);
 await screenshot(page,'docs/qa/browser/sidebar-order-phone.png');
 await page.setViewportSize({width:1440,height:1100});
 await saveAndVerify(page,expected);
});

test('mobile trusted touch drag inserts an item and persists the matching sidebar sequence',async({browser})=>{
 const context=await browser.newContext({baseURL:origin,viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
 try{
  await context.addCookies(cookies);
  const page=await context.newPage();await openProfile(page);
  expect(await page.evaluate(()=>navigator.maxTouchPoints)).toBeGreaterThan(0);
  await item(page,'contacts').evaluate(element=>element.scrollIntoView({block:'center'}));
  const handle=item(page,'contacts').locator('.sidebar-drag-handle');
  const source=await handle.boundingBox(),target=await item(page,'organizations').boundingBox();
  expect(source).not.toBeNull();expect(target).not.toBeNull();
  const from={x:source!.x+source!.width/2,y:source!.y+source!.height/2};
  const to={x:from.x,y:target!.y+target!.height/2};
  expect(from.y).toBeGreaterThan(64);expect(to.y).toBeLessThan(844);
  await page.evaluate(()=>document.addEventListener('pointerdown',event=>{document.documentElement.dataset.sidebarTestTouch=JSON.stringify({trusted:event.isTrusted,pointerType:event.pointerType});},{once:true}));
  const session=await context.newCDPSession(page);
  const point=(x:number,y:number)=>({x,y,id:1,radiusX:5,radiusY:5,force:1});
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(from.x,from.y)]});
  await expect(page.locator('html')).toHaveAttribute('data-sidebar-test-touch',JSON.stringify({trusted:true,pointerType:'touch'}));
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(from.x,from.y+10)]});
  await expect(item(page,'contacts')).toHaveClass(/is-dragging/);
  for(let step=1;step<=6;step++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(from.x,from.y+10+(to.y-from.y-10)*step/6)]});
  await expect(page.locator('[role="status"][aria-live="assertive"]')).toContainText(`Contacts. Position 3 / ${navigation.length}.`);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(item(page,'contacts')).not.toHaveClass(/is-dragging/);
  const expected=inserted(navigation,1,2);
  await expect.poll(()=>order(page)).toEqual(expected);
  await saveAndVerify(page,expected);
  await screenshot(page,'docs/qa/browser/sidebar-order-touch-phone.png');
  await page.locator('.topbar').getByRole('button',{name:'Expand sidebar',exact:true}).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar nav .nav-item:not(.shortcut)')).toHaveText(expected.map(label));
  await session.detach();
 }finally{await context.close();}
});
