'use strict';

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
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
let deadline = 0;
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

function orientedCorners(body = ship) {
  const ca = Math.cos(body.a), sa = Math.sin(body.a);
  const hw = body.w / 2, hh = body.h / 2;
  return [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y]) => ({
    x: body.x + x * ca - y * sa,
    y: body.y + x * sa + y * ca
  }));
}

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
    if (!overlapsBerth && !overlapsSpawn) { land.push(p); piers.push(p); }
  }

  // Containers and cranes live on solid quay surfaces and are purely decorative.
  const decorRects = [quay, ...piers];
  for (const r of decorRects) {
    const horizontal = r.w > r.h;
    const count = r.type === 'quay' ? randi(10,18) : randi(2,5);
    for (let i=0; i<count; i++) {
      const cw = horizontal ? randi(24,40) : randi(15,22);
      const ch = horizontal ? randi(14,21) : randi(25,38);
      containers.push({
        x: rand(r.x+8, Math.max(r.x+9, r.x+r.w-cw-8)),
        y: rand(r.y+8, Math.max(r.y+9, r.y+r.h-ch-8)),
        w:cw,h:ch,
        c: choice(['#b95945','#c88c3e','#3c7895','#4f8a70','#8b6956','#657381'])
      });
    }
  }

  const craneCount = randi(3,5);
  for (let i=0;i<craneCount;i++) {
    if (side === 'north' || side === 'south') {
      cranes.push({x:rand(150,W-150),y: side==='north' ? quay.y+quay.h-13 : quay.y+13,a: side==='north'?0:Math.PI});
    } else {
      cranes.push({x: side==='west' ? quay.x+quay.w-13 : quay.x+13,y:rand(130,H-130),a: side==='west'?-Math.PI/2:Math.PI/2});
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
  const protectedBerth = approachProtection(berth);
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
  Object.assign(ship, {x:s.x,y:s.y,a:s.a,vx:0,vy:0,omega:0,throttle:0,rudder:0});
  resetTug();
  berthHold = 0;
  collisionCooldown = .4;
  wake = [];
  missionText.textContent = `BERTH ${harbor.berthName} · ${harbor.side.toUpperCase()} QUAY`;
  statusText.textContent = `Harbor ${harborIndex.toString().padStart(2,'0')} · proceed to highlighted berth`;
}

function newHarbor() {
  harbor = makeHarbor();
  resetShipForHarbor();
}

function showToast(html, ms=1600) {
  toastEl.innerHTML = html;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function start() {
  cancelAnimationFrame(frameId);
  keys.clear();
  mode = document.querySelector('input[name="mode"]:checked').value;
  score = 0;
  dockings = 0;
  challengeBeatenAnnounced = false;
  harborIndex = 0;
  seconds = RUN_SECONDS;
  deadline = performance.now() + RUN_SECONDS * 1000;
  particles = [];
  scoreEl.textContent = score;
  docksEl.textContent = dockings;
  timeEl.textContent = seconds;
  titleEl.innerHTML = 'Bring 40,000 tonnes<br><span>gently alongside.</span>';
  copyEl.textContent = 'Every harbor is generated differently, including its moored traffic. Put the entire ship inside the illuminated berth, align with the quay and come almost to a stop.';
  startBtn.textContent = 'Start night shift';
  shareBtn.hidden = true;
  shareHintEl.hidden = true;
  updateChallengeHud(false);
  newHarbor();
  running = true;
  paused = false;
  overlay.classList.add('hidden');
  startBtn.blur();
  last = performance.now();
  frameId = requestAnimationFrame(loop);
}

function openMenu() {
  if (!running) { overlay.classList.remove('hidden'); return; }
  paused = true;
  running = false;
  cancelAnimationFrame(frameId);
  titleEl.innerHTML = 'Harbor control<br><span>on standby.</span>';
  copyEl.textContent = 'This run is paused. Starting again creates a fresh procedural harbor and resets the score.';
  startBtn.textContent = 'Start new run';
  shareBtn.hidden = true;
  shareHintEl.hidden = true;
  overlay.classList.remove('hidden');
}

function finish() {
  if (!running) return;
  running = false;
  seconds = 0;
  timeEl.textContent = '0';
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
  overlay.classList.remove('hidden');
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
    r:rand(2,5), life:1, max:rand(.8,1.4)
  });
  if (wake.length > 180) wake.shift();
}

