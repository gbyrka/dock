'use strict';

const canvas = document.querySelector('#game');
const scene = new DockScene(canvas);
const ui = Object.fromEntries(['engine-order','engine-fill','rudder-marker','stopping','assist-text','check-position','check-align','check-speed','check-turn','berth-progress','berth-fill','clock','time-fill','round-summary','resume','announcement'].map(id => [id, document.querySelector('#'+id)]));
const scoreEl = document.querySelector('#score');
const bestEl = document.querySelector('#best');
const docksEl = document.querySelector('#docks');
const timeEl = document.querySelector('#time');
const speedEl = document.querySelector('#speed');
const headingEl = document.querySelector('#heading');
const alignEl = document.querySelector('#align');
const missionText = document.querySelector('#mission-text');
const statusText = document.querySelector('#status-text');
const overlay = document.querySelector('#overlay');
const titleEl = document.querySelector('#overlay-title');
const copyEl = document.querySelector('#overlay-copy');
const startBtn = document.querySelector('#start');
const menuBtn = document.querySelector('#menu');
const toastEl = document.querySelector('#toast');
const storageEl = document.querySelector('#storage-status');
const historyEl = document.querySelector('#history');
const challengeEl = document.querySelector('#challenge-pill');
const challengeScoreEl = document.querySelector('#challenge-score');
const challengeGapEl = document.querySelector('#challenge-gap');
const shareBtn = document.querySelector('#share-score');
const shareHintEl = document.querySelector('#share-hint');

const tugStatus = document.querySelector('#tug-status');
let mode = new URLSearchParams(location.search).get('mode') === 'tug' ? 'tug' : 'solo';
let tow = null;
let completedMode = null;
const tug = {x:0,y:0,a:0,vx:0,vy:0,omega:0,throttle:0,rudder:0,jet:0,w:28,h:56};

const W = canvas.width;
const H = canvas.height;
const RUN_SECONDS = 180;
const COOKIE = 'dock_scores_v1';
const PUBLIC_URL = 'https://gbyrka.github.io/dock/';
// Reversible client-side obfuscation. The key is intentionally local to the game:
// this hides casual score-reading in shared URLs, but is not an anti-cheat boundary.
const SHARE_KEY = [0x6d2b79f5, 0xa53c91e7, 0x1f4d3b27, 0xc8e6a149];
const keys = new Set();

let frameId = null;
let last = performance.now();
let remaining = RUN_SECONDS;
let accumulator = 0;
let hudElapsed = 0;
let transition = 0;
let hitCount = 0;
let legHits = 0;
let cleanDockings = 0;
let bestDock = 0;
let seconds = RUN_SECONDS;
let running = false;
let paused = false;
let score = 0;
let dockings = 0;
let collisionCooldown = 0;
let berthHold = 0;
let toastTimer = 0;
let harborIndex = 0;
let harbor = null;
let particles = [];
let wake = [];
let records = readRecords();
let challengeScore = readChallengeScore();
let challengeBeatenAnnounced = false;

const ship = {
  x: W / 2,
  y: H / 2,
  a: 0,
  vx: 0,
  vy: 0,
  omega: 0,
  throttle: 0,
  rudder: 0,
  w: 38,
  h: 158
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(min, max) { return min + Math.random() * (max - min); }
function randi(min, max) { return Math.floor(rand(min, max + 1)); }
function choice(a) { return a[Math.floor(Math.random() * a.length)]; }
function normAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function angleDiff(a, b) { return Math.abs(normAngle(a - b)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function xteaEncrypt(v0, v1) {
  let sum = 0;
  const delta = 0x9e3779b9;
  for (let i = 0; i < 32; i++) {
    let mix = (((((v1 << 4) ^ (v1 >>> 5)) + v1) >>> 0) ^ ((sum + SHARE_KEY[sum & 3]) >>> 0)) >>> 0;
    v0 = (v0 + mix) >>> 0;
    sum = (sum + delta) >>> 0;
    mix = (((((v0 << 4) ^ (v0 >>> 5)) + v0) >>> 0) ^ ((sum + SHARE_KEY[(sum >>> 11) & 3]) >>> 0)) >>> 0;
    v1 = (v1 + mix) >>> 0;
  }
  return [v0, v1];
}

function xteaDecrypt(v0, v1) {
  const delta = 0x9e3779b9;
  let sum = 0xc6ef3720;
  for (let i = 0; i < 32; i++) {
    let mix = (((((v0 << 4) ^ (v0 >>> 5)) + v0) >>> 0) ^ ((sum + SHARE_KEY[(sum >>> 11) & 3]) >>> 0)) >>> 0;
    v1 = (v1 - mix) >>> 0;
    sum = (sum - delta) >>> 0;
    mix = (((((v1 << 4) ^ (v1 >>> 5)) + v1) >>> 0) ^ ((sum + SHARE_KEY[sum & 3]) >>> 0)) >>> 0;
    v0 = (v0 - mix) >>> 0;
  }
  return [v0, v1];
}

function scoreCheck(scoreValue, salt) {
  return ((scoreValue ^ 0xa7b3) + salt * 31 + ((scoreValue >>> 16) & 0xffff) * 17) & 0xffff;
}

function encodeChallenge(scoreValue) {
  const clean = clamp(Math.floor(Number(scoreValue) || 0), 0, 10000000) >>> 0;
  let salt;
  try {
    salt = crypto.getRandomValues(new Uint16Array(1))[0];
  } catch {
    salt = Math.floor(Math.random() * 0x10000);
  }
  const check = scoreCheck(clean, salt);
  const [a, b] = xteaEncrypt(clean, (((check << 16) >>> 0) | salt) >>> 0);
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, a, false);
  view.setUint32(4, b, false);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeChallenge(token) {
  try {
    if (!/^[A-Za-z0-9_-]{10,16}$/.test(token || '')) return null;
    const base64 = token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - token.length % 4) % 4);
    const binary = atob(base64);
    if (binary.length !== 8) return null;
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const [scoreValue, packed] = xteaDecrypt(view.getUint32(0, false), view.getUint32(4, false));
    const salt = packed & 0xffff;
    const check = packed >>> 16;
    if (scoreValue > 10000000 || check !== scoreCheck(scoreValue, salt)) return null;
    return scoreValue;
  } catch {
    return null;
  }
}

function readChallengeScore() {
  return decodeChallenge(new URLSearchParams(location.search).get('c'));
}

function buildChallengeUrl(scoreValue) {
  const url = /^https?:$/.test(location.protocol) ? new URL(location.href) : new URL(PUBLIC_URL);
  url.search = '';
  url.hash = '';
  url.searchParams.set('c', encodeChallenge(scoreValue));
  if ((completedMode || mode) === 'tug') url.searchParams.set('mode', 'tug');
  return url.toString();
}

function updateChallengeHud(announce = true) {
  if (challengeScore === null) {
    challengeEl.hidden = true;
    return;
  }
  challengeEl.hidden = false;
  challengeScoreEl.textContent = challengeScore;
  const beaten = score > challengeScore;
  challengeEl.classList.toggle('beaten', beaten);
  challengeGapEl.textContent = beaten ? 'TARGET BEATEN' : `${challengeScore - score + 1} TO BEAT`;
  if (beaten && announce && running && !challengeBeatenAnnounced) {
    challengeBeatenAnnounced = true;
    showToast('<strong>TARGET BEATEN!</strong> · keep going', 1800);
    statusText.textContent = `Challenge beaten · ${score} points and climbing`;
  }
}

async function copyShareText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Clipboard unavailable');
}

