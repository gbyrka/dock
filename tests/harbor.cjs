const vm=require('node:vm');
const sandbox=require('./harness.cjs')();
vm.runInContext(`
let testSeed=77343;
Math.random=()=>{testSeed=(testSeed*1664525+1013904223)>>>0;return testSeed/4294967296;};
const sidesSeen=new Set();
for(let n=0;n<600;n++) {
  mode=n%2?'tug':'solo';harbor=makeHarbor();resetShipForHarbor();sidesSeen.add(harbor.side);
  assert(!collisionInfo(ship),'ship spawn must be clear');
  assert(!collisionInfo(tug),'tug spawn must be clear');
  assert(!polygonsOverlap(orientedCorners(ship),orientedCorners(tug)),'spawns cannot overlap');
  const berth=harbor.berth,approach=approachProtection(berth);
  for(const land of harbor.land) {
    assert(!polygonsOverlap(rectPoly(berth),rectPoly(land)),'berth must be in water');
    if(land.type==='pier')assert(!rectsOverlap(land,approach,30),'approach cannot be blocked by a pier');
  }
  for(let i=0;i<harbor.piers.length;i++)for(let j=i+1;j<harbor.piers.length;j++)assert(!rectsOverlap(harbor.piers[i],harbor.piers[j],35));
  assert(harbor.otherShips.length>=4&&harbor.otherShips.length<=7,'traffic count remains 4–7');
  for(const other of harbor.otherShips) {
    assert(!rectsOverlap(bodyBounds(other),approach,18),'traffic stays outside approach');
    assert(!harbor.land.some(r=>polygonsOverlap(orientedCorners(other),rectPoly(r))));
  }
  for(let i=0;i<harbor.otherShips.length;i++)for(let j=i+1;j<harbor.otherShips.length;j++)assert(!polygonsOverlap(orientedCorners(harbor.otherShips[i]),orientedCorners(harbor.otherShips[j])));
  for(const heading of [harbor.targetAngle,harbor.targetAngle+Math.PI]) {
    Object.assign(ship,{x:berth.x+berth.w/2,y:berth.y+berth.h/2,a:heading,vx:0,vy:0,omega:0});
    assert(dockingMetrics().ready,'ship must fit either way');assert(!collisionInfo(ship));
  }
}
assert.equal(sidesSeen.size,4);
console.log('PASS: 600 procedural harbors, both vessel spawns, clear approaches, separated traffic, all four quay sides and either docking heading');

// Fixed input fuzzing catches corner penetration and trapped tug contacts.
for(let n=0;n<20;n++) {
  mode=n%2?'tug':'solo';harbor=makeHarbor();resetShipForHarbor();tow=null;score=1000;transition=0;
  for(let i=0;i<4800;i++) {
    if(i%120===0) {
      keys.clear();for(const k of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','s','a','d','q','e'])if(Math.random()<.3)keys.add(k);
      if(mode==='tug'&&canAttach()&&Math.random()<.25){running=true;toggleTow();}
    }
    collisionCooldown=Math.max(0,collisionCooldown-DockPhysics.STEP);
    if(mode==='tug')applyTow(DockPhysics.STEP);
    moveShip(DockPhysics.STEP);if(mode==='tug')moveTug(DockPhysics.STEP);
    assert(!collisionInfo(ship),'ship must remain clear during mixed controls');
    if(mode==='tug'){
      assert(!collisionInfo(tug),'tug must remain clear during mixed controls');
      assert(!polygonsOverlap(orientedCorners(ship),orientedCorners(tug)),'dynamic hulls must not overlap');
    }
  }
}
console.log('PASS: 800 simulated seconds of mixed engine, rudder, thruster and towline controls without hull penetration');

// Public challenge tokens remain compatible with the existing format.
for(const value of [0,1,280,999,10000000])assert.equal(decodeChallenge(encodeChallenge(value)),value);
assert.equal(decodeChallenge('not a token'),null);
mode='tug';completedMode='solo';assert(!buildChallengeUrl(420).includes('mode=tug'),'share the completed mode');
completedMode='tug';assert(buildChallengeUrl(420).includes('mode=tug'));
console.log('PASS: challenge encoding, invalid links and completed-mode sharing');
`,sandbox);