function emitCollision() {
  for (let i=0;i<26;i++) particles.push({
    x:ship.x+rand(-20,20), y:ship.y+rand(-45,45),
    vx:rand(-95,95), vy:rand(-95,95), life:rand(.35,.85), max:1,
    type: Math.random() < .55 ? 'spark' : 'foam'
  });
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
  const poly = orientedCorners(body);
  if (harbor.land.some(r => polygonsOverlap(poly, rectPoly(r)))) return {type:'structure'};
  const other = harbor.otherShips?.find(o => polygonsOverlap(poly, orientedCorners(o)));
  if (other) return {type:'vessel', ship:other};
  return null;
}

function moveShip(dt) {
  const old = {...ship};
  const throttleInput = (keys.has('ArrowUp') ? 1 : 0) + (keys.has('ArrowDown') ? -1 : 0);
  const rudderInput = (keys.has('ArrowLeft') ? -1 : 0) + (keys.has('ArrowRight') ? 1 : 0);
  ship.throttle = lerp(ship.throttle, throttleInput, 1 - Math.pow(.12, dt));
  ship.rudder = lerp(ship.rudder, rudderInput, 1 - Math.pow(.04, dt));

  const f = forwardVector();
  const side = {x:Math.cos(ship.a), y:Math.sin(ship.a)};
  const fs = ship.vx*f.x + ship.vy*f.y;
  const ls = ship.vx*side.x + ship.vy*side.y;

  // Heavy, damped ship dynamics. Reverse thrust is intentionally weaker.
  const thrust = ship.throttle >= 0 ? 31 : 20;
  ship.vx += f.x * ship.throttle * thrust * dt;
  ship.vy += f.y * ship.throttle * thrust * dt;
  // Stronger lateral drag than longitudinal drag creates a believable hull feel.
  ship.vx -= f.x * fs * .075 * dt + side.x * ls * .62 * dt;
  ship.vy -= f.y * fs * .075 * dt + side.y * ls * .62 * dt;
  const speedCap = 72;
  const sp = worldSpeed();
  if (sp > speedCap) { ship.vx *= speedCap/sp; ship.vy *= speedCap/sp; }

  const steerAuthority = clamp(Math.abs(fs)/22, .08, 1.25);
  const reverseSign = fs < -1 ? -1 : 1;
  ship.omega += ship.rudder * reverseSign * steerAuthority * 0.43 * dt;
  ship.omega *= Math.pow(.72,dt);
  ship.omega = clamp(ship.omega,-.42,.42);
  ship.a = normAngle(ship.a + ship.omega*dt);
  ship.x += ship.vx*dt;
  ship.y += ship.vy*dt;

  const hit = collisionInfo();
  if (hit) {
    Object.assign(ship, old);
    ship.vx = -old.vx * .18;
    ship.vy = -old.vy * .18;
    ship.omega = -old.omega * .25;
    if (collisionCooldown <= 0) {
      const penalty = hit.type === 'vessel' ? 35 : 25;
      score = Math.max(0, score - penalty);
      scoreEl.textContent = score;
      updateChallengeHud(false);
      collisionCooldown = 1.1;
      emitCollision();
      showToast(`<strong>−${penalty}</strong> · ${hit.type === 'vessel' ? 'vessel contact' : 'hull contact'}`, 1050);
      statusText.textContent = hit.type === 'vessel'
        ? 'Collision with moored vessel · keep a wider berth'
        : 'Contact reported · reduce speed near structures';
    }
  }
  if (mode === 'tug' && polygonsOverlap(orientedCorners(ship), orientedCorners(tug))) {
    const oldTug = {...tug};
    separateTug();
    if (collisionInfo(tug)) {
      Object.assign(tug, oldTug);
      Object.assign(ship, old);
      ship.vx *= .95; ship.vy *= .95; ship.omega *= .9;
    }
  }
  emitWake(dt);
}

function dockingMetrics() {
  const b = harbor.berth;
  const corners = orientedCorners();
  const inside = corners.every(p => p.x > b.x+4 && p.x < b.x+b.w-4 && p.y > b.y+4 && p.y < b.y+b.h-4);
  const targetA = harbor.targetAngle;
  // Ship can point either direction along a berth.
  const align = Math.min(angleDiff(ship.a,targetA), angleDiff(ship.a,targetA+Math.PI));
  const speed = worldSpeed();
  const cx = b.x+b.w/2, cy = b.y+b.h/2;
  const longHalf = (b.w > b.h ? b.w : b.h) / 2;
  const centerDistance = Math.hypot(ship.x-cx,ship.y-cy);
  return {inside, align, speed, centerDistance, longHalf};
}