function shareScoreOnFacebook() {
  const challengeUrl = buildChallengeUrl(score);
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(challengeUrl)}`;
  const popup = window.open(facebookUrl, 'dock-facebook-share', 'popup=yes,width=720,height=620,resizable=yes,scrollbars=yes');
  const text = `I scored ${score} points in DOCK. Can you beat me? 🚢`;
  copyShareText(text).then(() => {
    shareHintEl.hidden = false;
    shareHintEl.textContent = 'Score text copied — paste it into your Facebook post. The shared link opens this score as a challenge.';
    showToast('<strong>Score copied</strong> · paste it into the Facebook post', 2200);
  }).catch(() => {
    shareHintEl.hidden = false;
    shareHintEl.textContent = `Facebook opened. Add your score manually: ${score} points.`;
  });
  if (!popup) window.location.assign(facebookUrl);
}

function readRecords() {
  const empty = {version: 1, best: 0, history: []};
  try {
    const item = document.cookie.split('; ').find(v => v.startsWith(COOKIE + '='));
    if (!item) return empty;
    const data = JSON.parse(decodeURIComponent(item.slice(COOKIE.length + 1)));
    if (data.version !== 1 || !Array.isArray(data.history)) return empty;
    const valid = n => Number.isSafeInteger(n) && n >= 0;
    empty.best = valid(data.best) ? data.best : 0;
    empty.history = data.history.filter(r => r && valid(r.score) && valid(r.docks) && Number.isFinite(r.at) && !isNaN(new Date(r.at).getTime())).slice(-20);
    return empty;
  } catch { return empty; }
}

function renderRecords() {
  bestEl.textContent = records.best || 0;
  historyEl.replaceChildren();
  if (!records.history.length) {
    const li = document.createElement('li');
    li.textContent = 'No completed runs yet.';
    historyEl.append(li);
    return;
  }
  for (const record of records.history.slice().reverse()) {
    const li = document.createElement('li');
    li.textContent = `${record.mode === 'tug' ? 'Tug assist' : 'Solo captain'} · ${record.score} points · ${record.docks} ${record.docks === 1 ? 'dock' : 'docks'} · ${new Date(record.at).toLocaleString('en-GB')}`;
    historyEl.append(li);
  }
}

function saveResult() {
  records.history.push({score, docks: dockings, at: Date.now(), mode});
  records.history = records.history.slice(-20);
  records.best = Math.max(records.best || 0, score);
  try {
    const encoded = encodeURIComponent(JSON.stringify(records));
    if (encoded.length > 3800) throw new Error('Cookie too large');
    document.cookie = `${COOKIE}=${encoded}; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    if (!document.cookie.split('; ').some(v => v === `${COOKIE}=${encoded}`)) throw new Error('Cookies unavailable');
    storageEl.textContent = '';
  } catch {
    storageEl.textContent = 'Scores are available for this session only. Enable cookies and serve the game over HTTP or HTTPS to persist them.';
  }
  renderRecords();
}

function rectPoly(r) {
  return [
    {x:r.x, y:r.y}, {x:r.x+r.w, y:r.y},
    {x:r.x+r.w, y:r.y+r.h}, {x:r.x, y:r.y+r.h}
  ];
}

function orientedCorners(body = ship) { return DockPhysics.corners(body); }

function polygonsOverlap(a, b) {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const ax = -(q.y - p.y), ay = q.x - p.x;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const v of a) { const n = v.x*ax + v.y*ay; amin = Math.min(amin,n); amax = Math.max(amax,n); }
      for (const v of b) { const n = v.x*ax + v.y*ay; bmin = Math.min(bmin,n); bmax = Math.max(bmax,n); }
      if (amax <= bmin || bmax <= amin) return false;
    }
  }
  return true;
}


function rectsOverlap(a, b, pad=0) {
  return !(a.x+a.w+pad <= b.x || b.x+b.w+pad <= a.x || a.y+a.h+pad <= b.y || b.y+b.h+pad <= a.y);
}

function bodyBounds(body) {
  const c = orientedCorners(body);
  const xs = c.map(p => p.x), ys = c.map(p => p.y);
  return {x:Math.min(...xs), y:Math.min(...ys), w:Math.max(...xs)-Math.min(...xs), h:Math.max(...ys)-Math.min(...ys)};
}

function approachProtection(berth) {
  const pad = 72;
  const depth = 260;
  if (berth.side === 'north') return {x:berth.x-pad,y:berth.y-20,w:berth.w+pad*2,h:berth.h+depth};
  if (berth.side === 'south') return {x:berth.x-pad,y:berth.y-depth+20,w:berth.w+pad*2,h:berth.h+depth};
  if (berth.side === 'west') return {x:berth.x-20,y:berth.y-pad,w:berth.w+depth,h:berth.h+pad*2};
  return {x:berth.x-depth+20,y:berth.y-pad,w:berth.w+depth,h:berth.h+pad*2};
}

