const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const url=process.env.DOCK_URL||'http://127.0.0.1:8766';
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 await context.route('https://www.googletagmanager.com/**',route=>route.abort());
 const legacy={version:1,best:999,history:[{score:999,docks:4,at:1750000000000}]};
 await context.addCookies([{name:'dock_scores_v1',value:encodeURIComponent(JSON.stringify(legacy)),url}]);
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const read=()=>page.evaluate(()=>({running,paused,mode,ship:{...ship},tug:{...tug},tow:tow&&{...tow},remaining,score,dockings,harborIndex,berthHold}));
 const shot=name=>process.env.DOCK_SCREENSHOT_DIR?page.screenshot({path:path.join(process.env.DOCK_SCREENSHOT_DIR,name+'.png'),fullPage:true}):Promise.resolve();
 const start=async()=>{await page.click('#start');await page.waitForFunction(()=>running&&!paused);};
 const placeInBerth=()=>page.evaluate(()=>{
   const b=harbor.berth;
   Object.assign(ship,{x:b.x+b.w/2,y:b.y+b.h/2,a:harbor.targetAngle,vx:0,vy:0,omega:0,throttle:0,rudder:0});
   keys.clear();berthHold=0;
 });
 try{
  if(process.env.DOCK_SCREENSHOT_DIR)fs.mkdirSync(process.env.DOCK_SCREENSHOT_DIR,{recursive:true});
  await page.goto(url);await page.waitForFunction(()=>typeof harbor!=='undefined'&&!!harbor);
  assert.equal(await page.textContent('#best'),'999');
  assert.equal(await page.locator('script[src*="gtag/js?id=G-WTPHWDLQ7K"]').count(),1);
  assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'),'assets/favicon.svg');
  await shot('menu-desktop');await start();await shot('play-desktop');
  const initial=await read();
  await page.keyboard.down('ArrowUp');await page.waitForFunction(()=>forwardSpeed()>20);
  const ahead=await read();
  assert.ok(Math.hypot(ahead.ship.x-initial.ship.x,ahead.ship.y-initial.ship.y)>5);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(()=>ship.omega>.06);
  await page.keyboard.up('ArrowUp');await page.keyboard.up('ArrowRight');
  const coast=await read();await page.waitForTimeout(160);
  assert.ok(await page.evaluate(()=>worldSpeed()>10),'neutral does not stop a heavy ship');
  await page.keyboard.down('ArrowDown');await page.waitForFunction(()=>forwardSpeed()<=0);await page.keyboard.up('ArrowDown');
  assert.ok((await read()).remaining<coast.remaining);
  assert.equal(await page.evaluate(()=>scrollY),0);
  console.log('PASS: actual arrow controls, engine lag, rudder, coasting, reverse thrust and no page scrolling');

  await page.keyboard.press('Escape');const paused=await read();
  assert.ok(paused.paused&&!paused.running);
  await page.waitForTimeout(230);assert.deepEqual(await read(),paused,'pause freezes vessels and watch');
  await page.check('input[value="tug"]');assert.equal((await read()).mode,'solo','pause-menu selection must not mutate the active mode');
  await page.click('#resume');assert.equal((await read()).mode,'solo');
  await page.keyboard.press('r');assert.ok((await read()).remaining>179.5);assert.equal((await read()).score,0);
  await page.keyboard.down('ArrowUp');await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.keyboard.up('ArrowUp');
  assert.ok((await read()).paused);
  await page.keyboard.press('Escape');assert.ok((await read()).running);
  await page.evaluate(()=>{last=performance.now()-800;});await page.waitForFunction(()=>paused);
  console.log('PASS: pause/resume, mode preservation, restart, focus loss and long-frame protection');

  await start();await placeInBerth();
  await page.evaluate(()=>{ship.omega=.1;});await page.waitForTimeout(200);
  assert.equal((await read()).berthHold,0,'spinning in a berth is not a docking');
  await placeInBerth();await page.evaluate(()=>{ship.vx=12;});await page.waitForTimeout(200);
  assert.equal((await read()).berthHold,0,'moving too fast does not score');
  await placeInBerth();await page.waitForFunction(()=>berthHold>.25);
  await shot('docking-progress');
  await page.evaluate(()=>{const b=harbor.berth;if(b.w>b.h)ship.x=b.x;else ship.y=b.y;});
  await page.waitForFunction(()=>berthHold===0);assert.equal((await read()).score,0,'leaving berth resets hold');
  await placeInBerth();await page.waitForFunction(()=>dockings===1);
  const docked=await read();assert.equal(docked.score,280,'perfect docking retains original maximum points');
  assert.equal(docked.harborIndex,1,'success is visible before chart transition');
  await page.waitForFunction(()=>harborIndex===2);
  assert.equal((await read()).dockings,1,'one docking is counted once');
  assert.equal((await read()).score,280);
  assert.equal(await page.textContent('#chart-number'),'02');
  await page.evaluate(()=>{remaining=.015;});await page.waitForFunction(()=>!running&&completedMode==='solo');
  assert.equal(await page.textContent('#time'),'0:00');
  assert.equal(await page.locator('#share-score').isVisible(),true);
  const saved=await page.evaluate(()=>JSON.parse(decodeURIComponent(document.cookie.split('; ').find(s=>s.startsWith('dock_scores_v1=')).split('=')[1])));
  assert.equal(saved.best,999);assert.equal(saved.history.length,2);assert.equal(saved.history[1].score,280);assert.equal(saved.history[1].mode,'solo');
  await shot('watch-complete');
  console.log('PASS: stable-hull docking, interrupted hold, scoring, chart transition, expiry, old records and share-button availability');

  await page.check('input[value="tug"]');await start();
  assert.equal((await read()).mode,'tug');assert.ok(await page.locator('.tug-controls').isVisible());
  await page.keyboard.down('w');await page.waitForFunction(()=>Math.hypot(tug.vx,tug.vy)>15);await page.keyboard.up('w');
  await page.keyboard.down('d');await page.waitForFunction(()=>tug.omega>.03);await page.keyboard.up('d');
  await page.keyboard.down('q');await page.waitForFunction(()=>tug.jet<-.4);await page.keyboard.up('q');
  await page.keyboard.down('e');await page.waitForFunction(()=>tug.jet>.4);await page.keyboard.up('e');
  await page.keyboard.press('r');assert.ok(await page.evaluate(()=>canAttach()));
  await page.keyboard.press('Space');assert.ok((await read()).tow);
  assert.equal(await page.evaluate(()=>scrollY),0);
  await shot('tug-towline');
  await page.keyboard.press('Escape');const towPaused=await read();
  await page.waitForTimeout(200);assert.deepEqual(await read(),towPaused,'pause must also freeze a towline');
  await page.click('#resume');await page.keyboard.press('Space');assert.equal((await read()).tow,null);
  console.log('PASS: tug WASD, Q/E, Space attach/release, clear spawn, and pause with a towline');

  await page.keyboard.press('Escape');
  await page.locator('#start').focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.value),'tug','Tab wraps into selected mode');
  for(const [width,height] of [[1280,720],[1024,768],[800,600],[390,844],[360,640]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(90);
   const layout=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,board:document.querySelector('#board-wrap').getBoundingClientRect().toJSON(),canvas:canvas.getBoundingClientRect().toJSON(),footer:document.querySelector('footer').getBoundingClientRect().toJSON()}));
   assert.ok(layout.width<=layout.viewport,`no horizontal overflow at ${width}x${height}`);
   assert.ok(layout.board.height>=230&&layout.canvas.width>=300,'board retains usable area');
   assert.ok(Math.abs(layout.canvas.height-layout.board.height)<1,'canvas stays inside its frame');
   if(width>=1000&&height>=720)assert.ok(layout.footer.bottom<=height,'desktop controls fit in viewport');
   await shot(`menu-${width}x${height}`);
   await page.click('#resume');await shot(`play-${width}x${height}`);await page.keyboard.press('Escape');
  }
  console.log('PASS: keyboard focus loop, desktop, compact-window and phone layouts');

  await page.setViewportSize({width:1280,height:800});
  const token=await page.evaluate(()=>encodeChallenge(120));
  await page.goto(url+'/?c='+token+'&mode=tug');
  assert.equal(await page.locator('input[value="tug"]').isChecked(),true);
  assert.equal(await page.textContent('#challenge-score'),'120');
  await start();await placeInBerth();await page.waitForFunction(()=>score>120);
  assert.ok(await page.locator('#challenge-pill').evaluate(el=>el.classList.contains('beaten')));
  await page.evaluate(()=>{remaining=.01;});await page.waitForFunction(()=>!running&&completedMode==='tug');
  const shared=await page.evaluate(()=>{const u=new URL(buildChallengeUrl(score));return{score:decodeChallenge(u.searchParams.get('c')),mode:u.searchParams.get('mode')};});
  assert.deepEqual(shared,{score:280,mode:'tug'});
  // Check creation of a challenge URL; never open a social popup or post anything.
  await page.emulateMedia({reducedMotion:'reduce'});await start();await page.waitForTimeout(150);
  await page.evaluate(()=>{Object.defineProperty(document,'cookie',{configurable:true,get:()=>'',set:()=>{}});finish();});
  assert.match(await page.textContent('#storage-status'),/session only/);
  await start();assert.ok((await read()).running,'storage failure must not block gameplay');
  assert.deepEqual(errors,[],'no JavaScript errors');
  console.log('PASS: challenge links, beating a target, completed-mode sharing, reduced motion, blocked cookies and no JavaScript errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
