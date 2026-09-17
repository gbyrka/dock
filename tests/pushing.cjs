const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const elements=new Map();
const context2d=new Proxy({}, {get:(_,key)=>key.startsWith('create')?()=>({addColorStop(){}}):()=>{},set:()=>true});
const el=()=>({textContent:'',value:'solo',hidden:false,classList:{add(){},remove(){},toggle(){}},getContext:()=>context2d,width:1280,height:720,addEventListener(){},replaceChildren(){},append(){},blur(){}});
const document={cookie:'',querySelector(s){if(s.includes(':checked'))s='selected';if(!elements.has(s))elements.set(s,el());return elements.get(s)},querySelectorAll(){return []},createElement:el};
const sandbox={document,location:{search:'',protocol:'http:',href:'http://localhost/'},performance:{now:()=>0},URL,URLSearchParams,Math,Date,console,Uint16Array,Uint8Array,DataView,btoa,atob,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(){},assert};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../game.js'),'utf8'),sandbox);
vm.runInContext(`
function setupPush(offset=0, heading=-Math.PI/2, gap=0) {
  mode='tug'; tow=null; keys.clear(); score=100; collisionCooldown=0;
  harbor={land:[],otherShips:[],berth:{x:0,y:0,w:200,h:70},targetAngle:0};
  Object.assign(ship,{x:500,y:350,a:0,vx:0,vy:0,omega:0,throttle:0,rudder:0});
  Object.assign(tug,{x:500+19+(heading===0?14:28)+gap,y:350+offset,a:heading,vx:0,vy:0,omega:0,throttle:0,rudder:0,jet:0});
}
function simulatePush(seconds) {
  for(let i=0;i<seconds*120;i++) {
    applyTow(1/120); moveShip(1/120); moveTug(1/120);
    assert(!polygonsOverlap(orientedCorners(ship),orientedCorners(tug)),'hulls must not overlap');
    assert(!collisionInfo(ship),'main hull must not penetrate obstacles');
    assert(!collisionInfo(tug),'tug must not penetrate obstacles');
    assert([ship.x,ship.y,ship.a,ship.vx,ship.vy,ship.omega,tug.x,tug.y].every(Number.isFinite));
  }
}
setupPush(); keys.add('w'); simulatePush(5);
assert(ship.x<475,'sustained bow pressure should move the heavy ship appreciably');
assert(Math.abs(ship.a)<.001,'amidships pressure should not spin the ship');
assert.equal(score,100,'assisted hull contact must not cost points');
console.log('PASS: sustained engine push moves main ship without bounce, overlap or penalty');
for(const offset of [-50,50]) {
  setupPush(offset); keys.add('w'); simulatePush(1);
  assert(ship.vx<0,'off-center push translates the ship');
  assert(Math.sign(ship.omega)===Math.sign(offset),'bow and stern pushes turn in opposite directions');
}
console.log('PASS: bow and stern pressure transfer torque in opposite directions');
setupPush(0,0); keys.add('q'); simulatePush(4);
assert(ship.x<480,'side thrusters must also push the heavy ship');
console.log('PASS: sideways thrusters can push');
setupPush(); tug.vx=25; simulatePush(.5);
assert.equal(ship.vx,0,'moving away must not pull an unattached ship');
setupPush(0,-Math.PI/2,20); simulatePush(.5);
assert.equal(ship.vx,0,'no contact means no pushing force');
console.log('PASS: no phantom force from distant or separating hulls');
setupPush(); running=true; toggleTow(); assert(tow); keys.add('w'); simulatePush(3);
assert(ship.x<490,'pushing also works with a slack towline attached');
setupPush(); running=true; toggleTow(); tug.x+=20; applyTow(1/120);
assert(ship.vx>0,'taut towline still pulls toward tug');
assert(tug.vx<0,'towline still reacts on tug');
console.log('PASS: pushing with attached line and existing tow force');
setupPush(); harbor.land=[{x:400,y:0,w:40,h:720}]; keys.add('w'); simulatePush(12);
assert(ship.x>=459,'pushing cannot move main hull through quay');
console.log('PASS: sustained push against quay stays collision-safe');
`,sandbox);