function makeMooredShip(sizeClass, dockRect, dockSide) {
  const defs = {
    small:  {w:[17,22], h:[52,72], kind:['tug','pilot']},
    medium: {w:[23,29], h:[84,112], kind:['coaster','ferry']},
    large:  {w:[31,39], h:[122,168], kind:['cargo','ferry']}
  };
  const d = defs[sizeClass];
  const body = {
    x:0,y:0,a:0,
    w:randi(d.w[0],d.w[1]), h:randi(d.h[0],d.h[1]),
    kind:choice(d.kind),
    tone:choice(['#445c67','#526d76','#3f5661','#64747a','#4f666c']),
    phase:rand(0,Math.PI*2),
    sizeClass,
    dockSide
  };

  const gap = 7;
  if (dockSide === 'bottom' || dockSide === 'top') {
    body.a = Math.PI/2;
    const halfLen = body.h/2;
    const minX = dockRect.x + halfLen + 7;
    const maxX = dockRect.x + dockRect.w - halfLen - 7;
    if (maxX <= minX) return null;
    body.x = rand(minX,maxX);
    body.y = dockSide === 'bottom'
      ? dockRect.y+dockRect.h + body.w/2 + gap
      : dockRect.y - body.w/2 - gap;
    body.moor = {x:body.x, y:dockSide === 'bottom' ? dockRect.y+dockRect.h : dockRect.y};
  } else {
    body.a = 0;
    const halfLen = body.h/2;
    const minY = dockRect.y + halfLen + 7;
    const maxY = dockRect.y + dockRect.h - halfLen - 7;
    if (maxY <= minY) return null;
    body.y = rand(minY,maxY);
    body.x = dockSide === 'right'
      ? dockRect.x+dockRect.w + body.w/2 + gap
      : dockRect.x - body.w/2 - gap;
    body.moor = {x:dockSide === 'right' ? dockRect.x+dockRect.w : dockRect.x, y:body.y};
  }
  return body;
}

function makeHarbor() {
  harborIndex++;
  const sides = ['north', 'south', 'east', 'west'];
  const side = choice(sides);
  const land = [];
  const piers = [];
  const containers = [];
  const cranes = [];
  const lights = [];
  const buoys = [];
  const otherShips = [];

  // Thin perimeter walls keep the vessel inside the basin.
  land.push({x:0,y:0,w:W,h:18,type:'wall'});
  land.push({x:0,y:H-18,w:W,h:18,type:'wall'});
  land.push({x:0,y:0,w:18,h:H,type:'wall'});
  land.push({x:W-18,y:0,w:18,h:H,type:'wall'});

  const quayDepth = randi(68, 92);
  let quay, berth, targetAngle, spawn;
  const berthLong = randi(202, 228);
  const berthWide = randi(64, 76);
  const margin = 150;

  if (side === 'north' || side === 'south') {
    const bx = randi(margin, W - margin - berthLong);
    if (side === 'north') {
      quay = {x:18,y:18,w:W-36,h:quayDepth,type:'quay'};
      berth = {x:bx,y:18+quayDepth+18,w:berthLong,h:berthWide,a:Math.PI/2,side};
      spawn = {x:rand(W*.33,W*.67), y:rand(H*.61,H*.78), a:rand(-.25,.25)};
    } else {
      quay = {x:18,y:H-18-quayDepth,w:W-36,h:quayDepth,type:'quay'};
      berth = {x:bx,y:H-18-quayDepth-18-berthWide,w:berthLong,h:berthWide,a:Math.PI/2,side};
      spawn = {x:rand(W*.33,W*.67), y:rand(H*.22,H*.39), a:Math.PI+rand(-.25,.25)};
    }
    targetAngle = Math.PI/2;
  } else {
    const by = randi(margin, H - margin - berthLong);
    if (side === 'west') {
      quay = {x:18,y:18,w:quayDepth,h:H-36,type:'quay'};
      berth = {x:18+quayDepth+18,y:by,w:berthWide,h:berthLong,a:0,side};
      spawn = {x:rand(W*.62,W*.78), y:rand(H*.32,H*.68), a:-Math.PI/2+rand(-.25,.25)};
    } else {
      quay = {x:W-18-quayDepth,y:18,w:quayDepth,h:H-36,type:'quay'};
      berth = {x:W-18-quayDepth-18-berthWide,y:by,w:berthWide,h:berthLong,a:0,side};
      spawn = {x:rand(W*.22,W*.38), y:rand(H*.32,H*.68), a:Math.PI/2+rand(-.25,.25)};
    }
    targetAngle = 0;
  }
  land.push(quay);
  const protectedBerth = approachProtection(berth);

  // Add short peripheral piers, deliberately kept away from the central transit corridor.
  const pierCount = randi(2, 4);
  for (let i=0; i<pierCount; i++) {
    const edge = choice(sides.filter(s => s !== side));
    let p;
    if (edge === 'north' || edge === 'south') {
      const pw = randi(48,70), ph = randi(105,185);
      const xBand = Math.random() < .5 ? rand(90,260) : rand(W-260-pw,W-90-pw);
      p = edge === 'north'
        ? {x:xBand,y:18,w:pw,h:ph,type:'pier',edge}
        : {x:xBand,y:H-18-ph,w:pw,h:ph,type:'pier',edge};
    } else {
      const ph = randi(48,70), pw = randi(105,185);
      const yBand = Math.random() < .5 ? rand(90,230) : rand(H-230-ph,H-90-ph);
      p = edge === 'west'
        ? {x:18,y:yBand,w:pw,h:ph,type:'pier',edge}
        : {x:W-18-pw,y:yBand,w:pw,h:ph,type:'pier',edge};
    }
    // Keep target berth and spawn clear.
    const expanded = {x:p.x-70,y:p.y-70,w:p.w+140,h:p.h+140};
    const spawnRect = {x:spawn.x-100,y:spawn.y-100,w:200,h:200};
    const overlapsBerth = polygonsOverlap(rectPoly(expanded), rectPoly(berth));
    const overlapsSpawn = polygonsOverlap(rectPoly(expanded), rectPoly(spawnRect));
    const blocksApproach = rectsOverlap(p, protectedBerth, 30);
    const overlapsPier = piers.some(other => rectsOverlap(p, other, 35));
    if (!overlapsBerth && !overlapsSpawn && !blocksApproach && !overlapsPier && !rectsOverlap(p, quay)) { land.push(p); piers.push(p); }
  }

  // Containers and cranes live on solid quay surfaces and are purely decorative.
  const decorRects = [quay, ...piers];
  for (const r of decorRects) {
    const horizontal = r.w > r.h;
    // Ordered stacks leave access lanes instead of intersecting randomly.
    const span = horizontal ? r.w : r.h;
    const cross = horizontal ? r.h : r.w;
    const rows = Math.max(1, Math.floor((cross - 27) / 19));
    for (let along=14; along<span-40; along+=42) for (let row=0; row<rows; row++) {
      if (Math.random()<.2) continue;
      const offset=9+row*19;
      containers.push({x:r.x+(horizontal?along:offset),y:r.y+(horizontal?offset:along),w:horizontal?34:14,h:horizontal?14:34,c:choice(['#986953','#b09159','#537d8d','#597a70','#856b62','#687d84'])});
    }
  }

  const craneCount = randi(3,5);
  for (let i=0;i<craneCount;i++) {
    if (side === 'north' || side === 'south') {
      cranes.push({x:150+(W-300)*(i+.5)/craneCount+rand(-24,24),y: side==='north' ? quay.y+quay.h-13 : quay.y+13,a: side==='north'?0:Math.PI});
    } else {
      cranes.push({x: side==='west' ? quay.x+quay.w-13 : quay.x+13,y:100+(H-200)*(i+.5)/craneCount+rand(-15,15),a: side==='west'?-Math.PI/2:Math.PI/2});
    }
  }

  for (let i=0;i<randi(10,15);i++) lights.push({x:rand(42,W-42),y:rand(42,H-42),phase:rand(0,Math.PI*2)});
  // Navigation buoys outline an approach corridor but do not collide.
  if (side === 'north' || side === 'south') {
    const cy = side === 'north' ? berth.y + berth.h + 34 : berth.y - 34;
    buoys.push({x:berth.x-18,y:cy,c:'#61e7bc'},{x:berth.x+berth.w+18,y:cy,c:'#f26c67'});
  } else {
    const cx = side === 'west' ? berth.x + berth.w + 34 : berth.x - 34;
    buoys.push({x:cx,y:berth.y-18,c:'#61e7bc'},{x:cx,y:berth.y+berth.h+18,c:'#f26c67'});
  }

  // Populate the harbor with moored traffic. Ships stay clear of the player's berth,
  // straight-in approach corridor, spawn area, land, and each other.
  const spawnSafe = {x:spawn.x-115,y:spawn.y-115,w:230,h:230};
  const mooringOptions = [];
  const waterFace = side === 'north' ? 'bottom' : side === 'south' ? 'top' : side === 'west' ? 'right' : 'left';
  mooringOptions.push({rect:quay, face:waterFace});
  // The three non-target basin edges double as secondary quays, giving every
  // procedural layout enough room for a convincing mix of moored traffic.
  if (side !== 'north') mooringOptions.push({rect:land[0],face:'bottom'});
  if (side !== 'south') mooringOptions.push({rect:land[1],face:'top'});
  if (side !== 'west') mooringOptions.push({rect:land[2],face:'right'});
  if (side !== 'east') mooringOptions.push({rect:land[3],face:'left'});
  for (const p of piers) {
    if (p.edge === 'north' || p.edge === 'south') {
      mooringOptions.push({rect:p,face:'left'},{rect:p,face:'right'});
    } else {
      mooringOptions.push({rect:p,face:'top'},{rect:p,face:'bottom'});
    }
  }

  const desiredShips = randi(4,7);
  const sizes = ['large','small','medium'];
  while (sizes.length < desiredShips) sizes.push(choice(['small','small','medium','medium','large']));
  for (let i=0; i<desiredShips; i++) {
    let placed = false;
    for (let attempt=0; attempt<120 && !placed; attempt++) {
      const option = choice(mooringOptions);
      const candidate = makeMooredShip(sizes[i], option.rect, option.face);
      if (!candidate) continue;
      const poly = orientedCorners(candidate);
      const bounds = bodyBounds(candidate);
      if (bounds.x < 24 || bounds.y < 24 || bounds.x+bounds.w > W-24 || bounds.y+bounds.h > H-24) continue;
      if (rectsOverlap(bounds, protectedBerth, 18) || rectsOverlap(bounds, spawnSafe, 22)) continue;
      if (land.some(r => polygonsOverlap(poly, rectPoly(r)))) continue;
      if (otherShips.some(o => polygonsOverlap(poly, orientedCorners(o)))) continue;
      otherShips.push(candidate);
      placed = true;
    }
  }

  const names = ['KILO','OSCAR','DELTA','SIERRA','LIMA','ECHO','TANGO','ROMEO'];
  return {side, land, piers, containers, cranes, lights, buoys, otherShips, berth, targetAngle, spawn, berthName:`${choice(names)}-${randi(2,9)}`};
}