function completeDock(metrics) {
  const centerBonus = Math.round(60 * clamp(1 - metrics.centerDistance / 65, 0, 1));
  const alignBonus = Math.round(60 * clamp(1 - metrics.align / (14*Math.PI/180), 0, 1));
  const gentleBonus = Math.round(60 * clamp(1 - metrics.speed / 9, 0, 1));
  const earned = 100 + centerBonus + alignBonus + gentleBonus;
  score += earned;
  dockings++;
  scoreEl.textContent = score;
  docksEl.textContent = dockings;
  showToast(`<strong>+${earned}</strong> · clean docking`, 1450);
  statusText.textContent = `Berth ${harbor.berthName} secured · new assignment received`;
  for (let i=0;i<46;i++) particles.push({x:ship.x+rand(-70,70),y:ship.y+rand(-80,80),vx:rand(-45,45),vy:rand(-45,45),life:rand(.5,1.25),max:1,type:'success'});
  newHarbor();
  updateChallengeHud(true);
}

function update(dt) {
  if (performance.now() >= deadline) { finish(); return; }
  collisionCooldown -= dt;
  const steps = Math.max(1, Math.ceil(dt * 120));
  for (let i=0;i<steps;i++) {
    const step=dt/steps;
    if (mode==='tug') applyTow(step);
    moveShip(step);
    if (mode==='tug') moveTug(step);
  }
  updateTugHud();
  updateParticles(dt);

  const m = dockingMetrics();
  const angleDeg = m.align*180/Math.PI;
  alignEl.textContent = Math.round(angleDeg).toString();
  if (m.inside && m.speed < 10 && m.align < 14*Math.PI/180) {
    berthHold += dt;
    statusText.textContent = `Berth ${harbor.berthName} · hold position ${Math.round(clamp(berthHold/1.35,0,1)*100)}%`;
    if (berthHold >= 1.35) completeDock(m);
  } else {
    berthHold = 0;
  }

  const speedKnots = worldSpeed() * .19;
  speedEl.textContent = speedKnots.toFixed(1);
  let deg = ((ship.a * 180/Math.PI) % 360 + 360) % 360;
  headingEl.textContent = Math.round(deg).toString().padStart(3,'0');
  seconds = Math.max(0, Math.ceil((deadline-performance.now())/1000));
  timeEl.textContent = seconds;
  if (seconds <= 0) finish();
}

function rr(x,y,w,h,r=8) { ctx.beginPath(); ctx.roundRect(x,y,w,h,r); }

function drawWater(now) {
  const g = ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,'#0a3444');
  g.addColorStop(.48,'#082b3b');
  g.addColorStop(1,'#061e2c');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  ctx.save();
  ctx.globalAlpha = .22;
  ctx.lineWidth = 1;
  for (let y=26;y<H;y+=26) {
    const offset = ((now*.012 + y*.41) % 56) - 28;
    ctx.strokeStyle = y%52===0 ? '#66c4d5' : '#3c879b';
    ctx.beginPath();
    for (let x=-40;x<W+40;x+=28) {
      const yy = y + Math.sin((x+y)*.018 + now*.00055)*3;
      if (x===-40) ctx.moveTo(x+offset,yy); else ctx.lineTo(x+offset,yy);
    }
    ctx.stroke();
  }
  ctx.restore();

  // Soft port-light reflections.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const l of harbor.lights) {
    const a = .035 + .025*Math.sin(now*.002+l.phase);
    const grad = ctx.createLinearGradient(l.x,l.y,l.x,l.y+80);
    grad.addColorStop(0,`rgba(126,225,218,${a})`);
    grad.addColorStop(1,'rgba(126,225,218,0)');
    ctx.fillStyle=grad;
    ctx.fillRect(l.x-2,l.y,4,80);
  }
  ctx.restore();
}

function drawLand() {
  for (const r of harbor.land) {
    ctx.save();
    ctx.shadowColor = '#001019b8';
    ctx.shadowBlur = r.type==='wall' ? 0 : 18;
    ctx.shadowOffsetY = 7;
    const g = ctx.createLinearGradient(r.x,r.y,r.x+r.w,r.y+r.h);
    g.addColorStop(0, r.type==='wall' ? '#1b2830' : '#253139');
    g.addColorStop(1, r.type==='wall' ? '#111c23' : '#18242b');
    ctx.fillStyle=g;
    rr(r.x,r.y,r.w,r.h,r.type==='wall'?0:4);ctx.fill();
    ctx.shadowColor='transparent';
    ctx.strokeStyle='#60717a55';ctx.lineWidth=1;ctx.stroke();
    // Quay edge hazard markers.
    if (r.type!=='wall') {
      ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();
      ctx.strokeStyle='#e1b75055';ctx.lineWidth=5;ctx.setLineDash([16,12]);
      ctx.strokeRect(r.x+2,r.y+2,r.w-4,r.h-4);ctx.setLineDash([]);ctx.restore();
    }
    ctx.restore();
  }
}

