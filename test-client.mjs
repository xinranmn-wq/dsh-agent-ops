// Integration smoke test for the built client bundle: loads client.js in a stub
// browser scope, mounts the overlay component tree (stub hooks), and drives the real
// scene engine through frames/model/resize/dispose.
//
// This is NOT visual verification — it only proves the two modules integrate without
// throwing outside a browser. Not shipped with the bundle.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

// ---------- stub React ------------------------------------------------------
function makeReact() {
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const merged = Object.assign({}, props || {});
      if (children.length) merged.children = children.length === 1 ? children[0] : children;
      return { type, props: merged, $$element: true };
    },
    useState(init) {
      const value = typeof init === 'function' ? init() : init;
      return [value, () => {}];
    },
    useRef(init) {
      return { current: init };
    },
    useEffect() {},
    useLayoutEffect() {},
    useMemo(fn) {
      return fn();
    },
    useCallback(fn) {
      return fn;
    },
    useReducer(reducer, init) {
      return [typeof init === 'function' ? init() : init, () => {}];
    },
    useSyncExternalStore(getSnapshot) {
      return getSnapshot();
    },
    useId() {
      return ':r0:';
    },
    memo(c) {
      return c;
    },
    forwardRef(c) {
      return c;
    },
    Children: { toArray: (x) => (Array.isArray(x) ? x : x == null ? [] : [x]) },
  };
  return React;
}

// ---------- stub DOM -------------------------------------------------------
class Path2DStub {
  constructor() {}
  moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} arc() {} arcTo() {}
  ellipse() {} rect() {} closePath() {} addPath() {} fill() {} stroke() {}
}