function resetShipForHarbor() {
  const s = harbor.spawn;
  Object.assign(ship, {x:s.x,y:s.y,a:s.a,vx:0,vy:0,omega:0,throttle:0,rudder:0,contactGrace:0});
  resetTug();
  berthHold = 0; legHits = 0;
  collisionCooldown = .4;
  wake = [];
  missionText.textContent = `BERTH ${harbor.berthName} · ${harbor.side.toUpperCase()} QUAY`;
  document.querySelector('#chart-number').textContent = String(harborIndex).padStart(2, '0');
  statusText.textContent = `Harbor ${harborIndex.toString().padStart(2,'0')} · proceed to highlighted berth`;
}

function newHarbor() {
  harbor = makeHarbor();
  resetShipForHarbor();
  particles=[];scene.configure(harbor);
}

function showToast(html, ms=1600) {
  toastEl.innerHTML = html;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function start() {
  cancelAnimationFrame(frameId); frameId = null; keys.clear();
  mode = document.querySelector('input[name="mode"]:checked').value;
  score = 0; dockings = 0; hitCount = 0; cleanDockings = 0; bestDock = 0;
  completedMode = null; challengeBeatenAnnounced = false; harborIndex = 0;
  remaining = RUN_SECONDS; seconds = RUN_SECONDS; accumulator = 0; transition = 0; hudElapsed = 0;
  particles = []; running = true; paused = false;
  shareBtn.hidden = true; shareHintEl.hidden = true; ui.resume.hidden = true; ui['round-summary'].hidden = true;
  startBtn.classList.remove('secondary');
  document.querySelectorAll('.tug-controls').forEach(el => el.hidden = mode !== 'tug');
  updateChallengeHud(false); newHarbor(); setOverlay(false); updateHUD();
  last = performance.now(); frameId = requestAnimationFrame(loop);
  ui.announcement.textContent = `Watch started. Proceed to berth ${harbor.berthName}.`;
}

function openMenu(reason = 'manual') {
  if (!running) { setOverlay(true); return; }
  paused = true; running = false; keys.clear(); accumulator = 0;
  cancelAnimationFrame(frameId); frameId = null;
  titleEl.innerHTML = 'The harbor can wait.<br><span>Your watch is paused.</span>';
  copyEl.textContent = reason === 'focus' ? 'Your watch was paused while you were away. Resume with the same vessels, towline, score and remaining time.' : 'Take a breather. Resume exactly where you left off, or start a fresh watch below.';
  document.querySelector('#overlay-eyebrow').textContent = 'HARBOR CONTROL / STANDBY';
  startBtn.textContent = 'Start a new watch ↗'; startBtn.classList.add('secondary');
  ui.resume.hidden = false; ui['round-summary'].hidden = true;
  shareBtn.hidden = true; shareHintEl.hidden = true;
  toastEl.classList.remove('show'); updateHUD(); draw(performance.now()); setOverlay(true);
}

function setOverlay(visible) {
  overlay.classList.toggle('hidden', !visible); canvas.inert = visible;
  if (visible) { overlay.scrollTop = 0; (paused ? ui.resume : startBtn).focus({preventScroll:true}); }
  else canvas.focus({preventScroll:true});
}

function resume() {
  if (!paused) return;
  document.querySelector(`input[value="${mode}"]`).checked = true;
  keys.clear(); paused = false; running = true; accumulator = 0;
  last = performance.now(); selectMode(); setOverlay(false); frameId = requestAnimationFrame(loop);
}

function finish() {
  if (!running) return;
  running = false; paused = false; keys.clear();
  seconds = 0; remaining = 0;
  ui.resume.hidden = true; startBtn.classList.remove('secondary');
  document.querySelector('#overlay-eyebrow').textContent = 'WATCH COMPLETE / CAPTAIN’S LOG';
  completedMode = mode;
  saveResult();
  updateChallengeHud(false);
  if (challengeScore !== null) {
    const beaten = score > challengeScore;
    titleEl.innerHTML = beaten
      ? `Target beaten!<br><span>${score} points vs ${challengeScore}.</span>`
      : `${score} points<br><span>${challengeScore - score + 1} more to beat the challenge.</span>`;
    copyEl.textContent = beaten
      ? 'Challenge cleared. Share your new score and send the harbor back to whoever challenged you.'
      : 'Close. Run another shift or share your own score and turn it into a new challenge.';
  } else {
    titleEl.innerHTML = `${score} points<br><span>${dockings} ${dockings === 1 ? 'safe docking' : 'safe dockings'}.</span>`;
    copyEl.textContent = dockings === 0
      ? 'The quay is still waiting. Large ships reward anticipation: reduce power early and line up long before the berth.'
      : dockings < 3
        ? 'Solid watch. There is plenty of room in the score for cleaner alignment and a gentler final approach.'
        : 'Port authority approves. Now beat it with fewer collisions and cleaner approaches.';
  }
  startBtn.textContent = 'Run another shift';
  shareBtn.hidden = false;
  shareHintEl.hidden = false;
  shareHintEl.textContent = 'Sharing creates a challenge link with an encoded score and opens Facebook.';
  const summary = ui['round-summary']; summary.replaceChildren();
  for (const [value,label] of [[cleanDockings,'without contact'],[hitCount,'contacts'],[bestDock,'best docking']]) {
    const item=document.createElement('div'), strong=document.createElement('strong');
    strong.textContent=value;item.append(strong,document.createTextNode(label));summary.append(item);
  }
  summary.hidden=false;ui.announcement.textContent=`Watch complete. ${score} points and ${dockings} dockings.`;
  updateHUD();setOverlay(true);
}

function worldSpeed() { return Math.hypot(ship.vx, ship.vy); }
function forwardVector() { return {x:Math.sin(ship.a), y:-Math.cos(ship.a)}; }
function forwardSpeed() { const f=forwardVector(); return ship.vx*f.x + ship.vy*f.y; }

function emitWake(dt) {
  const speed = worldSpeed();
  if (speed < 8 || Math.random() > dt * clamp(speed*.8,6,38)) return;
  const f = forwardVector();
  const backX = ship.x - f.x * ship.h*.45;
  const backY = ship.y - f.y * ship.h*.45;
  const side = Math.random() < .5 ? -1 : 1;
  wake.push({
    x: backX + Math.cos(ship.a)*side*ship.w*.28,
    y: backY + Math.sin(ship.a)*side*ship.w*.28,
    r:rand(2,5), life:1, max:rand(1.4,2.2), a:ship.a
  });
  if (wake.length > 240) wake.shift();
}

function emitCollision(body = ship, point = body) {
  for(let i=0;i<15;i++)particles.push({x:point.x+rand(-5,5),y:point.y+rand(-5,5),vx:rand(-35,35),vy:rand(-35,35),life:rand(.3,.7),max:.7,type:Math.random()<.25?'spark':'foam'});
}

function updateParticles(dt) {
  for (const p of particles) {
    p.x += p.vx*dt; p.y += p.vy*dt; p.vx *= Math.pow(.94,dt*60); p.vy *= Math.pow(.94,dt*60); p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);
  for (const p of wake) { p.life -= dt/p.max; p.r += dt*6; }
  wake = wake.filter(p => p.life > 0);
}

function collisionInfo(body = ship) {
  const poly = orientedCorners(body), bounds = bodyBounds(body);
  for (const r of harbor.land) {
    if (!rectsOverlap(bounds, r)) continue;
    const contact = DockPhysics.manifold(poly, rectPoly(r));
    if (contact) return {type:'structure', object:r, ...contact};
  }
  for (const other of harbor.otherShips || []) {
    if (!rectsOverlap(bounds, bodyBounds(other))) continue;
    const contact = DockPhysics.manifold(poly, orientedCorners(other));
    if (contact) return {type:'vessel', object:other, ...contact};
  }
  return null;
}

function handleContact(body, old, hit, isTug) {
  const impact = DockPhysics.resolveContact(body, old, hit, isTug);
  if ((body.contactGrace || 0) <= 0 && collisionCooldown <= 0 && impact > 2) {
    const penalty = hit.type === 'vessel' ? 35 : 25;
    score = Math.max(0, score - penalty); hitCount++; legHits++;
    collisionCooldown = .65;
    updateChallengeHud(false);
    emitCollision(body, hit.point);
    showToast(`<strong>−${penalty}</strong> · ${isTug ? 'tug ' : ''}${hit.type === 'vessel' ? 'vessel contact' : 'quay contact'}`, 1500);
    statusText.textContent = 'Contact reported · ease off and move clear';
  }
  // One continuous scrape is one contact, not a fresh penalty on every frame.
  body.contactGrace = .5;
}

function moveShip(dt) {
  const old = {...ship};
  ship.contactGrace = Math.max(0, (ship.contactGrace || 0) - dt);
  DockPhysics.advance(ship, {ahead:keys.has('ArrowUp'), astern:keys.has('ArrowDown'), left:keys.has('ArrowLeft'), right:keys.has('ArrowRight')}, dt);
  const hit = collisionInfo();
  if (hit) handleContact(ship, old, hit, false);
  if (mode === 'tug' && polygonsOverlap(orientedCorners(ship), orientedCorners(tug))) {
    const oldTug = {...tug};
    separateTug();
    if (collisionInfo(tug)) {
      Object.assign(tug, oldTug); Object.assign(ship, old);
      ship.vx *= .95; ship.vy *= .95; ship.omega *= .9;
    }
  }
  emitWake(dt);
}

function dockingMetrics() { return DockPhysics.docking(ship, harbor.berth, harbor.targetAngle); }

function completeDock(metrics) {
  const centerBonus = Math.round(60 * clamp(1 - metrics.centerDistance / 65, 0, 1));
  const alignBonus = Math.round(60 * clamp(1 - metrics.align / (14*Math.PI/180), 0, 1));
  const gentleBonus = Math.round(60 * clamp(1 - metrics.speed / 9, 0, 1));
  const earned = 100 + centerBonus + alignBonus + gentleBonus;
  score += earned; dockings++; bestDock = Math.max(bestDock, earned);
  if (legHits === 0) cleanDockings++;
  showToast(`<strong>BERTH SECURED  +${earned}</strong><br>Centering +${centerBonus} · Alignment +${alignBonus} · Approach +${gentleBonus}`, 3100);
  statusText.textContent = `Berth ${harbor.berthName} secured · receiving the next assignment`;
  for (let i=0;i<32;i++) particles.push({x:ship.x+rand(-45,45),y:ship.y+rand(-55,55),vx:rand(-25,25),vy:rand(-25,25),life:rand(.6,1.3),max:1.3,type:'success'});
  transition = 1.05; berthHold = 1.35; keys.clear();
  updateChallengeHud(true);
  ui.announcement.textContent = `Berth secured. ${earned} points. Total ${score}.`;
}

function update(dt) {
  remaining = Math.max(0, remaining - dt);
  if (remaining <= 0) { finish(); return; }
  collisionCooldown = Math.max(0, collisionCooldown - dt);
  updateParticles(dt);
  if (transition > 0) {
    transition = Math.max(0, transition - dt);
    if (transition === 0) { newHarbor(); keys.clear(); }
    return;
  }
  if (mode === 'tug') applyTow(dt);
  moveShip(dt);
  if (mode === 'tug') moveTug(dt);
  const metrics = dockingMetrics();
  berthHold = metrics.ready ? berthHold + dt : 0;
  if (berthHold >= 1.35) completeDock(metrics);
}

function setText(element, text) { if(element.textContent!==String(text))element.textContent=text; }

function updateHUD() {
  const metrics=dockingMetrics(), motion=DockPhysics.components(ship);
  seconds=Math.ceil(remaining);
  setText(timeEl, `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`);
  setText(scoreEl,score);setText(docksEl,dockings);
  ui.clock.classList.toggle('urgent',seconds<=20);
  ui['time-fill'].style.transform=`scaleX(${remaining/RUN_SECONDS})`;
  setText(speedEl,(metrics.speed*.19).toFixed(1));
  setText(headingEl,String(Math.round((ship.a*180/Math.PI+360)%360)%360).padStart(3,'0'));
  setText(alignEl,Math.round(metrics.align*180/Math.PI));
  alignEl.parentElement.style.color=metrics.aligned?'var(--green)':'var(--amber)';
  setText(ui.stopping,`≈ ${(DockPhysics.stoppingDistance(ship)/ship.h).toFixed(1)} hulls`);
  const order=Math.abs(ship.throttle)<.05?'NEUTRAL':ship.throttle<0?'ASTERN':ship.throttle<.5?'SLOW AHEAD':'AHEAD';
  setText(ui['engine-order'],order);
  ui['engine-order'].style.color=ship.throttle<-.05?'var(--amber)':'var(--cyan)';
  ui['engine-fill'].style.left=`${ship.throttle<0?50+ship.throttle*50:50}%`;
  ui['engine-fill'].style.width=`${Math.abs(ship.throttle)*50}%`;
  ui['engine-fill'].style.background=ship.throttle<0?'var(--amber)':'var(--cyan)';
  ui['rudder-marker'].style.left=`${50+ship.rudder*48}%`;
  for(const [id,ok] of [['position',metrics.inside],['align',metrics.aligned],['speed',metrics.slow],['turn',metrics.settled]])ui['check-'+id].classList.toggle('met',ok);
  const progress=clamp(berthHold/1.35,0,1);
  ui['berth-fill'].style.transform=`scaleX(${progress})`;
  ui['berth-progress'].setAttribute('aria-valuenow',String(Math.round(progress*100)));
  const near=metrics.centerDistance<250;
  let help='PROCEED TO ASSIGNED BERTH';
  if(paused)help='WATCH PAUSED';
  else if(!running)help=completedMode?'WATCH COMPLETE':'AWAITING DEPARTURE';
  else if(transition>0)help='BERTH SECURED';
  else if(metrics.ready)help='HOLD STEADY · SECURING LINES';
  else if(metrics.inside&&!metrics.aligned)help='ALIGN WITH THE QUAY';
  else if(metrics.inside&&!metrics.slow)help='OPPOSITE ENGINE TO SLOW';
  else if(metrics.inside&&!metrics.settled)help='LET THE TURN SETTLE';
  else if(near&&!metrics.slow)help='SLOW YOUR APPROACH';
  else if(near&&!metrics.aligned)help='LINE UP WITH THE BERTH';
  else if(near)help='BRING THE WHOLE HULL INSIDE';
  setText(ui['assist-text'],help);
  if(running&&transition===0&&collisionCooldown<=0) {
    const drift=Math.abs(motion.lateral)*.19;
    statusText.textContent=metrics.ready?`Berth ${harbor.berthName} · securing ${Math.round(progress*100)}%`:`${mode==='tug'?'TUG ASSIST':'SOLO CAPTAIN'} / Harbor ${String(harborIndex).padStart(2,'0')} · ${drift>.3?`sideways drift ${drift.toFixed(1)} kt`:'clear water, steady hands'}`;
  }
  updateTugHud();
}

function draw(now) {
  if(!harbor)return;
  const towAnchor=mode==='tug'?(tow?hullPoint(tow.local):canAttach()?nearestTowPoint().point:null):null;
  scene.draw({ship,tug,tow,mode,berthHold,particles,wake,running,towAnchor,metrics:dockingMetrics()},now);
}

function loop(now) {
  frameId=null;
  if(!running)return;
  const dt=Math.max(0,(now-last)/1000);last=now;
  if(dt>.5){openMenu('focus');return;}
  accumulator+=dt;hudElapsed+=dt;
  while(accumulator>=DockPhysics.STEP&&running){update(DockPhysics.STEP);accumulator-=DockPhysics.STEP;}
  if(hudElapsed>=.08||!running){updateHUD();hudElapsed=0;}
  draw(now);
  if(running)frameId=requestAnimationFrame(loop);
}

function eventKey(event) { return event.code==='Space'?' ':event.key.length===1?event.key.toLowerCase():event.key; }
addEventListener('keydown',event=>{
  const key=eventKey(event);
  if(!overlay.classList.contains('hidden')&&key==='Tab') {
    const controls=[...overlay.querySelectorAll('button, input, a[href]')].filter(el=>!el.hidden&&!el.disabled&&(el.type!=='radio'||el.checked));
    const first=controls[0],end=controls[controls.length-1];
    if(event.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){event.preventDefault();end.focus();}
    else if(!event.shiftKey&&(document.activeElement===end||!controls.includes(document.activeElement))){event.preventDefault();first.focus();}
    return;
  }
  if(key==='Escape'&&!event.repeat){event.preventDefault();if(paused)resume();else openMenu();return;}
  if(event.ctrlKey||event.metaKey||event.altKey||event.target?.closest('input, select, textarea, button, a, summary, [contenteditable="true"]'))return;
  if(key==='r'&&!event.repeat){event.preventDefault();start();return;}
  if(!running)return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','s','a','d','q','e',' '].includes(key)) {
    event.preventDefault();if(!event.repeat)keys.add(key);
    if(key===' '&&!event.repeat)toggleTow();
  }
});
addEventListener('keyup',event=>keys.delete(eventKey(event)));
addEventListener('blur',()=>{keys.clear();if(running)openMenu('focus');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)openMenu('focus');});
document.querySelectorAll('input[name="mode"]').forEach(el=>el.addEventListener('change',selectMode));
startBtn.addEventListener('click',start);ui.resume.addEventListener('click',resume);
menuBtn.addEventListener('click',()=>openMenu());shareBtn.addEventListener('click',shareScoreOnFacebook);
document.querySelector(`input[value="${mode}"]`).checked=true;
renderRecords();newHarbor();selectMode();updateChallengeHud(false);
if(challengeScore!==null) {
  titleEl.innerHTML=`Beat ${challengeScore} points.<br><span>Challenge accepted?</span>`;
  copyEl.textContent='A friend sent you this score to beat. A fresh procedural harbor awaits — only the target travels with the link.';
  startBtn.textContent='Accept challenge ↗';statusText.textContent=`Challenge received · beat ${challengeScore} points`;
}
canvas.inert=true;draw(performance.now());
new ResizeObserver(()=>{scene.resize();draw(performance.now());}).observe(document.querySelector('#board-wrap'));