function drawContainers() {
  for (const c of harbor.containers) {
    ctx.save();
    ctx.fillStyle='#0007';ctx.fillRect(c.x+3,c.y+4,c.w,c.h);
    ctx.fillStyle=c.c;rr(c.x,c.y,c.w,c.h,2);ctx.fill();
    ctx.strokeStyle='#ffffff16';ctx.lineWidth=1;ctx.stroke();
    ctx.strokeStyle='#00000028';
    for(let x=c.x+6;x<c.x+c.w;x+=7){ctx.beginPath();ctx.moveTo(x,c.y+2);ctx.lineTo(x,c.y+c.h-2);ctx.stroke();}
    ctx.restore();
  }
}

function drawCranes() {
  for (const c of harbor.cranes) {
    ctx.save();ctx.translate(c.x,c.y);ctx.rotate(c.a);
    ctx.strokeStyle='#0b1116aa';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(4,4);ctx.lineTo(4,55);ctx.lineTo(38,86);ctx.stroke();
    ctx.strokeStyle='#d19b46';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,52);ctx.lineTo(34,82);ctx.stroke();
    ctx.strokeStyle='#7b5a2d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,19);ctx.lineTo(18,65);ctx.moveTo(0,36);ctx.lineTo(30,76);ctx.stroke();
    ctx.fillStyle='#f6d579';ctx.shadowColor='#f2be59';ctx.shadowBlur=12;ctx.beginPath();ctx.arc(34,82,2.7,0,Math.PI*2);ctx.fill();ctx.restore();
  }
}

function drawBerth(now) {
  const b = harbor.berth;
  const pulse = .55 + .25*Math.sin(now*.004);
  ctx.save();
  ctx.fillStyle=`rgba(67,224,177,${.08+pulse*.03})`;
  ctx.strokeStyle=`rgba(104,244,205,${.6+pulse*.25})`;
  ctx.lineWidth=3;
  ctx.setLineDash([12,9]);
  rr(b.x,b.y,b.w,b.h,8);ctx.fill();ctx.stroke();ctx.setLineDash([]);

  // Berth centerline and mooring marks.
  ctx.strokeStyle='#8bffe45d';ctx.lineWidth=1.5;ctx.setLineDash([8,12]);ctx.beginPath();
  if (b.w>b.h) { ctx.moveTo(b.x+14,b.y+b.h/2);ctx.lineTo(b.x+b.w-14,b.y+b.h/2); }
  else { ctx.moveTo(b.x+b.w/2,b.y+14);ctx.lineTo(b.x+b.w/2,b.y+b.h-14); }
  ctx.stroke();ctx.setLineDash([]);

  ctx.fillStyle='#bfffee';ctx.font='900 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.shadowColor='#65f3cd';ctx.shadowBlur=12;
  ctx.fillText(harbor.berthName,b.x+b.w/2,b.y+b.h/2);
  ctx.restore();
}