function makeCtx2D(canvas) {
  const gradient = () => ({ addColorStop() {} });
  const base = {
    canvas,
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '10px monospace',
    textAlign: 'left', textBaseline: 'alphabetic', shadowBlur: 0, shadowColor: '#000',
    filter: 'none', imageSmoothingEnabled: true, globalAlpha2: 1,
    measureText: (t) => ({ width: String(t).length * 5 }),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createConicGradient: gradient,
    createPattern: () => ({}),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    putImageData() {},
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    drawImage() {},
    setTransform() {}, resetTransform() {}, save() {}, restore() {}, translate() {}, rotate() {},
    scale() {}, transform() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, arcTo() {}, ellipse() {}, rect() {},
    fill() {}, stroke() {}, clip() {}, fillRect() {}, strokeRect() {}, clearRect() {},
    fillText() {}, strokeText() {}, setLineDash() {}, getLineDash: () => [], roundRect() {},
  };
  return new Proxy(base, {
    get(target, key) {
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}

function makeCanvas(width = 1600, height = 900) {
  const canvas = {
    width, height, clientWidth: width, clientHeight: height,
    style: {}, className: '', id: '',
    parentElement: null,
    listeners: {},
    getContext: () => ctx2d,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
    addEventListener(type, fn) {
      (canvas.listeners[type] = canvas.listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = canvas.listeners[type];
      if (list) canvas.listeners[type] = list.filter((x) => x !== fn);
    },
    setPointerCapture() {}, releasePointerCapture() {},
    setAttribute() {}, appendChild() {},
  };
  const ctx2d = makeCtx2D(canvas);
  return canvas;
}

function makeDocument() {
  return {
    hidden: false,
    visibilityState: 'visible',
    documentElement: { style: {}, scrollWidth: 1600, scrollHeight: 900 },
    body: { appendChild() {}, style: {}, querySelector: () => null, addEventListener() {}, removeEventListener() {} },
    createElement: (tag) => (tag === 'canvas' ? makeCanvas(300, 150) : { style: {}, appendChild() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {} }),
    createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

const React = makeReact();

function boot() {
  const rafQueue = [];
  const win = {
    devicePixelRatio: 1.5,
    innerWidth: 1600, innerHeight: 900,
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
    cancelAnimationFrame() {},
    setTimeout: (fn) => { return 0; },
    clearTimeout() {}, clearInterval() {}, setInterval: () => 0,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    addEventListener() {}, removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    location: { href: 'http://127.0.0.1:49845/', origin: 'http://127.0.0.1:49845' },
  };
  win.window = win;
  win.self = win;
  const doc = makeDocument();
  const shadowRoot = { appendChild() {}, style: {} };
  win.document = doc;

  const requireFn = (id) => {
    if (id === 'react') return React;
    throw new Error('unexpected require: ' + id);
  };
  let captured = null;
  win.__ModuleLoader__ = {
    load(def) {
      captured = def;
    },
  };
  const g = {
    window: win,
    self: win,
    document: doc,
    navigator: { userAgent: 'node', platform: 'node' },
    location: win.location,
    devicePixelRatio: 1.5,
    requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame,
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout,
    setInterval: win.setInterval,
    clearInterval: win.clearInterval,
    matchMedia: win.matchMedia,
    Path2D: Path2DStub,
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    performance: { now: () => Date.now() },
    console,
    fetch: () => Promise.reject(new Error('offline test')),
    AbortController: class { constructor() { this.signal = { aborted: false, addEventListener() {} }; } abort() { this.signal.aborted = true; } },
    getComputedStyle: win.getComputedStyle,
    HTMLCanvasElement: function () {},
    Image: function () {},
    SVGSVGElement: function () {},
    React,
    h: React.createElement,
  };
  vm.createContext(g);
  const code = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
  vm.runInContext(code, g, { filename: 'client.js' });
  assert.ok(captured, 'module loader received exactly one artifact');
  assert.equal(captured.id, '@local/dsh-agent-ops');
  const mod = captured.factory(requireFn);
  assert.equal(typeof mod.apply, 'function', 'factory returns apply');
  assert.ok(Array.isArray(mod.inject), 'factory returns inject array');
  return { win, g, doc, mod, rafQueue, React };
}

// ---------- render the overlay tree (stub hooks) ----------------------------
function walk(node, depth, out, seen) {
  if (node == null || typeof node === 'boolean') return;
  if (typeof node === 'string' || typeof node === 'number') {
    if (depth > 0) out.texts.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, depth, out, seen);
    return;
  }
  if (!node.$$element) return;
  const { type, props } = node;
  if (type === React.Fragment) {
    walk(props.children, depth, out, seen);
    return;
  }
  if (typeof type === 'function') {
    out.functions.push(type.name || '(anonymous)');
    const rendered = type(props || {});
    walk(rendered, depth + 1, out, seen);
    return;
  }
  out.tags.push(String(type));
  if (props && props.children != null) walk(props.children, depth, out, seen);
}

function openTextsLabels(texts) {
  return texts
    .filter((t) => typeof t === 'string' && t.length > 0 && t.length < 90 && !t.startsWith('.ao-') && !t.includes('{') && !t.includes(';'))
    .slice(0, 220);
}

const { win, g, mod, rafQueue } = boot();
const registrations = [];
const fakeCtx = {
  slots: {},
  inject(deps, cb) {
    cb(fakeCtx);
  },
};
fakeCtx.slots = {
  inject(name, cb) {
    if (name !== 'shell.overlay') throw new Error('unexpected slot ' + name);
    cb();
  },
  register(options, component) {
    registrations.push({ options, component });
    return () => {};
  },
};
mod.apply(fakeCtx);

assert.equal(registrations.length, 1, 'one shell.overlay registration');
const reg = registrations[0];
assert.equal(reg.options.id, 'dsh-agent-ops');
assert.equal(reg.options.name, 'shell.overlay');
assert.equal(typeof reg.options.label, 'string');

// Render closed + open states through the real (stub-hooked) component tree.
win.__agentOpsAutoOpened = true; // simulate a page where the overlay already opened once
const outClosed = { tags: [], texts: [], functions: [] };
walk(reg.component({}), 0, outClosed, new Set());
assert.ok(outClosed.tags.length > 0, 'closed state renders elements');
const closedText = outClosed.texts.join(' ');
assert.ok(/AGENT OPS/i.test(closedText), 'launcher pill present in closed state');
assert.ok(outClosed.tags.length < 120, 'closed state is just the launcher');

win.__agentOpsAutoOpened = undefined;
const outOpen = { tags: [], texts: [], functions: [] };
walk(reg.component({}), 0, outOpen, new Set());
const openText = outOpen.texts.join(' ');
const openUpper = openText.toUpperCase();
if (process.env.AO_DEBUG_TEXTS) {
  const labels = openTextsLabels(outOpen.texts);
  console.log('OPEN LABELS:', labels.join(' | '));
}
for (const want of ['AGENT OPS', 'DISPATCH CENTER', 'GLOBAL STATUS', 'TASK FEED', 'MEMORY INSPECTOR', 'DISPATCH BUFFER', 'AGENT REGISTRATION', 'SIMULATION']) {
  assert.ok(openUpper.includes(want), `open HUD contains "${want}"`);
}

// ---------- drive the real scene engine ------------------------------------
const canvas = makeCanvas(1600, 900);
const parent = { clientWidth: 1600, clientHeight: 900, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }) };
canvas.parentElement = parent;
let scene = null;
const hits = { hover: 0, select: 0, lastHover: null, lastSelect: null };
try {
  const sceneSource = readFileSync(new URL('./src/scene.js', import.meta.url), 'utf8');
  vm.runInContext(sceneSource, g, { filename: 'src/scene.js' });
  scene = g.createScene(canvas, {
    reducedMotion: false,
    onHover(hit, x, y) {
      hits.hover += 1;
      hits.lastHover = hit ? Object.assign({ x, y }, hit) : null;
    },
    onSelect(hit) {
      hits.select += 1;
      hits.lastSelect = hit || null;
    },
  });
} catch (error) {
  console.error('createScene threw:', error);
  process.exit(1);
}
assert.equal(typeof scene.setModel, 'function');
assert.equal(typeof scene.resize, 'function');
assert.equal(typeof scene.setRunning, 'function');
assert.equal(typeof scene.setActive, 'function', 'scene exposes setActive for two-way selection');
assert.equal(typeof scene.dispose, 'function');

const model = {
  mode: 'LIVE',
  nodes: [
    { id: 'a:1', label: 'LEAD', sublabel: 'RUNNING', kind: 'agent', weight: 1 },
    { id: 't:1', label: 'READ', sublabel: 'src/hud.js', kind: 'tool', weight: 0.8 },
    { id: 'f:1', label: 'HUD.JS', sublabel: 'r03·w01', kind: 'file', weight: 0.6 },
    { id: 'm:1', label: 'MODEL', sublabel: 'REPLY', kind: 'msg', weight: 0.5 },
  ],
  links: [
    { from: 'a:1', to: 't:1', weight: 0.9 },
    { from: 't:1', to: 'f:1', weight: 0.6 },
    { from: 'a:1', to: 'm:1', weight: 0.5 },
  ],
  cards: Array.from({ length: 14 }, (_, i) => ({
    id: 'c' + i,
    title: 'TOOL' + i,
    line1: 'target-' + i,
    line2: 'T01·S0' + (i % 9),
    status: i % 5 === 0 ? 'error' : i % 3 === 0 ? 'run' : 'ok',
    tone: (i * 37) % 100 / 100,
  })),
  pulses: [{ id: 'LIVE:41', at: Date.now() }],
  intensity: 0.7,
  clock: '16:03:41',
  memories: Array.from({ length: 24 }, (_, i) => ({
    id: 'mem:' + i,
    kind: ['tool', 'file', 'thought', 'answer', 'agent'][i % 5],
    label: 'MEMORY ' + i,
    detail: 'src/hud.js · event ' + i,
    weight: 0.3 + ((i * 13) % 70) / 100,
    t: Date.now() - i * 4000,
  })),
  activeId: 'mem:3',
};
scene.setModel(model);
scene.resize();

// Run ~40 frames from the captured rAF queue (the scene re-queues itself).
let frames = 0;
for (let i = 0; i < 40 && rafQueue.length; i += 1) {
  const cb = rafQueue.shift();
  cb(1000 + i * 16.7);
  frames += 1;
}
assert.ok(frames >= 30, `scene ran frames (${frames})`);

// ---------- pointer interaction (canvas owns the listeners) ----------------
const pointerTypes = Object.keys(canvas.listeners);
assert.ok(pointerTypes.includes('pointermove'), 'canvas listens to pointermove');
assert.ok(pointerTypes.includes('pointerdown'), 'canvas listens to pointerdown');
assert.ok(pointerTypes.includes('wheel'), 'canvas listens to wheel');

function firePointer(type, x, y, extra) {
  const list = canvas.listeners[type] || [];
  const event = Object.assign(
    {
      clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 0, deltaY: 0, deltaMode: 0,
      preventDefault() {}, stopPropagation() {}, target: canvas, currentTarget: canvas,
    },
    extra || {},
  );
  for (const fn of list) fn(event);
}

// Sweep the scene; the auto-rotating memory cloud is in the centre, so some hits are expected.
for (let gy = 0; gy < 10; gy += 1) {
  for (let gx = 0; gx < 16; gx += 1) {
    firePointer('pointermove', 80 + gx * 95, 120 + gy * 70);
    const cb = rafQueue.shift();
    if (cb) cb(3000 + gy * 100 + gx);
  }
}
assert.ok(hits.hover > 0, `hover hit something while sweeping (${hits.hover} callbacks)`);

// Click the last hovered target, then release.
if (hits.lastHover) {
  firePointer('pointerdown', hits.lastHover.x, hits.lastHover.y, { button: 0, buttons: 1 });
  firePointer('pointerup', hits.lastHover.x, hits.lastHover.y, { button: 0, buttons: 0 });
  assert.ok(hits.select > 0, 'clicking a hovered node selects it');
  assert.ok(hits.lastSelect && hits.lastSelect.type, 'select hit carries a type');
}

// Drag rotates (pointerdown + moves + up must not throw), wheel zooms.
firePointer('pointerdown', 800, 400, { button: 0, buttons: 1 });
for (let i = 0; i < 6; i += 1) firePointer('pointermove', 800 + i * 12, 400 + i * 4, { buttons: 1 });
firePointer('pointerup', 872, 424, { button: 0, buttons: 0 });
firePointer('wheel', 800, 400, { deltaY: -120 });
const cbAfterInput = rafQueue.shift();
if (cbAfterInput) cbAfterInput(4000);

// HUD pinning flows into the scene.
scene.setActive('mem:5');
scene.setModel(null);
scene.setModel(model);

// Hostile models must not throw.
for (const bad of [null, {}, { nodes: null, links: 'x', cards: 7 }, { nodes: Array(60).fill({ id: 'x', kind: '??' }), links: Array(160).fill({ from: 'a', to: 'b' }) }]) {
  scene.setModel(bad);
  const cb = rafQueue.shift();
  if (cb) cb(2000);
}
scene.setRunning(false);
scene.resize();
scene.dispose();
while (rafQueue.length) {
  const cb = rafQueue.shift();
  cb(3000);
}
const afterDispose = rafQueue.length;
assert.equal(afterDispose, 0, 'dispose stops the render loop');
assert.equal((canvas.listeners.pointermove || []).length, 0, 'dispose removes pointer listeners');
assert.equal((canvas.listeners.wheel || []).length, 0, 'dispose removes wheel listener');

console.log('client integration smoke OK');
console.log(
  JSON.stringify(
    {
      registration: { id: reg.options.id, order: reg.options.order, label: reg.options.label },
      closedElements: outClosed.tags.length,
      openElements: outOpen.tags.length,
      openFunctions: outOpen.functions.length,
      frames,
      pendingAfterDispose: afterDispose,
    },
    null,
    2,
  ),
);







