/* Run against a static server: PLAYWRIGHT_MODULE=/path/to/playwright node test/stamp.browser.cjs */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/https:\/\/(fonts\.googleapis|fonts\.gstatic)\.com\//,r=>r.abort());
 const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8765';
 await page.goto(`${base}/signature.html#stamp`);
 const ready=()=>page.waitForFunction(()=>window.SealStudio?.snapshot()&&!document.getElementById('seal-download').disabled);
 const input=async(name,value)=>{await page.locator(`#seal-form [name="${name}"]`).fill(value);await ready();};
 const select=async(name,value)=>{await page.locator(`#seal-form [name="${name}"]`).selectOption(value);await ready();};
 await ready();
 for(const name of ['김민','홍길동','남궁민수','金民','洪吉童','南宮民秀','홍吉동']){await input('name',name);assert.equal(await page.locator('#seal-art path').count()>0,true);}
 console.log('PASS personal Hangul/Hanja 2–4 characters and mixed scripts');
 async function pixels(size){return page.evaluate(async size=>{
  const snap=SealStudio.snapshot(),blob=await SealStudio.png(snap,size),image=await createImageBitmap(blob);
  const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const a=ctx.getImageData(0,0,c.width,c.height).data;
  let transparent=0,opaque=0,edgeInk=0;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const alpha=a[(y*c.width+x)*4+3];if(alpha===0)transparent++;if(alpha>200)opaque++;if((x===0||y===0||x===c.width-1||y===c.height-1)&&alpha)edgeInk++;}
  const url=URL.createObjectURL(new Blob([snap.svg],{type:'image/svg+xml'}));const svg=new Image();svg.src=url;await svg.decode();ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(svg,0,0,c.width,c.height);URL.revokeObjectURL(url);const b=ctx.getImageData(0,0,c.width,c.height).data;let diff=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])diff++;
  return {width:c.width,height:c.height,transparent,opaque,edgeInk,diff};
 },size);}
 for(const shape of ['circle','square','rectangle','ellipse']){
  await page.locator(`[data-shape="${shape}"]`).click();await ready();const p=await pixels(1024);assert.equal(Math.max(p.width,p.height),1024);assert(p.transparent>0&&p.opaque>0);assert.equal(p.edgeInk,0);assert.equal(p.diff,0);if(shape==='rectangle'||shape==='ellipse')assert.notEqual(p.width,p.height);
 }
 console.log('PASS four shapes, aspect ratios, alpha, unclipped boundaries, exact SVG/PNG pixel match');
 await page.locator('[data-kind="corporate"]').click();await ready();
 for(const name of ['한빛','주식회사대한민국전문업무문서솔루션연구개발센터']){await input('name',name);assert.equal(await page.locator('[data-company-glyph]').count(),Array.from(name).length);}
 for(const title of ['대표이사','代表理事']){await page.locator('#seal-title-preset').selectOption(title);await ready();assert.equal(await page.locator('[name=title]').inputValue(),title);}
 for(const layout of ['auto','horizontal','vertical','columns'])await select('titleLayout',layout);
 for(const font of ['myeongjo','gothic']){await select('font',font);await select('titleFont',font);}
 await select('font','myeongjo');await select('titleFont','myeongjo');
 console.log('PASS short/long corporate circular names, independent Hangul/Hanja titles, fonts and layouts');
 await input('name','주식회사샘플');await select('texture','2');await select('borderMode','double');
 const high=await pixels(4096);assert.equal(high.width,4096);assert.equal(high.height,4096);assert(high.transparent>0&&high.opaque>0);assert.equal(high.diff,0);assert.equal(high.edgeInk,0);
 for(const size of [1024,4096]){await page.locator('#seal-resolution').selectOption(String(size));const downloading=page.waitForEvent('download');await page.locator('#seal-download').click();const download=await downloading;assert.equal(download.suggestedFilename(),'법인도장_주식회사샘플.png');const buf=await fs.readFile(await download.path());assert.equal(buf.readUInt32BE(16),size);assert.equal(buf[25],6);await ready();}
 console.log('PASS actual 1024/4096px RGBA PNG downloads, deterministic ink texture, transparent double border');
 for(const view of ['paper','actual','transparent']){await page.locator(`[data-view="${view}"]`).click();assert.equal(await page.locator('#seal-stage').getAttribute('data-view'),view);}
 await page.locator('#seal-form [name=name]').fill('😀');await page.waitForFunction(()=>document.getElementById('seal-status').dataset.error==='true');assert(await page.locator('#seal-download').isDisabled());assert.equal(await page.locator('#seal-art svg').count(),0);
 await page.locator('#seal-reset').click();await ready();assert.equal(await page.locator('[name=name]').inputValue(),'홍길동');
 console.log('PASS preview backgrounds, physical size mode, missing glyph guard, reset');
 const reference=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await (await SealStudio.png(SealStudio.snapshot(),512)).arrayBuffer()))));
 await page.locator('[data-kind=corporate]').click();await ready();await page.locator('#seal-corporate details summary').click();await page.locator('#seal-reference').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:reference});await page.waitForFunction(()=>!document.getElementById('seal-reference-apply').disabled);assert((await page.locator('#seal-reference-info').textContent()).includes('원형'));await page.locator('#seal-reference-apply').click();await ready();await page.locator('#seal-reference-clear').click();assert(await page.locator('#seal-reference-apply').isDisabled());
 await page.screenshot({path:'/tmp/seal-corporate.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/seal-mobile.png',fullPage:true});
 console.log('PASS local reference analysis and mobile layout without horizontal overflow');
 await page.locator('#modeTabs [data-value=draw]').click();await page.locator('#pad').dispatchEvent('pointerdown',{pointerId:1,clientX:100,clientY:100,pointerType:'mouse',pressure:.5});assert(await page.locator('#panel-draw').isVisible());
 await page.locator('#modeTabs [data-value=make]').click();assert(await page.locator('#panel-make').isVisible());
 for(const file of ['index.html','receipt.html','cutout.html','card.html']){await page.goto(`${base}/${file}`,{waitUntil:'domcontentloaded'});assert(await page.locator('body').isVisible());}
 assert.deepEqual(errors,[]);console.log('PASS existing signature tabs and other page smoke checks; no browser JS errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