function drawBuoys(now) {
  for (const b of harbor.buoys) {
    ctx.save();ctx.translate(b.x,b.y);
    ctx.fillStyle='#020a0e88';ctx.beginPath();ctx.ellipse(4,6,8,4,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=b.c;ctx.shadowColor=b.c;ctx.shadowBlur=10+5*Math.sin(now*.004);ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#d5f4f1';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,-3);ctx.lineTo(0,-10);ctx.stroke();ctx.restore();
  }
}

function drawWake() {
  ctx.save();
  for (const p of wake) {
    ctx.globalAlpha = p.life*.22;
    ctx.strokeStyle='#d7fcff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();
}

function drawShip() {
  const m = dockingMetrics();
  const f = clamp(berthHold/1.35,0,1);
  ctx.save();ctx.translate(ship.x,ship.y);ctx.rotate(ship.a);

  // Shadow + wake slit.
  ctx.save();ctx.translate(6,8);ctx.fillStyle='#00101875';ctx.shadowColor='#000';ctx.shadowBlur=16;rr(-ship.w/2,-ship.h/2,ship.w,ship.h,13);ctx.fill();ctx.restore();

  // Hull.
  const hg=ctx.createLinearGradient(-ship.w/2,0,ship.w/2,0);hg.addColorStop(0,'#aebbc1');hg.addColorStop(.45,'#eef4f4');hg.addColorStop(1,'#87999f');
  ctx.fillStyle=hg;ctx.beginPath();
  ctx.moveTo(0,-ship.h/2-7);ctx.lineTo(ship.w/2-2,-ship.h/2+20);ctx.lineTo(ship.w/2,ship.h/2-9);ctx.quadraticCurveTo(0,ship.h/2+8,-ship.w/2,ship.h/2-9);ctx.lineTo(-ship.w/2+2,-ship.h/2+20);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#dbe5e6aa';ctx.lineWidth=1;ctx.stroke();

  // Deck.
  ctx.fillStyle='#1f5665';rr(-ship.w/2+4,-ship.h/2+24,ship.w-8,ship.h-40,5);ctx.fill();
  ctx.fillStyle='#123d4c';rr(-ship.w/2+7,ship.h/2-31,ship.w-14,21,4);ctx.fill();

  // Container stacks.
  const cols=['#c76249','#d08c3e','#4d86a4','#4d8c70','#8e7164'];
  let n=0;
  for (let yy=-ship.h/2+34; yy<ship.h/2-39; yy+=16) {
    for (let xx=-ship.w/2+7; xx<ship.w/2-8; xx+=13) {
      ctx.fillStyle=cols[(n++ + harborIndex)%cols.length];rr(xx,yy,11,13,1.5);ctx.fill();ctx.strokeStyle='#ffffff18';ctx.stroke();
    }
  }

  // Bridge.
  ctx.fillStyle='#e8f0ed';rr(-ship.w/2+4,ship.h/2-38,ship.w-8,13,3);ctx.fill();
  ctx.fillStyle='#88c6d2';ctx.fillRect(-ship.w/2+8,ship.h/2-34,ship.w-16,4);
  // Navigation lights.
  ctx.fillStyle='#68f2b3';ctx.shadowColor='#68f2b3';ctx.shadowBlur=11;ctx.beginPath();ctx.arc(-ship.w/2+2,-13,2.3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ff645f';ctx.shadowColor='#ff645f';ctx.beginPath();ctx.arc(ship.w/2-2,-13,2.3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#fff3ba';ctx.shadowColor='#fff0a0';ctx.beginPath();ctx.arc(0,-ship.h/2-3,2.3,0,Math.PI*2);ctx.fill();
  ctx.restore();

  if (f>0) {
    ctx.save();ctx.strokeStyle='#76f2ca';ctx.lineWidth=5;ctx.shadowColor='#76f2ca';ctx.shadowBlur=14;ctx.beginPath();ctx.arc(ship.x,ship.y,96,-Math.PI/2,-Math.PI/2+Math.PI*2*f);ctx.stroke();ctx.restore();
  }

  if (m.inside && m.align < 14*Math.PI/180 && m.speed < 10) {
    ctx.save();ctx.fillStyle='#baffec';ctx.font='900 10px system-ui';ctx.textAlign='center';ctx.fillText('HOLD POSITION',ship.x,ship.y-102);ctx.restore();
  }
}


function drawMooredShip(v, now) {
  const bob = Math.sin(now*.0016 + v.phase) * .7;
  const beam = v.w, len = v.h;
  ctx.save();
  ctx.translate(v.x, v.y + bob);
  ctx.rotate(v.a);

  ctx.save();
  ctx.translate(4,6);
  ctx.fillStyle='#00101870';
  ctx.shadowColor='#000';
  ctx.shadowBlur=11;
  rr(-beam/2,-len/2,beam,len,Math.max(4,beam*.28));
  ctx.fill();
  ctx.restore();

  const hull = ctx.createLinearGradient(-beam/2,0,beam/2,0);
  hull.addColorStop(0,'#84959a');
  hull.addColorStop(.48,'#d6dfde');
  hull.addColorStop(1,'#60737a');
  ctx.fillStyle=hull;
  ctx.beginPath();
  ctx.moveTo(0,-len/2-4);
  ctx.lineTo(beam/2-1,-len/2+Math.min(15,len*.15));
  ctx.lineTo(beam/2,len/2-6);
  ctx.quadraticCurveTo(0,len/2+4,-beam/2,len/2-6);
  ctx.lineTo(-beam/2+1,-len/2+Math.min(15,len*.15));
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle=v.tone;
  rr(-beam/2+3,-len/2+18,beam-6,len-30,Math.max(2,beam*.12));
  ctx.fill();

  if (v.kind === 'cargo') {
    const cols=['#9d5f4d','#8d784d','#4e7383','#61796e'];
    let i=0;
    for(let yy=-len/2+27; yy<len/2-34; yy+=14) {
      for(let xx=-beam/2+5; xx<beam/2-6; xx+=11) {
        ctx.fillStyle=cols[(i++ + harborIndex)%cols.length];
        rr(xx,yy,9,11,1);ctx.fill();
      }
    }
  } else if (v.kind === 'ferry') {
    ctx.fillStyle='#dce5e2';
    rr(-beam/2+4,-len/2+25,beam-8,Math.max(24,len*.48),3);ctx.fill();
    ctx.fillStyle='#79aab5';
    for (let yy=-len/2+31; yy<-len/2+25+Math.max(24,len*.48)-6; yy+=10) {
      ctx.fillRect(-beam/2+7,yy,beam-14,2);
    }
  } else if (v.kind === 'coaster') {
    ctx.fillStyle='#b7c7c7';
    rr(-beam/2+4,len/2-30,beam-8,18,3);ctx.fill();
    ctx.fillStyle='#263e48';
    rr(-beam/2+5,-len/2+28,beam-10,Math.max(22,len*.42),2);ctx.fill();
  } else {
    ctx.fillStyle=v.kind === 'pilot' ? '#d6a84b' : '#b24f45';
    rr(-beam/2+3,-len/2+18,beam-6,len*.42,3);ctx.fill();
    ctx.fillStyle='#e7eeee';
    rr(-beam/2+4,len*.02,beam-8,len*.27,3);ctx.fill();
    ctx.fillStyle='#4a7781';
    ctx.fillRect(-beam/2+6,len*.08,beam-12,3);
  }

  ctx.fillStyle='#f1f5ec';
  rr(-beam/2+4,len/2-27,beam-8,10,2);ctx.fill();
  ctx.fillStyle='#78a9b5';
  ctx.fillRect(-beam/2+6,len/2-24,beam-12,3);

  ctx.fillStyle='#65efb5';ctx.shadowColor='#65efb5';ctx.shadowBlur=7;ctx.beginPath();ctx.arc(-beam/2+1,-len*.08,1.6,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ff6a64';ctx.shadowColor='#ff6a64';ctx.beginPath();ctx.arc(beam/2-1,-len*.08,1.6,0,Math.PI*2);ctx.fill();
  ctx.restore();

  const sideVec = {x:Math.cos(v.a), y:Math.sin(v.a)};
  const sideSign = v.dockSide === 'left' || v.dockSide === 'top' ? -1 : 1;
  const lineStart1 = {x:v.x + sideVec.x*sideSign*v.w*.46, y:v.y+bob + sideVec.y*sideSign*v.w*.46};
  const forward = {x:Math.sin(v.a), y:-Math.cos(v.a)};
  const lineStart2 = {x:lineStart1.x + forward.x*v.h*.28, y:lineStart1.y + forward.y*v.h*.28};
  const lineStart3 = {x:lineStart1.x - forward.x*v.h*.28, y:lineStart1.y - forward.y*v.h*.28};
  ctx.save();
  ctx.strokeStyle='#c8b99255';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(lineStart2.x,lineStart2.y);ctx.lineTo(v.moor.x,v.moor.y);ctx.stroke();
  ctx.beginPath();ctx.moveTo(lineStart3.x,lineStart3.y);ctx.lineTo(v.moor.x,v.moor.y);ctx.stroke();
  ctx.restore();
}

function drawOtherShips(now) {
  for (const v of harbor.otherShips || []) drawMooredShip(v, now);
}

function drawParticles() {
  ctx.save();ctx.globalCompositeOperation='screen';
  for (const p of particles) {
    const a=clamp(p.life/p.max,0,1);
    ctx.globalAlpha=a;
    if (p.type==='spark') { ctx.fillStyle='#ffcb6d';ctx.shadowColor='#ff9c42';ctx.shadowBlur=8;ctx.fillRect(p.x,p.y,2,2); }
    else if (p.type==='success') { ctx.fillStyle='#65efd1';ctx.shadowColor='#65efd1';ctx.shadowBlur=7;ctx.beginPath();ctx.arc(p.x,p.y,2.2,0,Math.PI*2);ctx.fill(); }
    else { ctx.strokeStyle='#dffbff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,4+(1-a)*9,0,Math.PI*2);ctx.stroke(); }
  }
  ctx.restore();
}

function draw(now) {
  if (!harbor) return;
  drawWater(now);
  drawWake();
  drawBerth(now);
  drawLand();
  drawContainers();
  drawOtherShips(now);
  drawBuoys(now);
  drawShip();
  drawTug();
  // Gantry arms extend over the water, so cranes must render above vessels.
  drawCranes();
  drawParticles();

  // Harbor grid labels for a subtle chart-like feel.
  ctx.save();ctx.fillStyle='#7bb6c723';ctx.font='800 9px ui-monospace, monospace';ctx.textAlign='left';
  for(let x=90;x<W;x+=180) ctx.fillText(`E ${String(x*7).padStart(4,'0')}`,x,31);
  for(let y=110;y<H;y+=140) ctx.fillText(`N ${String((H-y)*9).padStart(4,'0')}`,25,y);
  ctx.restore();
}

function loop(now) {
  if (!running) return;
  const dt = Math.min(.033, Math.max(.001,(now-last)/1000));
  last = now;
  update(dt);
  draw(now);
  if (running) frameId = requestAnimationFrame(loop);
}

addEventListener('keydown', e => {
  if (['INPUT','SELECT','BUTTON'].includes(e.target?.tagName)) return;
  const key=e.key.length===1?e.key.toLowerCase():e.key;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(key)) e.preventDefault();
  if (running) keys.add(key);
  if (key===' ' && !e.repeat) toggleTow();
  if (key==='Escape' && !e.repeat) { keys.clear(); openMenu(); }
  if (key==='r' && !e.repeat) start();
});
addEventListener('keyup', e => keys.delete(e.key.length===1?e.key.toLowerCase():e.key));
addEventListener('blur', () => keys.clear());
document.querySelectorAll('input[name="mode"]').forEach(el => el.addEventListener('change', selectMode));
startBtn.addEventListener('click', start);
menuBtn.addEventListener('click', openMenu);
shareBtn.addEventListener('click', shareScoreOnFacebook);

document.querySelector(`input[value="${mode}"]`).checked=true;
renderRecords();
harbor = makeHarbor();
resetShipForHarbor();
selectMode();
updateChallengeHud(false);
if (challengeScore !== null) {
  titleEl.innerHTML = `Beat ${challengeScore} points.<br><span>Challenge accepted?</span>`;
  copyEl.textContent = 'A friend sent you this score to beat. You still get a fresh procedural harbor every time — only the target travels with the link.';
  startBtn.textContent = 'Accept challenge';
  statusText.textContent = `Challenge received · beat ${challengeScore} points`;
}
draw(performance.now());

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
  Object.assign(tug,{a:ship.a,vx:0,vy:0,omega:0,throttle:0,rudder:0,jet:0});
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
  ship.omega=clamp(ship.omega+(rx*ny-ry*nx)*force/11000*dt,-.42,.42);
  tug.vx-=nx*force*dt; tug.vy-=ny*force*dt;
}

function moveTug(dt) {
  const old={...tug};
  const throttle=(keys.has('w')?1:0)-(keys.has('s')?1:0);
  const rudder=(keys.has('d')?1:0)-(keys.has('a')?1:0);
  tug.jet=(keys.has('e')?1:0)-(keys.has('q')?1:0);
  tug.throttle=lerp(tug.throttle,throttle,1-Math.exp(-5*dt));
  tug.rudder=lerp(tug.rudder,rudder,1-Math.exp(-7*dt));
  const fx=Math.sin(tug.a), fy=-Math.cos(tug.a), sx=Math.cos(tug.a), sy=Math.sin(tug.a);
  const fs=tug.vx*fx+tug.vy*fy, ls=tug.vx*sx+tug.vy*sy;
  tug.vx+=(fx*(tug.throttle*95-fs*.85)+sx*(tug.jet*85-ls*1.8))*dt;
  tug.vy+=(fy*(tug.throttle*95-fs*.85)+sy*(tug.jet*85-ls*1.8))*dt;
  tug.omega+=tug.rudder*(fs < -3 ? -1 : 1)*clamp(Math.abs(fs)/22,.35,1)*2.6*dt;
  tug.omega*=Math.exp(-2.5*dt);
  tug.a=normAngle(tug.a+tug.omega*dt);
  const speed=Math.hypot(tug.vx,tug.vy);
  if (speed>110) { tug.vx*=110/speed; tug.vy*=110/speed; }
  tug.x+=tug.vx*dt; tug.y+=tug.vy*dt;
  const hit=collisionInfo(tug);
  if (hit) {
    Object.assign(tug,old);
    tug.vx=ship.vx*.3-old.vx*.15; tug.vy=ship.vy*.3-old.vy*.15; tug.omega=-old.omega*.2;
    if (hit && collisionCooldown<=0) {
      const penalty=hit.type==='vessel'?35:25;
      score=Math.max(0,score-penalty); scoreEl.textContent=score;
      collisionCooldown=1.1; updateChallengeHud(false);
      showToast(`<strong>−${penalty}</strong> · tug ${hit.type==='vessel'?'vessel':'quay'} contact`);
    }
  }
  if (polygonsOverlap(orientedCorners(tug),orientedCorners(ship))) {
    separateTug();
    if (collisionInfo(tug)) {
      tug.x=old.x; tug.y=old.y; tug.a=old.a;
    }
  }
  if ((speed>8 || tug.jet) && Math.random()<dt*24) {
    wake.push({x:tug.x-fx*25-sx*tug.jet*12,y:tug.y-fy*25-sy*tug.jet*12,r:2,life:.8,max:.7});
    if (wake.length>180) wake.shift();
  }
}

function drawTug() {
  if (mode!=='tug') return;
  const anchor=tow ? hullPoint(tow.local) : nearestTowPoint().point;
  const ready=!tow && canAttach();
  ctx.save();
  if (tow || ready) {
    ctx.strokeStyle=tow ? (tow.tension>3?'#ffe4a0':'#baa774') : '#85efc680';
    ctx.lineWidth=tow?2.5:1; if (!tow) ctx.setLineDash([4,5]);
    ctx.beginPath();ctx.moveTo(anchor.x,anchor.y);
    const slack=tow ? clamp(tow.length-dist(tug,anchor),0,25) : 0;
    ctx.quadraticCurveTo((anchor.x+tug.x)/2,(anchor.y+tug.y)/2+slack,tug.x,tug.y);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#ffe4a0';ctx.beginPath();ctx.arc(anchor.x,anchor.y,3,0,Math.PI*2);ctx.fill();
  }
  ctx.translate(tug.x,tug.y);ctx.rotate(tug.a);
  ctx.shadowColor='#0008';ctx.shadowBlur=10;ctx.shadowOffsetY=4;
  ctx.fillStyle='#101f28';rr(-15,-27,30,56,12);ctx.fill();
  ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  ctx.fillStyle='#efb956';rr(-11,-25,22,51,10);ctx.fill();
  ctx.strokeStyle='#ffe4a4';ctx.lineWidth=1;ctx.stroke();
  ctx.fillStyle='#87572e';rr(-8,6,16,15,3);ctx.fill();
  ctx.fillStyle='#f1f3df';rr(-9,-15,18,23,4);ctx.fill();
  ctx.fillStyle='#254f62';rr(-7,-12,14,7,2);ctx.fill();
  ctx.fillStyle='#637981';ctx.fillRect(-1,-4,2,9);
  for (const side of [-1,1]) {
    ctx.fillStyle='#14212a';for(const y of [-13,4,17]) {ctx.beginPath();ctx.ellipse(side*12,y,3,5,0,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle=side<0?'#63efad':'#ff7474';ctx.beginPath();ctx.arc(side*10,-17,1.8,0,Math.PI*2);ctx.fill();
  }
  if (tug.jet && running) {
    ctx.strokeStyle='#c1f7fa99';ctx.lineWidth=2;
    for(const y of [-16,15]) {ctx.beginPath();ctx.moveTo(-tug.jet*14,y);ctx.lineTo(-tug.jet*25,y+3);ctx.stroke();}
  }
  ctx.restore();ctx.save();ctx.textAlign='center';ctx.font='800 9px system-ui';ctx.fillStyle='#ffe4a4';
  ctx.fillText('TUG 01',tug.x,tug.y+43);ctx.restore();
}

function selectMode() {
  const selected=document.querySelector('input[name="mode"]:checked').value;
  document.querySelectorAll('#mode-help [data-mode]').forEach(el => el.hidden=el.dataset.mode!==selected);
  document.querySelectorAll('.tug-controls').forEach(el => el.hidden=selected!=='tug');
  if (!running) { mode=selected; resetTug(); draw(performance.now()); }
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
    ship.omega=clamp(ship.omega-arm*impulse/11000,-.42,.42);
    tug.vx+=normal.x*impulse; tug.vy+=normal.y*impulse;
  }
  tug.x+=normal.x*(depth+.01); tug.y+=normal.y*(depth+.01);
}