// The towline pulls at a fixed point on the main hull, transferring both force
// and torque. It goes slack when the tug moves closer; it never pushes.
function hullPoint(local) {
  const c = Math.cos(ship.a), s = Math.sin(ship.a);
  return {x: ship.x + local.x*c-local.y*s, y: ship.y + local.x*s+local.y*c};
}

function nearestTowPoint() {
  const c = Math.cos(ship.a), s = Math.sin(ship.a);
  const dx = tug.x-ship.x, dy = tug.y-ship.y;
  const x = dx*c+dy*s, y = -dx*s+dy*c;
  const local = {x:clamp(x,-ship.w/2,ship.w/2), y:clamp(y,-ship.h/2,ship.h/2)};
  if (Math.abs(x) < ship.w/2 && Math.abs(y) < ship.h/2) {
    if (ship.w/2-Math.abs(x) < ship.h/2-Math.abs(y)) local.x = (Math.sign(x)||1)*ship.w/2;
    else local.y = (Math.sign(y)||1)*ship.h/2;
  }
  return {local, point:hullPoint(local)};
}

function lineBlocked(a, b) {
  // Segment / convex polygon intersection, including endpoints inside obstacles.
  return [...harbor.land.map(rectPoly), ...harbor.otherShips.map(orientedCorners)].some(poly => {
    let lo = 0, hi = 1;
    for (let i=0;i<poly.length;i++) {
      const p=poly[i], q=poly[(i+1)%poly.length];
      const ex=q.x-p.x, ey=q.y-p.y;
      const start=ex*(a.y-p.y)-ey*(a.x-p.x);
      const delta=ex*(b.y-a.y)-ey*(b.x-a.x);
      if (Math.abs(delta)<1e-9) { if (start<0) return false; }
      else if (delta>0) lo=Math.max(lo,-start/delta);
      else hi=Math.min(hi,-start/delta);
      if (lo>hi) return false;
    }
    return true;
  });
}

