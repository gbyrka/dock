const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../marine-physics.js');
const body = (tug = false) => ({ x: 0, y: 0, a: 0, vx: 0, vy: 0, omega: 0, throttle: 0, rudder: 0, jet: 0, w: tug ? 28 : 38, h: tug ? 56 : 158 });
function run(v, input, seconds, tug = false) { for (let i=0;i<Math.round(seconds/P.STEP);i++) P.advance(v,input,P.STEP,tug); }
function close(a,b,e=1e-8) { assert.ok(Math.abs(a-b)<e, `${a} != ${b}`); }

for(const tug of [false,true]) {
  test(`${tug?'tug':'ship'} rudder cannot rotate an idle vessel`,()=>{
    const v=body(tug);run(v,{right:true},20,tug);
    close(v.x,0);close(v.y,0);close(v.a,0);close(v.omega,0);
  });
  test(`${tug?'tug':'ship'} has gradual engine response and weaker reverse`,()=>{
    const a=body(tug),r=body(tug);
    run(a,{ahead:true},.1,tug);
    assert.ok(a.throttle>0&&a.throttle<.4);
    run(a,{ahead:true},30,tug);run(r,{astern:true},30,tug);
    assert.ok(P.components(a).forward>60);
    assert.ok(-P.components(r).forward<P.components(a).forward);
    assert.ok(Math.hypot(a.vx,a.vy)<125);
  });
  test(`${tug?'tug':'ship'} turns opposite ways ahead and astern`,()=>{
    const a=body(tug),r=body(tug);
    a.vy=-35;r.vy=35;
    run(a,{right:true},.7,tug);run(r,{right:true},.7,tug);
    assert.ok(a.a>0);assert.ok(r.a<0);
  });
}

test('neutral preserves momentum but dissipates energy; astern stops much sooner',()=>{
  const v=body();run(v,{ahead:true},8);
  const coast={...v},brake={...v};
  run(coast,{},3);run(brake,{astern:true},3);
  assert.ok(P.components(coast).forward>20, 'letting go is coasting, not a brake');
  assert.ok(Math.abs(P.components(brake).forward)<Math.abs(P.components(coast).forward)*.6);
  run(coast,{},90);
  assert.ok(Math.hypot(coast.vx,coast.vy)<.1);
});

test('quadratic lateral resistance damps sideways drift faster than headway',()=>{
  const v=body();v.vx=30;v.vy=-30;run(v,{},1);
  assert.ok(Math.abs(v.vx)<Math.abs(v.vy)*.4);
  assert.ok(v.vx>0, 'drag does not overshoot through zero');
});

test('turn inertia settles after the helm is released',()=>{
  const v=body();run(v,{ahead:true,right:true},5);
  assert.ok(v.omega>.1);
  const before=v.a;run(v,{},.2);
  assert.notEqual(v.a,before, 'yaw has inertia');
  run(v,{},12);
  assert.ok(Math.abs(v.omega)<.001);
});

test('tug thrusters move sideways without an engine or an artificial yaw',()=>{
  const v=body(true);run(v,{starboard:true},2,true);
  assert.ok(v.x>40&&v.vx>20);close(v.y,0);close(v.a,0);
  run(v,{port:true},3,true);assert.ok(v.vx<0);
});

test('stopping-room estimate matches the straight-line reverse-engine manoeuvre',()=>{
  for(const speed of [-45,20,60,78]) {
    const v=body();v.vy=-speed;v.throttle=Math.sign(speed);
    const estimate=P.stoppingDistance(v),before=v.y;
    for(let i=0;i<2400&&P.components(v).forward*speed>0;i++)P.advance(v,{ahead:speed<0,astern:speed>0},P.STEP);
    const actual=Math.abs(v.y-before);
    assert.ok(Math.abs(actual-estimate)<Math.max(1,actual*.035), `${speed}: predicted ${estimate}, actual ${actual}`);
  }
});

test('a side contact removes inward motion while keeping tangential movement',()=>{
  const old={...body(),x:480,y:350,vx:30,vy:18},v={...old,x:482};
  const wall=[{x:500,y:0},{x:550,y:0},{x:550,y:700},{x:500,y:700}];
  const contact=P.manifold(P.corners(v),wall);
  assert.ok(contact);close(contact.normal.x,-1);
  const impact=P.resolveContact(v,old,contact);
  close(impact,30);close(v.x,old.x);close(v.vx,0);
  assert.ok(v.vy>15&&v.vy<=old.vy);close(v.omega,0);
  assert.equal(P.manifold(P.corners(v),wall),null);
});

test('SAT detects crossings, containment and the outward normal on either side',()=>{
  const wall=P.corners({x:0,y:0,w:20,h:100,a:0});
  assert.ok(P.manifold(P.corners({x:0,y:0,w:100,h:20,a:0}),wall));
  assert.ok(P.manifold(P.corners({x:0,y:0,w:5,h:5,a:.2}),wall));
  assert.equal(P.manifold(P.corners({x:80,y:0,w:10,h:10,a:0}),wall),null);
  assert.ok(P.manifold(P.corners({x:13,y:0,w:10,h:10,a:0}),wall).normal.x>0);
  assert.ok(P.manifold(P.corners({x:-13,y:0,w:10,h:10,a:0}),wall).normal.x<0);
});

test('docking accepts either heading but rejects a rolling, spinning or overhanging hull',()=>{
  const berth={x:-110,y:-38,w:220,h:76},v=body();v.a=Math.PI/2;
  assert.ok(P.docking(v,berth,Math.PI/2).ready);
  v.a=-Math.PI/2;assert.ok(P.docking(v,berth,Math.PI/2).ready);
  v.omega=.05;assert.ok(!P.docking(v,berth,Math.PI/2).ready, 'spinning in the bay is unsafe');
  v.omega=0;v.vx=9;assert.ok(!P.docking(v,berth,Math.PI/2).ready);
  v.vx=0;v.y=22;assert.ok(!P.docking(v,berth,Math.PI/2).inside);
  v.y=0;v.a=0;assert.ok(!P.docking(v,berth,Math.PI/2).ready);
});

test('long mixed-input sessions remain finite and below safety speed limits',()=>{
  for(const tug of [false,true]) {
    const v=body(tug);let seed=34,input={};
    const r=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
    for(let i=0;i<18000;i++) {
      if(i%120===0)input={ahead:r()<.5,astern:r()<.3,left:r()<.4,right:r()<.4,port:r()<.4,starboard:r()<.4};
      P.advance(v,input,P.STEP,tug);
      assert.ok([v.x,v.y,v.vx,v.vy,v.a,v.omega].every(Number.isFinite));
      assert.ok(Math.hypot(v.vx,v.vy)<=(tug?125:100)+1e-6);
    }
  }
});

test('an actual ahead/astern approach can slow and secure a berth without snapping the hull',()=>{
  const v={...body(),x:400,y:200,a:Math.PI/2};
  const berth={x:740,y:162,w:220,h:76};
  let stage='ahead',hold=0;
  for(let i=0;i<3600;i++) {
    if(stage==='ahead'&&850-v.x<P.stoppingDistance(v)+10)stage='brake';
    // Ease off astern before zero to allow the engine to spool back to neutral.
    if(stage==='brake'&&P.components(v).forward<6)stage='neutral';
    P.advance(v,{ahead:stage==='ahead',astern:stage==='brake'},P.STEP);
    hold=P.docking(v,berth,Math.PI/2).ready?hold+P.STEP:0;
    if(hold>=1.35)break;
  }
  assert.equal(stage,'neutral');
  assert.ok(hold>=1.35,'a fully controlled approach must be able to complete docking');
});
