const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
module.exports = function loadGame() {
  const elements = new Map();
  const element = () => {
    const classes = new Set();
    return { textContent: '', value: 'solo', hidden: false, style: {}, parentElement: {style:{}}, dataset: {},
      classList: { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n), toggle(n,on) { if (on ?? !classes.has(n)) classes.add(n); else classes.delete(n); } },
      width: 1280, height: 720, addEventListener() {}, replaceChildren() {}, append() {}, focus() {}, blur() {}, setAttribute() {}, querySelectorAll() { return []; } };
  };
  const document = { cookie: '', activeElement: null, addEventListener() {}, querySelector(selector) {
    if (selector.includes(':checked')) selector = 'selected';
    if (!elements.has(selector)) elements.set(selector,element());
    return elements.get(selector);
  }, querySelectorAll() { return []; }, createElement: element, createTextNode: s => s };
  const sandbox = { document, elements, location: { search: '', protocol: 'http:', href: 'http://localhost/' }, performance: { now: () => 0 },
    URL, URLSearchParams, Math: Object.create(Math), Date, console, Uint16Array, Uint8Array, DataView, btoa, atob,
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, assert,
    DockPhysics: require('../marine-physics.js'), DockScene: class { configure() {} resize() {} draw() {} }, ResizeObserver: class { observe() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../game.js'),'utf8'),sandbox);
  return sandbox;
};
