/* Local Canvas artwork. Static port detail is cached separately from the water
   and moving vessels so high-DPI displays do not require redrawing the whole quay. */
window.DockScene = class DockScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.water = document.createElement('canvas');
    this.port = document.createElement('canvas');
    this.overhead = document.createElement('canvas');
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.width = 1280; this.height = 720;
  }

  configure(harbor) { this.harbor = harbor; this.resize(); }

  resize() {
    if (!this.harbor) return;
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(2.5, Math.max(1, Math.min(rect.width / this.width, rect.height / this.height) * (devicePixelRatio || 1)));
    for (const canvas of [this.canvas, this.water, this.port, this.overhead]) {
      canvas.width = Math.round(this.width * scale); canvas.height = Math.round(this.height * scale);
    }
    const water = this.context(this.water), port = this.context(this.port), overhead = this.context(this.overhead);
    this.buildWater(water); this.buildPort(port); this.drawCranes(overhead);
  }

  context(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(canvas.width / this.width, 0, 0, canvas.height / this.height, 0, 0);
    return ctx;
  }

  box(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  text(ctx, text, x, y, size, color, weight = 600, align = 'center') {
    ctx.font = `${weight} ${size}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  line(ctx, x1, y1, x2, y2, color, width = 1) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }
  circle(ctx, x, y, r, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

  buildWater(ctx) {
    const w = this.width, h = this.height;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#1b4651'); g.addColorStop(.45, '#163b48'); g.addColorStop(1, '#102c39');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    let seed = 9073;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 20000; i++) {
      ctx.fillStyle = i % 3 ? '#8bc1c307' : '#02182210';
      ctx.fillRect(random() * w, random() * h, 1 + random() * 5, .6);
    }
    // Bathymetric haze around structures gives shallow water a softer colour.
    for (const r of this.harbor.land.filter(r => r.type !== 'wall')) {
      ctx.save(); ctx.shadowColor = '#86aea223'; ctx.shadowBlur = 30;
      ctx.strokeStyle = '#5c908422'; ctx.lineWidth = 25; ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.restore();
    }
    ctx.strokeStyle = '#8ab5c00b'; ctx.lineWidth = .7;
    for (let x = 80; x < w; x += 80) { ctx.beginPath(); ctx.moveTo(x,18); ctx.lineTo(x,h-18); ctx.stroke(); }
    for (let y = 80; y < h; y += 80) { ctx.beginPath(); ctx.moveTo(18,y); ctx.lineTo(w-18,y); ctx.stroke(); }
    for (let x = 80; x < w; x += 160) for (let y = 80; y < h; y += 160) {
      this.line(ctx, x-3,y,x+3,y,'#a3c8ce20'); this.line(ctx,x,y-3,x,y+3,'#a3c8ce20');
    }
    const vignette = ctx.createRadialGradient(w*.5,h*.48,100,w*.5,h*.5,w*.62);
    vignette.addColorStop(0,'#061b2300'); vignette.addColorStop(1,'#04121e55');
    ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
  }

  buildPort(ctx) {
    for (const r of this.harbor.land) {
      ctx.save(); ctx.shadowColor = '#020d1699'; ctx.shadowBlur = 17; ctx.shadowOffsetX = 7; ctx.shadowOffsetY = 9;
      this.box(ctx,r.x,r.y,r.w,r.h,r.type === 'wall' ? 0 : 3,'#26373e'); ctx.restore();
      const concrete = ctx.createLinearGradient(r.x,r.y,r.x+r.w,r.y+r.h);
      concrete.addColorStop(0,r.type==='wall'?'#31454b':'#455155'); concrete.addColorStop(1,r.type==='wall'?'#21333c':'#303f45');
      this.box(ctx,r.x,r.y,r.w,r.h,r.type==='wall'?0:3,concrete,'#77908b55');
      ctx.save();ctx.beginPath();ctx.rect(r.x+2,r.y+2,r.w-4,r.h-4);ctx.clip();
      ctx.strokeStyle='#172c3644';ctx.lineWidth=1;
      for(let x=r.x+30;x<r.x+r.w;x+=46) {ctx.beginPath();ctx.moveTo(x,r.y);ctx.lineTo(x,r.y+r.h);ctx.stroke();}
      for(let y=r.y+30;y<r.y+r.h;y+=46) {ctx.beginPath();ctx.moveTo(r.x,y);ctx.lineTo(r.x+r.w,y);ctx.stroke();}
      if(r.type!=='wall') {
        ctx.strokeStyle='#e2bd6f90';ctx.lineWidth=5;ctx.setLineDash([10,9]);ctx.strokeRect(r.x+3,r.y+3,r.w-6,r.h-6);ctx.setLineDash([]);
        ctx.strokeStyle='#d3d8c329';ctx.lineWidth=1;ctx.strokeRect(r.x+13,r.y+13,r.w-26,r.h-26);
      }
      ctx.restore();
      if(r.type!=='wall') this.quayFittings(ctx,r);
    }
    this.harbor.containers.forEach((c,index)=>this.container(ctx,c,index));
    for (const vessel of this.harbor.otherShips || []) {
      const sideSign = vessel.dockSide === 'left' || vessel.dockSide === 'top' ? -1 : 1;
      const side = { x: Math.cos(vessel.a), y: Math.sin(vessel.a) }, forward = { x: Math.sin(vessel.a), y: -Math.cos(vessel.a) };
      for (const end of [-1,1]) this.line(ctx,vessel.x+side.x*sideSign*vessel.w*.46+forward.x*end*vessel.h*.29,vessel.y+side.y*sideSign*vessel.w*.46+forward.y*end*vessel.h*.29,vessel.moor.x,vessel.moor.y,'#c9bf9366',1);
      this.vessel(ctx,vessel,{ cargo:vessel.kind==='cargo', color:vessel.tone, moored:true });
    }
    // Quiet chart coordinates live on the perimeter rather than over the action.
    for(let x=95;x<this.width;x+=180) this.text(ctx,`${String.fromCharCode(65+Math.floor(x/180))} / ${String(x*7).padStart(4,'0')}`,x,12,6,'#9eb3b788',500);
    for(let y=100;y<this.height;y+=140) {ctx.save();ctx.translate(10,y);ctx.rotate(-Math.PI/2);this.text(ctx,`${String((this.height-y)*9).padStart(4,'0')} N`,0,0,6,'#9eb3b788',500);ctx.restore();}
    const b=this.harbor.berth, q=this.harbor.land.find(r=>r.type==='quay');
    if(q) {
      ctx.save(); const horizontal=b.w>b.h;
      ctx.translate(horizontal ? b.x+b.w/2 : q.x+q.w/2, horizontal ? q.y+q.h/2 : b.y+b.h/2);
      if(!horizontal)ctx.rotate(-Math.PI/2);
      this.box(ctx,-51,-11,102,23,2,'#1c323ce8');this.text(ctx,`BERTH  ${this.harbor.berthName}`,0,4,9,'#dee2cb',650);ctx.restore();
    }
  }

  quayFittings(ctx,r) {
    const horizontal=r.w>r.h, span=horizontal?r.w:r.h;
    for(let offset=22;offset<span-10;offset+=51) {
      for(const side of [-1,1]) {
        const x=horizontal?r.x+offset:r.x+(side<0?2:r.w-2);
        const y=horizontal?r.y+(side<0?2:r.h-2):r.y+offset;
        ctx.save();ctx.translate(x,y);if(!horizontal)ctx.rotate(Math.PI/2);
        this.box(ctx,-6,-3,12,6,2,'#14252c','#4e656c');ctx.restore();
      }
    }
    for(let offset=30;offset<span-20;offset+=91) {
      const x=horizontal?r.x+offset:r.x+r.w/2,y=horizontal?r.y+r.h/2:r.y+offset;
      this.circle(ctx,x,y,4,'#1e2d30');this.circle(ctx,x-1,y-1,2,'#bcaa7d');
    }
  }

  container(ctx,c,index) {
    ctx.save();ctx.shadowColor='#06121a66';ctx.shadowBlur=2;ctx.shadowOffsetX=3;ctx.shadowOffsetY=4;
    this.box(ctx,c.x,c.y,c.w,c.h,1.2,c.c);ctx.restore();
    ctx.strokeStyle='#ffffff24';ctx.lineWidth=.7;ctx.strokeRect(c.x+.5,c.y+.5,c.w-1,c.h-1);
    const vertical=c.h>c.w;
    for(let i=4;i<(vertical?c.h:c.w)-2;i+=4) {
      if(vertical)this.line(ctx,c.x+1,c.y+i,c.x+c.w-1,c.y+i,'#13283344',.8);
      else this.line(ctx,c.x+i,c.y+1,c.x+i,c.y+c.h-1,'#13283344',.8);
    }
    ctx.fillStyle='#ffffff30';ctx.fillRect(c.x+3,c.y+2,Math.min(9,c.w-5),1);
    if(index%4===0)this.text(ctx,['NORD','ATLAS','SEA','MARS'][index%4],c.x+c.w/2,c.y+c.h/2+2,3.5,'#f3e9cc90',650);
  }

  drawCranes(ctx) {
    for(const crane of this.harbor.cranes) {
      ctx.save();ctx.translate(crane.x,crane.y);ctx.rotate(crane.a);
      // Two rails, four feet, and a trussed boom extending over the basin.
      this.box(ctx,-19,-18,38,24,2,'#1d3039','#7c858055');
      for(const x of [-15,15])this.line(ctx,x,-20,x,5,'#c7af7477',2);
      ctx.save();ctx.translate(7,8);ctx.strokeStyle='#03111a55';ctx.lineWidth=8;ctx.strokeRect(-11,-9,22,76);ctx.restore();
      for(const x of [-10,10])this.line(ctx,x,-13,x,77,'#c1a26a',3);
      for(let y=-12;y<76;y+=17) {this.line(ctx,-10,y,10,y,'#d4b478',2);this.line(ctx,-10,y,10,y+17,'#7b7053',1.5);}
      this.box(ctx,-14,-12,28,18,2,'#c0a16a','#efd39566');this.box(ctx,-8,-8,16,10,1,'#3a575f');
      this.line(ctx,-5,72,-5,95,'#91adb288',1);this.line(ctx,5,72,5,95,'#91adb288',1);
      this.box(ctx,-8,94,16,4,1,'#cfba87');
      this.circle(ctx,0,-2,2,'#ffdeb1');ctx.restore();
    }
  }

  waterMotion(ctx,now) {
    const time=this.reducedMotion.matches?0:now;
    ctx.save();ctx.lineWidth=.7;
    for(let row=0;row<23;row++) {
      const y=29+row*31;
      for(let col=0;col<12;col++) {
        const x=col*115+Math.sin(row*19+col*8)*24+Math.sin(time*.00016+row)*12;
        const phase=time*.0006+col*1.5+row;
        ctx.strokeStyle=`rgba(151, 204, 206, ${.035+(Math.sin(phase)+1)*.012})`;
        ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x+11,y-2,x+23,y+2,x+38,y-1);ctx.stroke();
      }
    }
    // Lights shimmer only beside the working quay.
    for(const crane of this.harbor.cranes) {
      ctx.save();ctx.translate(crane.x,crane.y);ctx.rotate(crane.a);
      for(let j=1;j<12;j++) {
        const alpha=(1-j/12)*(.08+.025*Math.sin(time*.0015+j));
        this.line(ctx,-5-j*.7,16+j*9,5+j*.7,16+j*9,`rgba(239, 211, 155, ${alpha})`,1+j*.13);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  berth(ctx,game,now) {
    const b=this.harbor.berth, progress=Math.min(1,game.berthHold/1.35);
    const pulse=this.reducedMotion.matches?.5:.5+.5*Math.sin(now*.0028);
    ctx.save();ctx.lineWidth=1.5;ctx.shadowColor='#96e3b8';ctx.shadowBlur=6+pulse*3;
    this.box(ctx,b.x,b.y,b.w,b.h,5,`rgba(137, 227, 183, ${.065+progress*.14})`,'#9fe7bfaa');ctx.shadowBlur=0;
    ctx.lineWidth=3;
    for(const [x,y,sx,sy] of [[b.x,b.y,1,1],[b.x+b.w,b.y,-1,1],[b.x,b.y+b.h,1,-1],[b.x+b.w,b.y+b.h,-1,-1]]) {
      ctx.strokeStyle='#b3f0c6';ctx.beginPath();ctx.moveTo(x,y+sy*13);ctx.lineTo(x,y);ctx.lineTo(x+sx*13,y);ctx.stroke();
    }
    ctx.save();ctx.translate(b.x+b.w/2,b.y+b.h/2);ctx.rotate(this.harbor.targetAngle);
    ctx.setLineDash([5,6]);ctx.strokeStyle='#b4eac43d';ctx.lineWidth=1;
    this.hullPath(ctx,38,158);ctx.stroke();ctx.setLineDash([]);
    this.line(ctx,0,-65,0,65,'#b8e3c73a');ctx.restore();
    // Target label sits on the water side; the whole berth stays visible.
    const side=b.side;
    const x=side==='west'?b.x+b.w+39:side==='east'?b.x-39:b.x+b.w/2;
    const y=side==='north'?b.y+b.h+20:side==='south'?b.y-20:b.y+b.h/2;
    this.box(ctx,x-31,y-9,62,18,3,'#9fe5b9');this.text(ctx,this.harbor.berthName,x,y+3,8,'#173b35',750);
    if(progress>0) {
      ctx.fillStyle='#b7f5cf';ctx.fillRect(b.x+5,b.y+b.h-5,(b.w-10)*progress,2);
    }
    ctx.restore();
  }

  hullPath(ctx,beam,length) {
    ctx.beginPath();ctx.moveTo(0,-length/2);ctx.bezierCurveTo(beam*.23,-length/2+4,beam*.47,-length*.34,beam/2,-length*.25);
    ctx.lineTo(beam/2,length/2-8);ctx.quadraticCurveTo(beam/2,length/2,beam/2-6,length/2);
    ctx.lineTo(-beam/2+6,length/2);ctx.quadraticCurveTo(-beam/2,length/2,-beam/2,length/2-8);
    ctx.lineTo(-beam/2,-length*.25);ctx.bezierCurveTo(-beam*.47,-length*.34,-beam*.23,-length/2+4,0,-length/2);ctx.closePath();
  }

  vessel(ctx,vessel,options={}) {
    const beam=vessel.w,len=vessel.h,main=!!options.main,cargo=options.cargo||main;
    ctx.save();ctx.translate(vessel.x,vessel.y);ctx.rotate(vessel.a);
    ctx.save();ctx.translate(5,6);ctx.shadowColor='#02141a90';ctx.shadowBlur=9;this.hullPath(ctx,beam,len);ctx.fillStyle='#071d2566';ctx.fill();ctx.restore();
    const hull=ctx.createLinearGradient(-beam/2,0,beam/2,0);
    hull.addColorStop(0,main?'#9c7770':'#506b75');hull.addColorStop(.12,main?'#ebe5ce':'#93a8a8');hull.addColorStop(.75,main?'#e1ddc7':'#829c9f');hull.addColorStop(1,'#728b8b');
    this.hullPath(ctx,beam,len);ctx.fillStyle=hull;ctx.fill();ctx.strokeStyle=main?'#efe6c780':'#c1d3cf55';ctx.lineWidth=.8;ctx.stroke();
    ctx.save();this.hullPath(ctx,beam-6,len-8);ctx.clip();
    ctx.fillStyle=main?'#2b5359':options.color||'#526b6f';ctx.fillRect(-beam/2+3,-len/2+6,beam-6,len-12);
    for(let y=-len/2+22;y<len/2;y+=12)this.line(ctx,-beam/2+4,y,beam/2-4,y,'#122f3544',.7);
    if(cargo) {
      const colors=['#ac7257','#bd9a57','#567e8b','#628977','#a76655','#617b82'];
      let n=0;
      const cell=(beam-12)/2;
      for(let y=-len/2+29;y<len/2-38;y+=17)for(let col=0;col<2;col++) {
        const x=-beam/2+5+col*(cell+1);
        this.container(ctx,{x,y,w:cell-1,h:15,c:colors[(n+++(main?2:0))%colors.length]},n);
      }
    } else if(vessel.kind==='ferry') {
      this.box(ctx,-beam/2+4,-len/2+20,beam-8,len*.51,3,'#c6d2cb');
      for(let y=-len/2+27;y<len*.16;y+=9)this.line(ctx,-beam/2+6,y,beam/2-6,y,'#4d7883',2);
    } else {
      this.box(ctx,-beam/2+4,-len/2+19,beam-8,len*.35,3,vessel.kind==='pilot'?'#c8a466':'#576e77');
    }
    ctx.restore();
    // Foredeck winch, anchors and perimeter rails.
    this.circle(ctx,0,-len/2+16,3,main?'#c5c8b3':'#9caea7');this.line(ctx,-6,-len/2+13,6,-len/2+13,'#dde4cd',1);
    this.line(ctx,-beam/2+2,-len*.22,-beam/2+2,len/2-10,'#e2e6ce80',.7);this.line(ctx,beam/2-2,-len*.22,beam/2-2,len/2-10,'#e2e6ce80',.7);
    const bridgeY=len/2-34;
    this.box(ctx,-beam/2+2,bridgeY,beam-4,15,2,main?'#f2eee0':'#c5d1cb','#536f7655');
    this.box(ctx,-beam/2+5,bridgeY+3,beam-10,4,1,'#345c68');
    for(let x=-beam/2+8;x<beam/2-5;x+=6)this.line(ctx,x,bridgeY+3,x,bridgeY+7,'#b5ccbe',.6);
    this.box(ctx,-5,bridgeY+7,10,8,1,'#d9d7c4');this.circle(ctx,0,bridgeY+10,2,'#8a9b95');
    this.box(ctx,-5,len/2-15,10,8,2,main?'#c28a56':'#849992');this.box(ctx,-3,len/2-13,6,3,1,'#283f46');
    if(main) {ctx.save();ctx.translate(beam/2-3,4);ctx.rotate(Math.PI/2);this.text(ctx,'A T L A S',0,0,3.6,'#eee6c8',650);ctx.restore();}
    // Port is red, starboard is green when looking towards the bow.
    ctx.save();ctx.shadowBlur=main?8:4;
    ctx.shadowColor='#ff8674';this.circle(ctx,-beam/2+1,bridgeY+1,main?1.8:1.3,'#ff967f');
    ctx.shadowColor='#a4e9bb';this.circle(ctx,beam/2-1,bridgeY+1,main?1.8:1.3,'#98e8b1');
    ctx.shadowColor='#fff2cb';this.circle(ctx,0,-len/2+8,1.3,'#fff0c4');ctx.restore();
    if(main) {
      ctx.save();ctx.translate(0,len/2+1);ctx.rotate(-vessel.rudder*.5);this.line(ctx,0,-3,0,7,'#b8d7d5',2);ctx.restore();
    }
    ctx.restore();
  }

  tug(ctx,game) {
    if(game.mode!=='tug')return;
    const tug=game.tug;
    if(game.towAnchor) {
      ctx.save();ctx.strokeStyle=game.tow?(game.tow.tension>70?'#f3c77d':'#d7c597'):'#aed6c560';ctx.lineWidth=game.tow?2:1;
      if(!game.tow)ctx.setLineDash([4,6]);
      const anchor=game.towAnchor, slack=game.tow?Math.max(0,Math.min(25,game.tow.length-Math.hypot(tug.x-anchor.x,tug.y-anchor.y))):0;
      ctx.beginPath();ctx.moveTo(anchor.x,anchor.y);ctx.quadraticCurveTo((anchor.x+tug.x)/2,(anchor.y+tug.y)/2+slack,tug.x,tug.y);ctx.stroke();ctx.restore();
    }
    ctx.save();ctx.translate(tug.x,tug.y);ctx.rotate(tug.a);
    ctx.save();ctx.shadowColor='#04121cab';ctx.shadowBlur=8;ctx.shadowOffsetX=4;ctx.shadowOffsetY=5;
    this.box(ctx,-14,-28,28,56,10,'#162c34','#6a8786');ctx.restore();
    this.box(ctx,-11,-25,22,50,8,'#cca45f','#ebd294');this.box(ctx,-8,7,16,15,3,'#785e3f');
    this.box(ctx,-9,-17,18,24,4,'#e7e4d2');this.box(ctx,-7,-14,14,7,2,'#3c6775');
    this.box(ctx,-3,-4,6,8,1,'#9aab9f');this.circle(ctx,0,-1,2,'#d3d9c7');
    for(const side of [-1,1])for(const y of [-17,0,17])this.box(ctx,side<0?-15:10,y-4,5,8,2,'#14242b','#6e818055');
    this.circle(ctx,-10,-13,1.8,'#ff9785');this.circle(ctx,10,-13,1.8,'#a8e7ba');this.circle(ctx,0,-24,1.6,'#ffecc1');
    ctx.restore();
    this.text(ctx,'TUG 01',tug.x,tug.y+43,7,'#e9cc92',650);
  }

  wake(ctx,game) {
    ctx.save();
    for(const p of game.wake) {
      ctx.globalAlpha=p.life*.15;ctx.strokeStyle='#c6e2df';ctx.lineWidth=1;
      ctx.beginPath();ctx.ellipse(p.x,p.y,p.r*1.8,p.r*.55,p.a||0,0,Math.PI*2);ctx.stroke();
    }
    ctx.restore();
    // Bow waves and propeller wash scale with actual motion and engine load.
    for(const [body,isTug] of [[game.ship,false],...(game.mode==='tug'?[[game.tug,true]]:[])]) {
      const motion=DockPhysics.components(body), speed=Math.hypot(body.vx,body.vy);
      if(speed<2 && Math.abs(body.throttle)<.08)continue;
      ctx.save();ctx.translate(body.x,body.y);ctx.rotate(body.a);
      const alpha=Math.min(.34,speed*.004);
      for(const side of [-1,1]) {
        ctx.strokeStyle=`rgba(195, 228, 226, ${alpha})`;ctx.lineWidth=1.4;
        ctx.beginPath();ctx.moveTo(0,-body.h/2-2);ctx.quadraticCurveTo(side*body.w*.65,-body.h*.25,side*(body.w*.5+9),body.h*.1);ctx.stroke();
      }
      if(Math.abs(body.throttle)>.1) {
        const stern=body.h/2, length=(isTug?22:34)*Math.abs(body.throttle);
        const g=ctx.createLinearGradient(0,stern,0,stern+length);g.addColorStop(0,'#b0d5d044');g.addColorStop(1,'#b0d5d000');
        ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(-3,stern-2);ctx.lineTo(-10,stern+length);ctx.lineTo(10,stern+length);ctx.lineTo(3,stern-2);ctx.fill();
      }
      ctx.restore();
    }
  }

  buoys(ctx,now) {
    const t=this.reducedMotion.matches?0:now;
    for(const b of this.harbor.buoys) {
      ctx.save();ctx.translate(b.x,b.y);ctx.rotate(Math.sin(t*.001+b.x)*.05);
      ctx.strokeStyle='#92c6c01b';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(0,5,10,4,0,0,Math.PI*2);ctx.stroke();
      this.box(ctx,-4,-3,8,9,3,'#243c43','#688a8d');this.line(ctx,0,-9,0,3,'#bfd1bd',1.2);
      ctx.shadowColor=b.c;ctx.shadowBlur=8;this.circle(ctx,0,-8,2.5,b.c);ctx.restore();
    }
  }

  motionGuide(ctx,game) {
    const speed=Math.hypot(game.ship.vx,game.ship.vy);
    if(!game.running || speed<4 || game.metrics.inside)return;
    const body=game.ship, dx=body.vx/speed, dy=body.vy/speed;
    // A velocity vector reveals sideways drift; it is not an autopilot route.
    const nose=Math.abs(dx*Math.sin(body.a)-dy*Math.cos(body.a))*body.h/2+body.w/2;
    const length=Math.min(65,18+speed*.6);
    ctx.save();ctx.strokeStyle='#bfd3cf4d';ctx.lineWidth=1;ctx.setLineDash([3,5]);
    ctx.beginPath();ctx.moveTo(body.x+dx*(nose+5),body.y+dy*(nose+5));ctx.lineTo(body.x+dx*(nose+length),body.y+dy*(nose+length));ctx.stroke();
    ctx.setLineDash([]);this.circle(ctx,body.x+dx*(nose+length),body.y+dy*(nose+length),1.7,'#cae3d370');ctx.restore();
  }

  draw(game,now) {
    if(!this.harbor)return;
    const ctx=this.ctx;
    ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(this.water,0,0);
    this.context(this.canvas);this.waterMotion(ctx,now);this.wake(ctx,game);this.berth(ctx,game,now);
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(this.port,0,0);ctx.restore();
    this.buoys(ctx,now);this.motionGuide(ctx,game);this.vessel(ctx,game.ship,{main:true});this.tug(ctx,game);
    if(!game.metrics.inside) {
      const s=game.ship, offset=Math.abs(Math.cos(s.a))*s.h/2+Math.abs(Math.sin(s.a))*s.w/2+15;
      this.text(ctx,'ATLAS / YOUR SHIP',s.x,Math.min(this.height-30,s.y+offset),7,'#c6dedb',600);
    }
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(this.overhead,0,0);ctx.restore();
    if(!this.reducedMotion.matches) {
      ctx.save();
      for(const p of game.particles) {
        ctx.globalAlpha=Math.max(0,Math.min(1,p.life/p.max));
        if(p.type==='success')this.circle(ctx,p.x,p.y,2,'#ade8c3');
        else if(p.type==='spark')this.box(ctx,p.x,p.y,2,2,1,'#e5be78');
        else {ctx.strokeStyle='#c6e2df';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,3+(1-ctx.globalAlpha)*7,0,Math.PI*2);ctx.stroke();}
      }
      ctx.restore();
    }
  }
};