function canAttach() {
  const near = nearestTowPoint();
  return dist(tug, near.point) <= 78 && !lineBlocked(tug, near.point);
}

function toggleTow() {
  if (!running || mode !== 'tug') return;
  if (tow) { tow=null; showToast('Towline released'); }
  else if (canAttach()) {
    const near=nearestTowPoint();
    tow={local:near.local, length:Math.max(34,dist(tug,near.point)), tension:0};
    showToast('<strong>Towline secured</strong> · pull away to assist');
  } else showToast('Move closer to the main ship · keep the towline clear');
  updateTugHud();
}

function resetTug() {
  tow=null;
  Object.assign(tug,{a:ship.a,vx:0,vy:0,omega:0,throttle:0,rudder:0,jet:0,contactGrace:0});
  // Search nearby open water before falling back to the rest of the basin.
  const candidates=[];
  for (const radius of [72,96,130,175,230,320,450,600,800]) {
    for (let i=0;i<32;i++) {
      const a=ship.a+i*Math.PI/16;
      candidates.push({x:ship.x+Math.cos(a)*radius,y:ship.y+Math.sin(a)*radius});
    }
  }
  const spawn=candidates.find(p => {
    Object.assign(tug,p);
    return !collisionInfo(tug) && !polygonsOverlap(orientedCorners(tug),orientedCorners(ship)) && p.x>40 && p.x<W-40 && p.y>50 && p.y<H-50;
  });
  if (!spawn) throw new Error('No clear tug spawn');
  Object.assign(tug,spawn);
  updateTugHud();
}

function updateTugHud() {
  tugStatus.hidden=mode!=='tug';
  if (mode!=='tug') return;
  const ready=!tow && canAttach();
  tugStatus.classList.toggle('ready',ready || !!tow);
  const text=tow ? `TOWLINE ${tow.tension>3 ? 'TAUT · PULLING' : 'SLACK'} · SPACE TO RELEASE` : ready ? 'IN RANGE · SPACE TO ATTACH' : 'TUG FREE · MOVE CLOSER TO ATTACH';
  if (tugStatus.textContent!==text) tugStatus.textContent=text;
}

function applyTow(dt) {
  if (!tow) return;
  const anchor=hullPoint(tow.local);
  if (lineBlocked(tug,anchor) || dist(tug,anchor)>tow.length+110) {
    tow=null; showToast('Towline released · line obstructed or overstretched'); return;
  }
  const dx=tug.x-anchor.x, dy=tug.y-anchor.y, length=Math.hypot(dx,dy);
  const nx=dx/(length||1), ny=dy/(length||1);
  const rx=anchor.x-ship.x, ry=anchor.y-ship.y;
  const separation=(tug.vx-ship.vx+ship.omega*ry)*nx+(tug.vy-ship.vy-ship.omega*rx)*ny;
  const force=length>tow.length ? clamp((length-tow.length)*10+separation*7,0,150) : 0;
  tow.tension=force;
  // Main ship mass 5, tug mass 1; hull inertia keeps the rotation gradual.
  ship.vx+=nx*force/5*dt; ship.vy+=ny*force/5*dt;
  ship.omega=clamp(ship.omega+(rx*ny-ry*nx)*force/DockPhysics.MAIN.inertia*dt,-DockPhysics.MAIN.maxYaw,DockPhysics.MAIN.maxYaw);
  tug.vx-=nx*force*dt; tug.vy-=ny*force*dt;
}

function moveTug(dt) {
  const old = {...tug};
  tug.contactGrace = Math.max(0, (tug.contactGrace || 0) - dt);
  DockPhysics.advance(tug, {ahead:keys.has('w'), astern:keys.has('s'), left:keys.has('a'), right:keys.has('d'), port:keys.has('q'), starboard:keys.has('e')}, dt, true);
  const hit = collisionInfo(tug);
  if (hit) handleContact(tug, old, hit, true);
  if (polygonsOverlap(orientedCorners(tug),orientedCorners(ship))) {
    separateTug();
    if (collisionInfo(tug)) {
      tug.x=old.x; tug.y=old.y; tug.a=old.a;
    }
  }
  const speed=Math.hypot(tug.vx,tug.vy), fx=Math.sin(tug.a), fy=-Math.cos(tug.a);
  if ((speed>8 || Math.abs(tug.jet)>.1) && Math.random()<dt*24) {
    wake.push({x:tug.x-fx*25,y:tug.y-fy*25,r:2,life:.8,max:.7,a:tug.a});
    if(wake.length>240)wake.shift();
  }
}

function selectMode() {
  const selected=document.querySelector('input[name="mode"]:checked').value;
  document.querySelectorAll('#mode-help [data-mode]').forEach(el=>el.hidden=el.dataset.mode!==selected);
  if(!running&&!paused){mode=selected;resetTug();}
  document.querySelectorAll('.tug-controls').forEach(el=>el.hidden=mode!=='tug');
  updateHUD();draw(performance.now());
}

// Rubber fenders transfer a non-bouncing contact impulse in both directions.
// Keep positional correction on the lighter tug so pushing cannot teleport the
// main hull through a quay. Its movement still goes through moveShip collisions.
function separateTug() {
  const a=orientedCorners(ship), b=orientedCorners(tug);
  let depth=Infinity, normal=null;
  for (const poly of [a,b]) {
    for (let i=0;i<poly.length;i++) {
      const p=poly[i], q=poly[(i+1)%poly.length];
      const len=Math.hypot(q.x-p.x,q.y-p.y);
      let nx=-(q.y-p.y)/len, ny=(q.x-p.x)/len;
      if ((tug.x-ship.x)*nx+(tug.y-ship.y)*ny<0) { nx=-nx; ny=-ny; }
      const overlap=Math.max(...a.map(v=>v.x*nx+v.y*ny))-Math.min(...b.map(v=>v.x*nx+v.y*ny));
      if (overlap<depth) { depth=overlap; normal={x:nx,y:ny}; }
    }
  }
  const contact=nearestTowPoint().point;
  const rx=contact.x-ship.x, ry=contact.y-ship.y;
  const arm=rx*normal.y-ry*normal.x;
  const closing=(ship.vx-ship.omega*ry-tug.vx)*normal.x
    +(ship.vy+ship.omega*rx-tug.vy)*normal.y;
  if (closing>0) {
    // Same masses and main-hull inertia as the towline. Sustained engine or
    // thruster input becomes a steady push; separating hulls receive no force.
    const impulse=closing/(1+1/5+arm*arm/11000);
    ship.vx-=normal.x*impulse/5; ship.vy-=normal.y*impulse/5;
    ship.omega=clamp(ship.omega-arm*impulse/DockPhysics.MAIN.inertia,-DockPhysics.MAIN.maxYaw,DockPhysics.MAIN.maxYaw);
    tug.vx+=normal.x*impulse; tug.vy+=normal.y*impulse;
  }
  tug.x+=normal.x*(depth+.01); tug.y+=normal.y*(depth+.01);
}
