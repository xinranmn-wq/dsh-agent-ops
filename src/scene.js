// ==== scene: Agent Ops / Dispatch Center — canvas control-ring engine ====
// Self-contained Canvas2D scene fragment (no imports, no assets, no webfonts).
// Public API: function createScene(canvas, opts) ->
//   { resize, setModel, setActive, setRunning, dispose }
//
// V4.2: a light card corona around the dial with the memory cloud as the hero.
//   · N=42 small radial "paddle" cards ride one ringPhase (idle ≈0.27 rad/s,
//     ~23 s per turn).  Card long axis = outward radial normal, so text runs
//     away from the ring centre; depth = cos(θ − RING_NEAR) drives perspective
//     scale/alpha.  Real model cards stay at deck 1.0, synthetic filler cards
//     fade to 0.50–0.65 and the whole corona has a low alpha floor, so the ring
//     reads as negative space instead of a wall of boxes.
//   · The pseudo-3D memory cloud is the hero: bigger footprint (0.152·min(W,H)),
//     stronger node glow/edges/hot cores, still clear of the card ring and the
//     calm rails.  Auto-rotate, hover labels, click pin, drag rotate, wheel zoom.
//   · Every card is a particle nozzle: a particle enters at the LEFT midpoint
//     (inner end), crosses the box (bright crossing dot), exits at the RIGHT
//     midpoint (outer end) into a ±19.5° divergence fan of several fast bright
//     particles, which then feed the long additive streak fan.  Streak anchors
//     respawn at the rotating card exits, so the whole fan follows the carousel.
//   · The same ringPhase drives the band-edge necklace and the radar sweep, so
//     the ring visibly revolves.  Click = inspect: engage→1 slows the ring to
//     ~0.03 rad/s and calms/dims the rays; clicking empty space resumes.
//
// V4.3: memory→card linkage.  A HUD memory may carry an optional `cardId`
// (model.memories[i].cardId).  Selecting that memory (scene click or HUD
// setActive) swings the ring along the shortest angular path so its linked card
// parks at a readable near/front spot (LINK_TARGET_ANGLE ≈ 0.28 rad ≈ RING_NEAR
// + 0.12) over a decelerating 1.2–1.8 s Hermite ease, then holds it there with
// only a tiny idle drift.  On arrival the card pulses once and stays lit while
// its memory is selected (spotlight + focus frame); clearing the selection
// resumes normal rotation.  Selecting any hub memory (with or without a
// cardId) also eases the ring from 0.27 rad/s to the readable hover speed.
// Ray density is capped at the V4.2 entry→crossing→exit→±19.5° fan: inspect
// mode only calms/dims rays, it never spawns more or bigger particles.
//
// V4.4 polish: (1) the select→swing animation is now smooth and single-writer:
// a link trip owns ringPhase/ringSpeed for its whole 1.2–1.8 s Hermite (the
// normal integrator is skipped), the start tangent is the measured ring
// velocity, arrival is at rest, and card→slot assignment is stable per card id
// (hash(id)%N + linear probing) so a linked card never changes slots / target
// phase on HUD polls.  Heavy layer rebuilds are signature-gated: unchanged
// polls no longer rebuild network/cloud/sprites during a swing.  (2) The corona
// is tidier: jAng ±0.008, jRad ±0.004, scale 0.990–1.010, wobble 0.001, one
// uniform synthetic deck tone and equal card sizes, so neighbours line up.
//
// Layer order per frame (back -> front)
//   L0  cached base field: near-black console, teal/cyan haze, hub blooms
//   L1  left network graph: blue bezier web, kind-coloured nodes, pulse beads
//   L2  giant elliptical dial: dark band, cyan hairlines, dense multi-hue tick
//       fan, labels/callouts; necklace + sweep ride the carousel phase
//   L3  light rotating corona of small rectangular status cards (radial paddles)
//   L4  card-nozzle particles + divergence fan + hero memory cloud
//   L5  light streak fan: additive multi-hue rays anchored to the card exits
//   L6  CRT post: calm-zone + vignette, scanlines/faint grain; hover labels on top
//
// Camera: slow two-axis drift + micro rotation; network parallax 0.58, dial,
// cards, cloud and rays 1.0.  Heavy geometry is cached; the rAF loop only
// projects the carousel/cloud and rebuilds streak/nozzle/fan paths.
//
// Interaction math: every frame the carousel and cloud cache their projected
// screen positions.  Pointer coordinates are mapped through the inverse camera
// transform into base space before distance tests; hit priorities are memory
// node -> card (cards use a rotated, foreshortened rectangle test).

function createScene(canvas, opts) {
  "use strict";

  var opt = (opts && typeof opts === "object") ? opts : {};
  var reduced = !!opt.reducedMotion;

  var ctx = null;
  try {
    ctx = (canvas && canvas.getContext) ? canvas.getContext("2d", { alpha: false }) : null;
  } catch (e0) { ctx = null; }
  if (!ctx && canvas && canvas.getContext) {
    try { ctx = canvas.getContext("2d"); } catch (e1) { ctx = null; }
  }
  var usable = !!(canvas && ctx);

  var TAU = Math.PI * 2;
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace';

  // ---------------- palette hook (V3: colorful console palette) -----------
  // V1 hologram-console look, but every semantic gets its own hue instead of a
  // monochrome phosphor.  All colours resolve from this single table;
  // `opts.palette` may override any token and the resolved table is exposed as
  // `createScene.PALETTE`.  No VS Code chrome: this is the AGENT OPS console.
  var PALETTE = {
    // console field
    bg: "#030a0c",
    bgDeep: "#04120f",
    panel: "#04120f",
    panelHi: "#0a231d",
    border: "#123a30",
    // text
    fg: "#e8fff6",
    fgDim: "#9fe8d8",
    fgMuted: "#3f7f74",
    // V3 hue set (one hue per semantic)
    cyan: "#5ff2ff",
    teal: "#3ef0b3",
    violet: "#b07cff",
    magenta: "#ff5ea8",
    amber: "#ffc857",
    blue: "#7aa2ff",
    lime: "#b6ff7a",
    alert: "#ff5f6d",
    nearWhite: "#e8fff6",
    dim: "#3f7f74",
    // derived scene tones
    tealDeep: "#0c3a30",
    dial: "#04161a",
    dialDeep: "#02090c",
    dialSheen: "#0a2f33",
    cardBg: "#04120f",
    calm: "#000000",
    glow: "#5ff2ff",
    pureBlack: "#000000",
    pureWhite: "#e8fff6"
  };
  if (opt.palette && typeof opt.palette === "object") {
    for (var pk in opt.palette) {
      if (Object.prototype.hasOwnProperty.call(opt.palette, pk) &&
        typeof opt.palette[pk] === "string") {
        PALETTE[pk] = opt.palette[pk];
      }
    }
  }

  // resolve hex tokens -> rgb triples once
  var COL = {};
  (function resolvePalette() {
    for (var key in PALETTE) {
      if (!Object.prototype.hasOwnProperty.call(PALETTE, key)) continue;
      var m = /^#([0-9a-fA-F]{6})$/.exec(String(PALETTE[key]).trim());
      if (!m) continue;
      var n = parseInt(m[1], 16);
      COL[key] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
  })();

  function rgbaA(rgb, a) {
    var aa = (a == null) ? 1 : (a < 0 ? 0 : (a > 1 ? 1 : a));
    var r = rgb || [232, 255, 246];
    return "rgba(" + (r[0] | 0) + "," + (r[1] | 0) + "," + (r[2] | 0) + "," + aa + ")";
  }
  function palA(key, a) { return rgbaA(COL[key] || COL.fg, a); }

  // node kind -> hue token (network + memory cloud share this language)
  var KIND_COLOR = { agent: "teal", tool: "amber", file: "magenta", msg: "violet" };
  var KIND_KEYS = ["agent", "tool", "file", "msg"];

  // memory-cloud kinds -> hue token (V3 memory semantics)
  var MEM_COLOR = {
    tool: "amber",
    file: "magenta",
    thought: "violet",
    answer: "lime",
    agent: "teal",
    msg: "violet"
  };
  var MEM_KEYS = ["tool", "file", "thought", "answer", "agent"];

  // streak hue mix: dominant cyan/teal/blue, sparse accents (V3 colorful)
  var HUE_KEYS = ["cyan", "teal", "blue", "violet", "magenta", "amber", "lime"];
  var HUE_WEIGHTS = [0.27, 0.20, 0.16, 0.11, 0.10, 0.09, 0.07];

  // pre-resolved per-hue streak styles (constant alphas, no per-frame strings).
  // HUE_PASSES pre-builds the batched stroke bands per hue: the dominant cyan /
  // teal / blue hues get four bands (tail/mid/head/core), accents tail+head.
  var HUE_STY = [];
  var HUE_PASSES = [];
  for (var hi = 0; hi < HUE_KEYS.length; hi++) {
    var hueRgb = COL[HUE_KEYS[hi]] || COL.fg;
    var bright = hi < 3;
    var sty = {
      tail: rgbaA(hueRgb, bright ? 0.075 : 0.05),
      mid: rgbaA(hueRgb, bright ? 0.15 : 0.10),
      head: rgbaA(hueRgb, bright ? 0.30 : 0.20),
      core: rgbaA(hueRgb, bright ? 0.55 : 0.38)
    };
    HUE_STY.push(sty);
    HUE_PASSES.push(
      bright
        ? [
          { style: sty.tail, width: 0.72, from: 1.00, minVis: 0.18 },
          { style: sty.mid, width: 0.92, from: 0.40, minVis: 0.36 },
          { style: sty.head, width: 1.15, from: 0.10, minVis: 0.42 },
          { style: sty.core, width: 1.30, from: 0.03, minVis: 0.54 }
        ]
        : [
          { style: sty.tail, width: 0.66, from: 1.00, minVis: 0.22 },
          { style: sty.head, width: 1.05, from: 0.12, minVis: 0.40 }
        ]
    );
  }

  // static style strings (constant alpha) — avoids per-frame string churn
  var STY = {
    edgeDim: rgbaA(COL.blue, 0.10),
    edgeMid: rgbaA(COL.blue, 0.17),
    edgeHot: rgbaA(COL.cyan, 0.26),
    edgeSoft: rgbaA(COL.teal, 0.26),
    dust: rgbaA(COL.fgMuted, 0.30),
    beadA: rgbaA(COL.teal, 0.24),
    beadB: rgbaA(COL.cyan, 0.34),
    travTail: rgbaA(COL.cyan, 0.36),
    travHead: rgbaA(COL.nearWhite, 0.92),
    hubRing: rgbaA(COL.blue, 0.30),
    cardBorder: rgbaA(COL.border, 0.95),
    cardCorner: rgbaA(COL.fgMuted, 0.60),
    cardTab: rgbaA(COL.cyan, 0.40),
    sparkDim: rgbaA(COL.cyan, 0.28),
    sparkHot: rgbaA(COL.teal, 0.65),
    heroGlow: rgbaA(COL.teal, 0.055),
    heroCore: rgbaA(COL.nearWhite, 0.45)
  };

  // per-kind node styling
  var KIND_CORE = {};
  var KIND_GLOW = {};
  for (var ki = 0; ki < KIND_KEYS.length; ki++) {
    KIND_CORE[KIND_KEYS[ki]] = rgbaA(COL[KIND_COLOR[KIND_KEYS[ki]]], 0.92);
    KIND_GLOW[KIND_KEYS[ki]] = null; // filled with glow sprites during boot
  }
  // expose the palette hook for the Lead / HUD
  try { createScene.PALETTE = PALETTE; } catch (ePal) { /* ignore */ }

  // ---------------- state -------------------------------------------------
  var disposed = false;
  var running = false;
  var raf = 0;
  var lastFrameMs = 0;
  var t = 0;                 // scene seconds
  var frameNo = 0;
  var warned = false;

  var W = 0, H = 0, dpr = 1, S = 1;
  var cx = 0, cy = 0;        // dial centre (screen)
  var ea = 1, eb = 1;        // dial semi axes
  var ROT = -0.052;          // dial tilt (radians)
  var bandT = 1;             // band thickness
  var cardW = 1, cardH = 1;  // card sprite size (radial length / tangential thickness)
  var camX = 0, camY = 0, camRot = 0;
  var intensity = 0.55, targetIntensity = 0.55;

  var HUBS = [];             // network hub anchors (inside the dial)
  var ANCHORS = [];          // dial outer-edge sample points for streak emission
  var F_TITLE = "", F_LINE = "", F_TINY = "", F_LABEL = "", F_CLOCK = "";

  // V4.2 rotating card corona (refined: fewer, thinner cards around the halo)
  var CARD_N = 42;           // full-circle carousel slots (light corona ring)
  var CARD_F = 0.79;         // radial centre factor of the card ring (pulled in)
  var RING_NEAR = 0.16;      // local dial angle of the near/front side of the ring
  var ringPhase = 0;         // carousel phase: drives cards + necklace + sweep
  var ringSpeed = 0.27;      // current angular speed (rad/s)
  var ringDir = 1;           // spin direction
  var ringVel = 0;           // measured ring angular velocity (smooth seek start)
  // V4.3 memory→card linkage: selecting a memory that carries a cardId swings
  // that card to a readable near/front spot, holds it there and keeps it lit.
  var LINK_TARGET_ANGLE = RING_NEAR + 0.12;   // ≈0.28 rad: bright near/right spot
  var linkCard = -1;         // slot index of the linked card (or -1)
  var linkTrip = { on: false, t: 0, dur: 1.4, from: 0, delta: 0, v0: 0 };
  var linkFlash = 0;         // arrival pulse 1 → 0
  var engageEase = 0;        // smoothed engage (0 = spinning, 1 = readable hover)
  var cardOrder = [];        // painter-sorted carousel cards (reused)
  var rayCards = [];         // cards currently allowed to emit rays (reused)
  var nozzleCards = [];      // bright visible cards firing pulses (reused)

  var model = { mode: "SIMULATION", clock: "", nodes: [], links: [], cards: [] };
  var seen = {};             // pulse id dedupe
  var seenCount = 0;
  var pulseTrav = 0;
  var sparkCursor = 0;

  var bgCanvas = null;
  var overlayCanvas = null;
  var ringCanvas = null, ringBX = 0, ringBY = 0, ringBW = 0, ringBH = 0;
  var scanPattern = null;
  var grainPatterns = [];
  var grainIdx = 0;
  var GLOW = {};              // per-kind node glow sprites
  var COMET_SPRITES = [];     // hue variants for broad streak swaths
  var cardSlots = [];
  // V4.4 stable card→slot mapping: each card id keeps one angular home across
  // HUD polls, so a linked card's target phase never moves mid-swing
  var cardSlotMap = {};              // lowercased card id -> slot index
  var cardSlotTaken = new Uint8Array(CARD_N);
  var cardAssign = new Array(CARD_N);
  var cardList = [];                 // unique model cards of the current poll
  var cardKeys = [];                 // their canonical id keys
  var cardHomes = new Array(CARD_N); // resolved slot per list entry (reused)
  // setModel change signatures: skip expensive rebuilds on unchanged polls
  var netSig = "", cardSig = "", memSig = "";
  var net = {
    nodes: [], sats: [], dust: [], edges: [], beads: [],
    byId: null, pathsReady: false,
    pDim: null, pMid: null, pHot: null, pWhite: null
  };
  var trav = [];
  var parts = [];
  var partCount = 0;
  var comets = [];
  var sparks = [];
  var flick = { next: 2.4, until: 0, n: 0, rows: new Int32Array(6) };
  var ro = null;

  // ---- V3 interaction / new-layer state
  var onHoverCb = (typeof opt.onHover === "function") ? opt.onHover : null;
  var onSelectCb = (typeof opt.onSelect === "function") ? opt.onSelect : null;
  // scene-side hover/pinned labels can be switched off if the HUD renders its own
  var showHoverLabels = opt.hoverLabels !== false;
  var memories = [];            // sanitized model.memories
  var memNodes = [];            // projected memory nodes (stable objects)
  var memEdges = [];            // relation edges between memories
  var memOrder = [];            // depth-sorted draw order (reused array)
  var memC = { x: 0, y: 0, r: 1 };       // cloud centre + radius (layout)
  var memGlow = {};             // memory kind -> glow sprite (filled in boot)
  var cloud = { yaw: 0.55, pitch: -0.16, zoom: 1, yawVel: 0, pitchVel: 0, drag: false };
  var activeId = null;          // pinned memory id
  var activeNode = null;        // resolved pinned node (or null)
  var focusCard = -1;           // card currently focused by a click
  var engage = 0;               // 0 = fast idle ring, 1 = clicked/inspect: hover + slow
  var engageTarget = 0;         // eased target for engage
  // V4 card-nozzle rays: a particle enters at the card's LEFT midpoint (inner
  // end), crosses the box, exits at the RIGHT midpoint (outer end) and then
  // diverges into a short fan of fast particles which feeds the long streak fan.
  var NOZ = [];                 // nozzle pulse pool (preallocated)
  var MAX_NOZ = 160;
  var nozCursor = 0;
  var cardFireT = new Float32Array(CARD_N);  // per-card nozzle cooldown timers
  var FAN = [];                 // divergence-fan particles emitted at each exit
  var MAX_FAN = 260;
  var fanCursor = 0;
  var FAN_PER_EXIT = 5;         // several particles leave the right midpoint
  var FAN_SPREAD = 0.34;        // ±19.5° divergence from the card outward normal
  var pointer = {
    x: 0, y: 0, bx: 0, by: 0, has: false, inside: false, down: false, moved: 0,
    downX: 0, downY: 0, drag: false,
    pendingMemory: null, pendingCard: null
  };
  var hover = null;             // current hit {type,id,label,detail,x,y}
  var hoverKey = "";
  var cursorMode = "";

  var MAXP = 1100;
  var TRAV_N = 22;
  var COMET_N = 7;
  var SPARK_N = 46;

  // ---------------- tiny helpers ------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  // shortest signed angular difference (radians, result in [-π, π])
  function wrapPi(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function hashStr(value) {
    var str = String(value == null ? "" : value);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var v = Math.imul(s ^ (s >>> 15), 1 | s);
      v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
      return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
    };
  }

  function txt(v) { return (v == null) ? "" : String(v); }
  function clipStr(v, n) {
    var s = txt(v).replace(/[\u0000-\u001f\u007f]/g, " ").toUpperCase();
    return s.length > n ? s.slice(0, n) : s;
  }
  function pad2(n) { n = n | 0; return n < 10 ? "0" + n : "" + n; }
  function hex2(n) { n = clamp(n | 0, 0, 255); return (n < 16 ? "0" : "") + n.toString(16).toUpperCase(); }
  function smoothstep(e0, e1, x) {
    if (e1 === e0) return x < e0 ? 0 : 1;
    var u = clamp01((x - e0) / (e1 - e0));
    return u * u * (3 - 2 * u);
  }

  // ---------------- dial geometry -----------------------------------------
  // All dial geometry is authored in a local frame (ellipse centred at 0,0,
  // rotated by ROT).  Helpers convert to screen space.
  function localToScreen(lx, ly, out) {
    var cs = Math.cos(ROT), sn = Math.sin(ROT);
    out.x = cx + lx * cs - ly * sn;
    out.y = cy + lx * sn + ly * cs;
    return out;
  }

  function dialPoint(f, ang, out) {
    return localToScreen(ea * f * Math.cos(ang), eb * f * Math.sin(ang), out);
  }

  // outward normal at local parameter ang (unit, screen frame)
  function dialNormal(ang, out) {
    var nx = Math.cos(ang) / ea, ny = Math.sin(ang) / eb;
    var l = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= l; ny /= l;
    var cs = Math.cos(ROT), sn = Math.sin(ROT);
    out.x = nx * cs - ny * sn;
    out.y = nx * sn + ny * cs;
    return out;
  }

  // carousel slot angle (ringPhase advances continuously)
  function cardPhaseAngle(i) {
    return ringPhase + (TAU * i) / CARD_N;
  }

  var _p = { x: 0, y: 0 };
  var _n = { x: 0, y: 0 };

  // ---------------- layout -------------------------------------------------
  function layoutScene() {
    S = clamp(Math.min(W / 1920, H / 1080), 0.5, 2.2);
    cx = W * 0.258;
    cy = H * 0.512;
    ea = W * 0.386;
    eb = H * 0.568;
    bandT = clamp(ea * 0.095, 18, 90);
    cardW = clamp(ea * 0.12, 62, 170);    // radial long-axis length (refined card)
    cardH = clamp(bandT * 0.42, 16, 34);  // tangential short-axis thickness

    var fs = clamp(8.6 * S, 6.1, 12.5);
    F_TITLE = "600 " + fs.toFixed(1) + "px " + MONO;
    F_LINE = "500 " + (fs * 0.82).toFixed(1) + "px " + MONO;
    F_TINY = "500 " + clamp(6.8 * S, 5.2, 10).toFixed(1) + "px " + MONO;
    F_LABEL = "500 " + clamp(7.3 * S, 5.4, 10.4).toFixed(1) + "px " + MONO;
    F_CLOCK = "600 " + clamp(21 * S, 14, 30).toFixed(1) + "px " + MONO;

    HUBS.length = 0;
    HUBS.push({ x: cx + W * 0.062, y: cy - H * 0.088, ph: 0.0 });
    HUBS.push({ x: cx + W * 0.048, y: cy + H * 0.158, ph: 2.1 });

    // V4.2 memory cloud = the hero: bigger footprint, pulled slightly left and
    // clear of the (thinner) card corona / calm rails
    memC.x = cx + ea * 0.325;
    memC.y = cy + eb * 0.01;
    memC.r = Math.min(W, H) * 0.152;

    // dial outer-edge emission anchors (only points that can actually be seen
    // and are not inside the calm bottom strip)
    ANCHORS.length = 0;
    var count = 120;
    for (var i = 0; i < count; i++) {
      var ang = -1.24 + (2.48 * i) / (count - 1);
      var pt = dialPoint(1.0, ang, { x: 0, y: 0 });
      var nm = dialNormal(ang, { x: 0, y: 0 });
      if (pt.y < -H * 0.02 || pt.y > H * 0.85) continue;
      if (pt.x < -20 || pt.x > W + 20) continue;
      ANCHORS.push({ x: pt.x, y: pt.y, nx: nm.x, ny: nm.y, ang: ang });
    }
  }

  // ---------------- resize -------------------------------------------------
  function measure() {
    var w = 0, h = 0;
    var p = canvas && canvas.parentElement;
    if (p) {
      w = p.clientWidth || p.offsetWidth || 0;
      h = p.clientHeight || p.offsetHeight || 0;
    }
    if (!w || !h) {
      w = (typeof window !== "undefined" && window.innerWidth) || 1280;
      h = (typeof window !== "undefined" && window.innerHeight) || 720;
    }
    return { w: Math.max(300, Math.round(w)), h: Math.max(220, Math.round(h)) };
  }

  function resize() {
    if (disposed || !usable) return;
    var m = measure();
    var nd = 1;
    try {
      nd = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);
    } catch (e) { nd = 1; }
    if (m.w === W && m.h === H && nd === dpr && bgCanvas) return;

    W = m.w; H = m.h; dpr = nd;
    try {
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
    } catch (e) { /* canvas could be detached */ }

    layoutScene();
    buildNetwork();
    buildBackground();
    buildOverlay();
    buildScanTile();
    buildGrain();
    rebuildCardSlots(true);
    buildRingLayer();
    initNozzles();
    initParticles();
    buildMemoryCloud(true);
    cardOrder.length = 0;
    rayCards.length = 0;
    nozzleCards.length = 0;

    if (!running) safeDraw(0);
  }

  // ---------------- cached sprites ----------------------------------------
  function makeGlowSprite(size, rgb, peak) {
    var cv = document.createElement("canvas");
    cv.width = size; cv.height = size;
    var c = cv.getContext("2d");
    if (!c) return null;
    var h = size * 0.5;
    var grd = c.createRadialGradient(h, h, 0, h, h, h);
    grd.addColorStop(0, rgbaA(rgb, peak));
    grd.addColorStop(0.16, rgbaA(rgb, peak * 0.56));
    grd.addColorStop(0.44, rgbaA(rgb, peak * 0.15));
    grd.addColorStop(1, rgbaA(rgb, 0));
    c.fillStyle = grd;
    c.fillRect(0, 0, size, size);
    return cv;
  }

  // broad comet swath sprite, tunable hue (body colour -> hot head colour)
  function makeCometSprite(rgbBody, rgbHead) {
    var w = 256, h = 64;
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var c = cv.getContext("2d");
    if (!c) return null;
    var g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, rgbaA(rgbBody, 0));
    g.addColorStop(0.40, rgbaA(rgbBody, 0.055));
    g.addColorStop(0.72, rgbaA(rgbBody, 0.13));
    g.addColorStop(0.90, rgbaA(rgbBody, 0.30));
    g.addColorStop(0.975, rgbaA(rgbHead, 0.66));
    g.addColorStop(1, rgbaA(rgbHead, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    var vg = c.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, palA("pureBlack", 0));
    vg.addColorStop(0.32, palA("pureBlack", 0.30));
    vg.addColorStop(0.50, palA("pureBlack", 1));
    vg.addColorStop(0.68, palA("pureBlack", 0.30));
    vg.addColorStop(1, palA("pureBlack", 0));
    c.globalCompositeOperation = "destination-in";
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = "source-over";
    return cv;
  }

  // ---------------- L0: base field ----------------------------------------
  function buildBackground() {
    var bw = Math.max(320, Math.round(W * 0.5));
    var bh = Math.max(200, Math.round(H * 0.5));
    var cv = document.createElement("canvas");
    cv.width = bw; cv.height = bh;
    var c = cv.getContext("2d");
    if (!c) return;
    c.setTransform(bw / W, 0, 0, bh / H, 0, 0);

    c.fillStyle = rgbaA(COL.bg, 1);
    c.fillRect(0, 0, W, H);

    // broad console haze behind the dial: deep teal + a cyan bloom (V1 mood,
    // now multi-hue instead of monochrome phosphor)
    var g = c.createRadialGradient(cx + ea * 0.30, cy - H * 0.02, ea * 0.08,
      cx + ea * 0.30, cy - H * 0.02, ea * 1.85);
    g.addColorStop(0, rgbaA(COL.dialSheen, 0.62));
    g.addColorStop(0.42, rgbaA(COL.tealDeep, 0.24));
    g.addColorStop(1, rgbaA(COL.bg, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // hub blooms: cyan anchor + violet counter-anchor (colorful console)
    for (var i = 0; i < HUBS.length; i++) {
      var hubHue = i === 0 ? COL.cyan : COL.violet;
      g = c.createRadialGradient(HUBS[i].x, HUBS[i].y, 3,
        HUBS[i].x, HUBS[i].y, Math.min(W, H) * 0.42);
      g.addColorStop(0, rgbaA(hubHue, 0.20));
      g.addColorStop(0.48, rgbaA(hubHue, 0.07));
      g.addColorStop(1, rgbaA(COL.bg, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }

    // memory-cloud ambience in the dial interior (violet -> teal whisper)
    g = c.createRadialGradient(cx + ea * 0.36, cy + eb * 0.02, 4,
      cx + ea * 0.36, cy + eb * 0.02, Math.min(W, H) * 0.20);
    g.addColorStop(0, rgbaA(COL.violet, 0.10));
    g.addColorStop(0.55, rgbaA(COL.teal, 0.05));
    g.addColorStop(1, rgbaA(COL.bg, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // right-side streak glow — cyan / blue wash
    g = c.createLinearGradient(cx + ea * 0.92, 0, W, 0);
    g.addColorStop(0, rgbaA(COL.cyan, 0));
    g.addColorStop(0.30, rgbaA(COL.cyan, 0.10));
    g.addColorStop(0.72, rgbaA(COL.blue, 0.07));
    g.addColorStop(1, rgbaA(COL.tealDeep, 0.06));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // deep black corner shadow (keeps HUD rails calm)
    g = c.createRadialGradient(0, H, Math.min(W, H) * 0.1, 0, H, Math.max(W, H) * 0.95);
    g.addColorStop(0, palA("pureBlack", 0.42));
    g.addColorStop(0.6, palA("pureBlack", 0.14));
    g.addColorStop(1, palA("pureBlack", 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    bgCanvas = cv;
  }

  // ---------------- L5a: calm-zone + vignette overlay ----------------------
  function buildOverlay() {
    var ow = Math.max(320, Math.round(W * 0.5));
    var oh = Math.max(200, Math.round(H * 0.5));
    var cv = document.createElement("canvas");
    cv.width = ow; cv.height = oh;
    var c = cv.getContext("2d");
    if (!c) return;
    c.setTransform(ow / W, 0, 0, oh / H, 0, 0);

    // left HUD rail calm — neutral black, no colour cast
    var leftW = Math.max(150, W * 0.115);
    var g = c.createLinearGradient(0, 0, leftW, 0);
    g.addColorStop(0, palA("pureBlack", 0.62));
    g.addColorStop(0.62, palA("pureBlack", 0.34));
    g.addColorStop(1, palA("pureBlack", 0));
    c.fillStyle = g;
    c.fillRect(0, 0, leftW, H);

    // bottom HUD strip calm
    var botH = Math.max(130, H * 0.17);
    g = c.createLinearGradient(0, H, 0, H - botH);
    g.addColorStop(0, palA("pureBlack", 0.70));
    g.addColorStop(0.60, palA("pureBlack", 0.40));
    g.addColorStop(1, palA("pureBlack", 0));
    c.fillStyle = g;
    c.fillRect(0, H - botH, W, botH);

    // top bar shade
    var topH = Math.max(46, H * 0.075);
    g = c.createLinearGradient(0, 0, 0, topH);
    g.addColorStop(0, palA("pureBlack", 0.38));
    g.addColorStop(1, palA("pureBlack", 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, topH);

    // subtle right edge shade
    var rightW = W * 0.07;
    g = c.createLinearGradient(W, 0, W - rightW, 0);
    g.addColorStop(0, palA("pureBlack", 0.10));
    g.addColorStop(1, palA("pureBlack", 0));
    c.fillStyle = g;
    c.fillRect(W - rightW, 0, rightW, H);

    // neutral black vignette
    var vg = c.createRadialGradient(W * 0.52, H * 0.48, Math.min(W, H) * 0.30,
      W * 0.5, H * 0.5, Math.max(W, H) * 0.76);
    vg.addColorStop(0, palA("pureBlack", 0));
    vg.addColorStop(0.60, palA("pureBlack", 0.12));
    vg.addColorStop(1, palA("pureBlack", 0.48));
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);

    overlayCanvas = cv;
  }

  // ---------------- L5b: scanline + grain tiles ---------------------------
  function buildScanTile() {
    scanPattern = null;
    if (!ctx) return;
    var cv = document.createElement("canvas");
    cv.width = 3; cv.height = 3;
    var c = cv.getContext("2d");
    if (!c) return;
    c.fillStyle = palA("pureBlack", 0.85);
    c.fillRect(0, 0, 3, 1);
    c.fillStyle = palA("pureBlack", 0.22);
    c.fillRect(0, 1, 3, 1);
    try { scanPattern = ctx.createPattern(cv, "repeat"); } catch (e) { scanPattern = null; }
  }

  function buildGrain() {
    grainPatterns.length = 0;
    if (!ctx) return;
    var gr = COL.fgDim || [157, 157, 157];
    var size = 96;
    for (var gi = 0; gi < 4; gi++) {
      var cv = document.createElement("canvas");
      cv.width = size; cv.height = size;
      var c = cv.getContext("2d");
      if (!c) continue;
      var img = c.createImageData(size, size);
      var data = img.data;
      var rng = makeRng(0x9e3779 + gi * 7919);
      for (var i = 0; i < data.length; i += 4) {
        var v = rng();
        // neutral grey grain — no phosphor tint
        data[i] = gr[0];
        data[i + 1] = gr[1];
        data[i + 2] = gr[2];
        data[i + 3] = v < 0.70 ? 0 : ((v - 0.70) * 127) | 0;
      }
      c.putImageData(img, 0, 0);
      try {
        var pat = ctx.createPattern(cv, "repeat");
        if (pat) grainPatterns.push(pat);
      } catch (e) { /* ignore */ }
    }
  }

  // ---------------- L2: cached giant dial ---------------------------------
  function buildRingLayer() {
    if (!usable) return;
    ringCanvas = null;

    // screen bbox of all dial decoration.  Only sample content that can ever
    // be on screen (plus a margin for camera drift) so the cached texture stays
    // small; off-screen extremes must not inflate it.
    var margin = Math.max(30, 40 * S);
    var pad = 40 * S + 20;
    var bx0 = W, by0 = H, bx1 = 0, by1 = 0;
    function expand(px, py) {
      if (px < bx0) bx0 = px;
      if (px > bx1) bx1 = px;
      if (py < by0) by0 = py;
      if (py > by1) by1 = py;
    }
    var tmp = { x: 0, y: 0 };
    var i, k, ang, dist, f;
    for (i = 0; i <= 96; i++) {
      ang = -1.30 + (2.60 * i) / 96;
      for (k = 0; k < 4; k++) {
        f = [0.40, 0.62, 0.90, 1.24][k];
        dialPoint(f, ang, tmp);
        if (tmp.y < -margin || tmp.y > H + margin) continue;
        expand(tmp.x, tmp.y);
      }
    }
    // pad, then keep a small off-screen margin so camera drift never exposes
    // a seam at the top/bottom of the cached dial texture
    bx0 = Math.max(-margin, Math.floor(bx0 - pad));
    by0 = Math.max(-margin, Math.floor(by0 - pad));
    bx1 = Math.min(W + margin, Math.ceil(bx1 + pad));
    by1 = Math.min(H + margin, Math.ceil(by1 + pad));
    if (bx1 - bx0 < 16 || by1 - by0 < 16) return;
    ringBX = bx0; ringBY = by0; ringBW = bx1 - bx0; ringBH = by1 - by0;

    var cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(ringBW * dpr));
    cv.height = Math.max(2, Math.round(ringBH * dpr));
    var c = cv.getContext("2d");
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.translate(cx, cy);
    c.rotate(ROT);

    // ---- local-frame helpers
    var nn = { x: 0, y: 0 };
    var q0 = { x: 0, y: 0 };
    var q1 = { x: 0, y: 0 };
    function lNormal(a, out) {
      var nx = Math.cos(a) / ea, ny = Math.sin(a) / eb;
      var l = Math.sqrt(nx * nx + ny * ny) || 1;
      out.x = nx / l;
      out.y = ny / l;
      return out;
    }
    function lOuter(a, d, out) {
      lNormal(a, nn);
      out.x = ea * Math.cos(a) + nn.x * d;
      out.y = eb * Math.sin(a) + nn.y * d;
      return out;
    }
    var innerA = Math.max(3, ea - bandT);
    var innerB = Math.max(3, eb - bandT);

    // ---- band body: dark console trough
    var bg = c.createLinearGradient(-ea * 0.25, -eb, ea, eb);
    bg.addColorStop(0, rgbaA(COL.dial, 0.97));
    bg.addColorStop(0.48, rgbaA(COL.dialDeep, 0.94));
    bg.addColorStop(1, rgbaA(COL.dial, 0.97));
    c.beginPath();
    c.ellipse(0, 0, ea, eb, 0, 0, TAU);
    c.ellipse(0, 0, innerA, innerB, 0, 0, TAU);
    c.fillStyle = bg;
    c.fill("evenodd");

    // faint teal sheen inside the band
    var sheen = c.createLinearGradient(-ea, -eb, ea, eb);
    sheen.addColorStop(0, rgbaA(COL.dialSheen, 0.55));
    sheen.addColorStop(0.45, rgbaA(COL.tealDeep, 0.10));
    sheen.addColorStop(1, rgbaA(COL.dialSheen, 0.30));
    c.beginPath();
    c.ellipse(0, 0, ea, eb, 0, 0, TAU);
    c.ellipse(0, 0, innerA, innerB, 0, 0, TAU);
    c.fillStyle = sheen;
    c.fill("evenodd");

    // ---- cyan bloom on both band edges (cheap stroke passes; no shadowBlur)
    c.save();
    c.globalCompositeOperation = "lighter";
    var glowW = [22, 12, 5.5, 2.2];
    var glowA = [0.020, 0.040, 0.080, 0.16];
    for (i = 0; i < 4; i++) {
      c.lineWidth = Math.max(0.8, glowW[i] * S);
      c.strokeStyle = palA("cyan", glowA[i]);
      c.beginPath(); c.ellipse(0, 0, ea, eb, 0, -1.28, 1.28); c.stroke();
      c.beginPath(); c.ellipse(0, 0, innerA, innerB, 0, -1.28, 1.28); c.stroke();
    }
    c.restore();

    // ---- crisp hairlines on the edges (bright double rim like the reference)
    c.lineWidth = Math.max(1.2, 1.7 * S);
    c.strokeStyle = palA("cyan", 0.80);
    c.beginPath(); c.ellipse(0, 0, ea, eb, 0, -1.28, 1.28); c.stroke();
    c.lineWidth = Math.max(0.6, 0.8 * S);
    c.strokeStyle = palA("nearWhite", 0.30);
    c.beginPath(); c.ellipse(0, 0, ea + 3.4 * S, eb + 3.4 * S, 0, -1.26, 1.26); c.stroke();
    c.lineWidth = Math.max(0.9, 1.1 * S);
    c.strokeStyle = palA("teal", 0.48);
    c.beginPath(); c.ellipse(0, 0, innerA, innerB, 0, -1.28, 1.28); c.stroke();

    // ---- outer concentric hairlines
    c.lineWidth = Math.max(0.5, 0.7 * S);
    c.strokeStyle = palA("blue", 0.24);
    c.beginPath(); c.ellipse(0, 0, ea + 8 * S, eb + 8 * S, 0, -1.30, 1.30); c.stroke();
    c.strokeStyle = palA("blue", 0.11);
    c.beginPath(); c.ellipse(0, 0, ea + 18 * S, eb + 18 * S, 0, -1.23, 1.23); c.stroke();

    // ---- tick fan on the outer edge (dense cyan radar ticks)
    var TICKS = 220, T0 = -1.24, T1 = 1.24;
    c.strokeStyle = palA("blue", 0.44);
    c.lineWidth = Math.max(0.5, 0.72 * S);
    c.beginPath();
    for (i = 0; i < TICKS; i++) {
      ang = T0 + (T1 - T0) * i / (TICKS - 1);
      lOuter(ang, 1.6 * S, q0);
      lOuter(ang, 4.4 * S, q1);
      c.moveTo(q0.x, q0.y);
      c.lineTo(q1.x, q1.y);
    }
    c.stroke();

    c.strokeStyle = palA("teal", 0.60);
    c.lineWidth = Math.max(0.6, 0.8 * S);
    c.beginPath();
    for (i = 0; i < TICKS; i += 8) {
      ang = T0 + (T1 - T0) * i / (TICKS - 1);
      lOuter(ang, 1.6 * S, q0);
      lOuter(ang, 8.2 * S, q1);
      c.moveTo(q0.x, q0.y);
      c.lineTo(q1.x, q1.y);
    }
    c.stroke();

    c.strokeStyle = palA("cyan", 0.80);
    c.lineWidth = Math.max(0.7, 1.05 * S);
    c.beginPath();
    for (i = 0; i < TICKS; i += 32) {
      ang = T0 + (T1 - T0) * i / (TICKS - 1);
      lOuter(ang, 1.6 * S, q0);
      lOuter(ang, 14 * S, q1);
      c.moveTo(q0.x, q0.y);
      c.lineTo(q1.x, q1.y);
    }
    c.stroke();

    // ---- inner-edge ticks
    c.strokeStyle = palA("blue", 0.18);
    c.lineWidth = Math.max(0.45, 0.6 * S);
    c.beginPath();
    for (i = 1; i < TICKS; i += 2) {
      ang = T0 + (T1 - T0) * i / (TICKS - 1);
      lNormal(ang, nn);
      var ix = innerA * Math.cos(ang), iy = innerB * Math.sin(ang);
      c.moveTo(ix, iy);
      c.lineTo(ix - nn.x * 5 * S, iy - nn.y * 5 * S);
    }
    c.stroke();

    // ---- radial separators across the band (blue)
    c.strokeStyle = palA("blue", 0.28);
    c.lineWidth = Math.max(0.5, 0.7 * S);
    c.beginPath();
    for (i = 0; i < TICKS; i += 24) {
      ang = T0 + (T1 - T0) * i / (TICKS - 1);
      lNormal(ang, nn);
      q0.x = ea * Math.cos(ang);
      q0.y = eb * Math.sin(ang);
      c.moveTo(q0.x, q0.y);
      c.lineTo(q0.x - nn.x * bandT, q0.y - nn.y * bandT);
    }
    c.stroke();

    // ---- dial numbers
    var rng = makeRng(0x51f7a1);
    c.font = F_TINY;
    c.textAlign = "center";
    c.textBaseline = "middle";
    var vals = ["0.02", "0.11", "0.24", "0.38", "0.52", "0.66", "0.81", "0.94", "1.00"];
    c.fillStyle = palA("teal", 0.58);
    for (i = 24; i < TICKS; i += 24) {
      ang = T0 + (T1 - T0) * i / (TICKS - 1);
      lOuter(ang, 22 * S, q0);
      lNormal(ang, nn);
      c.save();
      c.translate(q0.x, q0.y);
      c.rotate(Math.atan2(nn.y, nn.x));
      c.fillText(vals[(i / 24) % vals.length], 0, 0);
      c.restore();
    }

    // ---- dot-matrix clusters on the band (fixed decoration; the rotating
    // carousel is drawn live on top, so cached decoration must not track slots)
    var dotHues = [COL.cyan, COL.teal, COL.violet, COL.magenta];
    for (i = 0; i < 10; i++) {
      var mid = -1.16 + (2.32 * i) / 9 + (rng() - 0.5) * 0.10;
      var cf = 0.935 + rng() * 0.045;
      lNormal(mid, nn);
      q0.x = ea * cf * Math.cos(mid);
      q0.y = eb * cf * Math.sin(mid);
      c.save();
      c.translate(q0.x, q0.y);
      c.rotate(Math.atan2(nn.y, nn.x) + Math.PI / 2);
      var cols = 3 + ((rng() * 3) | 0);
      var rows = 3 + ((rng() * 3) | 0);
      c.fillStyle = rgbaA(dotHues[i % dotHues.length], 0.32);
      for (var cc = 0; cc < cols; cc++) {
        for (var rr = 0; rr < rows; rr++) {
          if (rng() < 0.20) continue;
          c.fillRect(-6 * S + cc * 3.1 * S, -4.6 * S + rr * 2.9 * S, 1.25 * S, 1.25 * S);
        }
      }
      c.restore();
    }

    // ---- tiny bar strips in the band (fixed hue-cycled decoration)
    var barHues = [COL.blue, COL.teal, COL.amber, COL.violet];
    for (i = 0; i < 8; i++) {
      var mid2 = -1.10 + (2.20 * i) / 7 + (rng() - 0.5) * 0.08;
      lNormal(mid2, nn);
      q0.x = ea * 0.945 * Math.cos(mid2);
      q0.y = eb * 0.945 * Math.sin(mid2);
      c.save();
      c.translate(q0.x, q0.y);
      c.rotate(Math.atan2(nn.y, nn.x) + Math.PI / 2);
      c.fillStyle = rgbaA(barHues[i % barHues.length], 0.32);
      for (k = 0; k < 5; k++) {
        c.fillRect(-4 * S + k * 2.4 * S, -3 * S, 1.1 * S, (2 + rng() * 6) * S);
      }
      c.restore();
    }

    // ---- bright rim accents (fixed; the moving sweep is drawn live)
    c.strokeStyle = palA("cyan", 0.42);
    c.lineWidth = Math.max(0.55, 0.85 * S);
    c.beginPath();
    for (i = 0; i < 18; i++) {
      ang = T0 + (T1 - T0) * ((i * 37) % 220) / 219;
      lOuter(ang, 2 * S, q0);
      lOuter(ang, (6 + (i % 4) * 2.5) * S, q1);
      c.moveTo(q0.x, q0.y);
      c.lineTo(q1.x, q1.y);
    }
    c.stroke();

    // ---- callout labels outside the band (hue-cycled)
    var callouts = [
      [-0.74, "RING // 03"],
      [-0.40, "AZ 0.42"],
      [0.34, ":: DISPATCH"],
      [0.86, "▚ SYNC 04"]
    ];
    var callHues = [COL.cyan, COL.teal, COL.violet, COL.magenta];
    c.font = F_TINY;
    c.textAlign = "left";
    c.textBaseline = "middle";
    for (i = 0; i < callouts.length; i++) {
      ang = callouts[i][0];
      lOuter(ang, 26 * S, q0);
      c.strokeStyle = rgbaA(callHues[i % callHues.length], 0.32);
      c.lineWidth = Math.max(0.5, 0.65 * S);
      c.beginPath();
      c.moveTo(q0.x, q0.y);
      c.lineTo(q0.x + 15 * S, q0.y);
      c.stroke();
      c.fillStyle = rgbaA(callHues[i % callHues.length], 0.60);
      c.fillText(callouts[i][1], q0.x + 18 * S, q0.y);
    }

    // ---- inner dial ring + sparse ticks
    c.strokeStyle = palA("blue", 0.12);
    c.lineWidth = Math.max(0.5, 0.7 * S);
    c.setLineDash([1.8 * S, 6 * S]);
    c.beginPath(); c.ellipse(0, 0, ea * 0.62, eb * 0.62, 0, -0.98, 0.98); c.stroke();
    c.setLineDash([]);
    c.strokeStyle = palA("blue", 0.14);
    c.beginPath();
    for (i = 0; i <= 40; i++) {
      ang = -0.95 + (1.9 * i) / 40;
      lNormal(ang, nn);
      var bx = ea * 0.62 * Math.cos(ang), by = eb * 0.62 * Math.sin(ang);
      c.moveTo(bx, by);
      c.lineTo(bx + nn.x * 4 * S, by + nn.y * 4 * S);
    }
    c.stroke();

    // ---- band speckle (multi-hue dust) + glitch hairlines
    var speckHues = [COL.cyan, COL.teal, COL.violet, COL.magenta, COL.lime];
    for (i = 0; i < 150; i++) {
      ang = -1.25 + rng() * 2.5;
      dist = (rng() - 0.5) * bandT * 0.85;
      lOuter(ang, dist, q0);
      c.fillStyle = rgbaA(speckHues[i % speckHues.length], 0.16);
      c.fillRect(q0.x, q0.y, 1.1, 1.1);
    }
    c.strokeStyle = palA("lime", 0.11);
    c.lineWidth = Math.max(0.45, 0.6 * S);
    c.beginPath();
    for (i = 0; i < 14; i++) {
      ang = -1.2 + rng() * 2.4;
      dist = -(0.15 + rng() * 0.8) * bandT;
      lOuter(ang, 0, q0);
      lOuter(ang, dist, q1);
      c.moveTo(q0.x, q0.y);
      c.lineTo(q1.x, q1.y);
    }
    c.stroke();

    // ---- baked outer emission haze (cyan)
    c.save();
    c.globalCompositeOperation = "lighter";
    c.lineWidth = Math.max(6, 26 * S);
    c.strokeStyle = palA("blue", 0.05);
    c.beginPath(); c.ellipse(0, 0, ea + 10 * S, eb + 10 * S, 0, -1.24, 1.24); c.stroke();
    c.lineWidth = Math.max(2, 8 * S);
    c.strokeStyle = palA("cyan", 0.045);
    c.beginPath(); c.ellipse(0, 0, innerA - bandT * 0.2, innerB - bandT * 0.2, 0, -1.24, 1.24); c.stroke();
    c.restore();

    ringCanvas = cv;
  }

  // ---------------- L3: status cards on the band --------------------------
  // one hue per status: run cyan, ok teal/mint, wait amber, error alert rose
  var STATUS = {
    run: { key: "cyan", glyph: "▶" },
    ok: { key: "teal", glyph: "■" },
    wait: { key: "amber", glyph: "▲" },
    error: { key: "alert", glyph: "×" }
  };

  var SYN_TITLES = ["TRK", "NODE", "SYNC", "LINK", "PROBE", "DECK", "ORB", "REL",
    "TLM", "RDY", "CMD", "ACK", "HEX", "AUX"];
  var SYN_BITS = ["OK", "RUN", "WAIT", "0x4A", "SYNC", "LIVE", "STBY", "GAIN"];
  var GHOST_LABELS = ["NODE-04", "LINK-11", "PROBE-07", "SYNC-02", "AUX-19", "RELAY-3"];

  function synthCard(i) {
    var h1 = hashStr("syn|" + i);
    var h2 = hashStr("syn2|" + i);
    var h3 = hashStr("syn3|" + i);
    var status = h3 > 0.88 ? "wait" : (h3 > 0.78 ? "error" : (h2 > 0.62 ? "ok" : "run"));
    return {
      id: "synth-" + i,
      title: SYN_TITLES[Math.floor(h1 * SYN_TITLES.length) % SYN_TITLES.length] + "-" + pad2(10 + Math.floor(h2 * 89)),
      line1: SYN_BITS[Math.floor(h2 * SYN_BITS.length) % SYN_BITS.length] + " " + pad2(Math.floor(h3 * 99)) + "%",
      line2: "0x" + hex2(Math.floor(h1 * 255)) + hex2(Math.floor(h3 * 255)),
      status: status,
      tone: h1
    };
  }

  function paintCardSprite(s, card, deco) {
    var c = s.ctx;
    if (!c) return;
    var w = s.w, h = s.h;
    var k = deco ? 0.62 : 1;
    c.setTransform(s.ss, 0, 0, s.ss, 0, 0);
    c.clearRect(0, 0, w, h);
    var st = STATUS[card.status] || STATUS.wait;
    var srgb = COL[st.key] || COL.fg;
    // V4 carousel cards: 6–8px console text, 2–3 clipped rows
    var fsT = clamp(h * 0.30, 5.0, 8.0);
    var fsL = clamp(h * 0.235, 4.2, 6.6);
    var fTitle = "600 " + fsT.toFixed(1) + "px " + MONO;
    var fLine = "500 " + fsL.toFixed(1) + "px " + MONO;

    // panel — translucent console plate with a thin coloured status gutter
    c.fillStyle = deco ? rgbaA(COL.cardBg, 0.72) : rgbaA(COL.cardBg, 0.88);
    c.fillRect(0, 0, w, h);
    var g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgbaA(COL.panel, 0.40 * k));
    g.addColorStop(0.30, rgbaA(COL.cardBg, 0));
    g.addColorStop(1, palA("pureBlack", 0.12));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    // console border on the long edges (subtle: light corona, not a box wall)
    c.fillStyle = rgbaA(COL.border, 0.62);
    c.fillRect(0, 0, w, 1);
    c.fillRect(0, h - 1, w, 1);
    // coloured left border by status (inner radial end) — console gutter accent
    c.fillStyle = rgbaA(srgb, 0.78 * k);
    c.fillRect(0, 0, 1.8, h);
    // outer-end status tab + cyan tick
    c.fillStyle = rgbaA(COL.blue, 0.38 * k);
    c.fillRect(w - 1.6, 1, 1.6, h * 0.40);
    c.fillStyle = rgbaA(srgb, 0.72 * k);
    c.fillRect(w - 1.6, h * 0.46, 1.6, h * 0.24);
    // corner marks
    c.fillStyle = rgbaA(COL.fgMuted, 0.28 * k);
    var cm = Math.min(7, w * 0.11);
    c.fillRect(2.5, 1, cm, 1);
    c.fillRect(w - cm - 1, h - 2, cm, 1);

    // status glyph column
    var textX = w * 0.145;
    c.font = fLine;
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillStyle = rgbaA(srgb, 0.82 * k);
    c.fillText(st.glyph, Math.max(4, w * 0.045), h * 0.5);

    // console coloured text rows (crisp fillText, clipped by the sprite box)
    var lines = h >= 24 ? 3 : 2;
    c.font = fTitle;
    c.fillStyle = rgbaA(COL.fg, 0.92 * k);            // title  — near-white
    c.fillText(clipStr(card.title, 15), textX, h * (lines === 3 ? 0.28 : 0.34));
    c.font = fLine;
    c.fillStyle = rgbaA(COL.blue, 0.80 * k);          // target — cyan-blue link
    c.fillText(clipStr(card.line1, 17), textX, h * (lines === 3 ? 0.56 : 0.72));
    if (lines === 3) {
      c.fillStyle = rgbaA(COL.fgMuted, 0.80 * k);     // meta   — dim console text
      c.fillText(clipStr(card.line2, 17), textX, h * 0.80);
    }

    // tone bar at the outer end
    var tw = clamp01(card.tone) * w * 0.24;
    if (tw > 0.6) {
      c.fillStyle = rgbaA(srgb, 0.60 * k);
      c.fillRect(w - tw - 4, h - 3.2, tw, 1.2);
    }
  }

  function rebuildCardSlots(force) {
    if (!usable) return;
    // bake a little larger than the CSS size: near-side carousel cards are
    // scaled up ~1.35x by perspective, so they stay crisp
    var ss = Math.min(2.5, Math.max(1, dpr * 1.3));
    var w = Math.max(24, Math.round(cardW));
    var h = Math.max(12, Math.round(cardH));
    var same = cardSlots.length === CARD_N && cardSlots[0] &&
      cardSlots[0].w === w && cardSlots[0].h === h && cardSlots[0].ss === ss;
    if (same && !force) {
      updateCardSprites();
      return;
    }
    cardSlots.length = 0;
    for (var i = 0; i < CARD_N; i++) {
      var cv = document.createElement("canvas");
      cv.width = Math.max(2, Math.round(w * ss));
      cv.height = Math.max(2, Math.round(h * ss));
      var c2 = cv.getContext("2d");
      // V4.4 tidy corona: only a whisper of per-slot variation so neighbours
      // line up; every card sprite keeps exactly the same baked size
      cardSlots.push({
        canvas: cv, ctx: c2, w: w, h: h, ss: ss, slotIndex: i,
        sig: "", status: "wait", flash: 0, run: 0,
        jAng: (hashStr("caja|" + i) - 0.5) * 0.016,
        jRad: (hashStr("cajr|" + i) - 0.5) * 0.008,
        jScale: 0.990 + hashStr("cajs|" + i) * 0.020,
        seed: hashStr("carousel|" + i),
        px: 0, py: 0, rot: 0, sx: 1, sy: 1, alpha: 0, depth: 0,
        dirx: 1, diry: 0, radLen: 1, visible: false, ray: false
      });
    }
    updateCardSprites();
  }

  function updateCardSprites() {
    if (!usable || !cardSlots.length) return;
    var cards = model.cards;
    var n = cards.length;
    var i, j, slot;
    var take = cardSlotTaken, assign = cardAssign;
    take.fill(0);
    for (i = 0; i < CARD_N; i++) assign[i] = null;

    // ---- V4.4 stable card→slot mapping --------------------------------
    // A card id keeps the same angular home for as long as it stays in the
    // model.  New cards get hash(cardId) % CARD_N with linear probing for
    // collisions; removed cards free their slot.  This keeps the linked card's
    // target phase fixed across HUD polls, which removes the mid-swing stutter.
    cardList.length = 0;
    cardKeys.length = 0;
    var seenKey = {};
    for (j = 0; j < n; j++) {
      var cd = cards[j];
      if (!cd) continue;
      var key = String(cd.id).toLowerCase();
      if (seenKey[key]) continue;        // duplicate ids: first one wins
      seenKey[key] = 1;
      cardList.push(cd);
      cardKeys.push(key);
    }
    // pass 1: keep existing homes (first-come, so two ids can never share)
    for (j = 0; j < cardList.length; j++) {
      slot = cardSlotMap[cardKeys[j]];
      if (slot != null && slot >= 0 && slot < CARD_N && !take[slot]) {
        take[slot] = 1;
        assign[slot] = cardList[j];
        cardHomes[j] = slot;
      } else {
        cardHomes[j] = -1;
      }
    }
    // pass 2: place new cards deterministically into the remaining free slots
    for (j = 0; j < cardList.length; j++) {
      if (cardHomes[j] >= 0) continue;
      var cand = Math.floor(hashStr("slot|" + cardKeys[j]) * CARD_N) % CARD_N;
      slot = -1;
      for (i = 0; i < CARD_N; i++) {
        var cc = (cand + i) % CARD_N;
        if (!take[cc]) { slot = cc; break; }
      }
      if (slot < 0) continue;
      take[slot] = 1;
      assign[slot] = cardList[j];
      cardSlotMap[cardKeys[j]] = slot;
      cardHomes[j] = slot;
    }
    // pass 3: forget cards that left the model (frees their slots)
    for (var mk in cardSlotMap) {
      if (!seenKey[mk]) delete cardSlotMap[mk];
    }

    for (i = 0; i < CARD_N; i++) {
      var s = cardSlots[i];
      if (!s) continue;
      var real = assign[i];
      var card = real || synthCard(i);
      var sig = (real ? "r|" : "d|") + card.title + "|" + card.line1 + "|" + card.line2 + "|" +
        card.status + "|" + Math.round(clamp01(card.tone) * 8);
      // only sig-changed sprites are re-baked (small sync work per poll)
      if (sig !== s.sig) {
        s.sig = sig;
        paintCardSprite(s, card, !real);
      }
      s.status = card.status;
      s.run = card.status === "run" ? 1 : 0;
      s.card = card;                 // content for hit testing / callbacks
      s.real = !!real;
    }
  }

  // ---------------- L1: network graph -------------------------------------
  function placeNode(idStr, kind, weight) {
    var hub = HUBS[hashStr("hub|" + idStr) < 0.58 ? 0 : 1] || HUBS[0] || { x: cx, y: cy };
    var ang = Math.PI + (hashStr("ang|" + idStr) * 2 - 1) * 1.42;
    var rad = (0.045 + hashStr("rad|" + idStr) * 0.205) * W;
    if (kind === "agent") rad *= 0.55;
    else if (kind === "msg") rad *= 0.72;
    else if (kind === "tool" || kind === "file") rad *= 1.12;
    var x = hub.x + Math.cos(ang) * rad;
    var y = hub.y + Math.sin(ang) * rad * (0.55 + hashStr("ry|" + idStr) * 0.45);
    for (var it = 0; it < 4; it++) {
      var ex = (x - cx) / ea, ey = (y - cy) / eb;
      if (ex * ex + ey * ey <= 0.68) break;
      x = cx + (x - cx) * 0.88;
      y = cy + (y - cy) * 0.88;
    }
    x = clamp(x, W * 0.012, W * 0.52);
    y = clamp(y, H * 0.045, H * 0.845);
    return { x: x, y: y, kind: kind, weight: weight };
  }

  function addEdge(x1, y1, x2, y2, bow, alpha, hot) {
    if (net.edges.length >= 340) return;
    var dx = x2 - x1, dy = y2 - y1;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / dist, ny = dx / dist;
    var b = bow * dist;
    var e = {
      x1: x1, y1: y1, x2: x2, y2: y2,
      cx1: (x1 + x2) * 0.5 + nx * b,
      cy1: (y1 + y2) * 0.5 + ny * b,
      a: alpha,
      hot: !!hot,
      white: alpha > 0.125 && hashStr("w|" + net.edges.length + "|" + Math.round(x1) + "|" + Math.round(y1)) > 0.82
    };
    net.edges.push(e);
  }

  function buildNetwork() {
    if (!usable) return;
    var nodes = model.nodes, links = model.links;
    var i, k, v, n, ang, rad, h1, h2;

    net.nodes.length = 0;
    net.sats.length = 0;
    net.dust.length = 0;
    net.edges.length = 0;
    net.beads.length = 0;
    net.byId = {};

    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      v = placeNode(n.id, n.kind, n.weight);
      v.id = n.id;
      v.label = n.label;
      v.kind = n.kind;
      v.weight = n.weight;
      v.flash = 0;
      v.seed = hashStr("seed|" + n.id);
      net.nodes.push(v);
      net.byId[n.id] = v;
    }

    // ghost nodes keep the web readable when the host model is tiny
    if (net.nodes.length < 4) {
      for (i = net.nodes.length; i < 4; i++) {
        v = placeNode("ghost|" + i, "agent", 0.35);
        v.id = "ghost|" + i;
        v.label = "";
        v.kind = "agent";
        v.weight = 0.35;
        v.flash = 0;
        v.seed = hashStr(v.id);
        net.nodes.push(v);
        net.byId[v.id] = v;
      }
    }

    // satellites (tiny dust nodes around each real node)
    var satMax = 130;
    for (i = 0; i < net.nodes.length && net.sats.length < satMax; i++) {
      v = net.nodes[i];
      var cnt = 2 + (hashStr("sc|" + v.id) > 0.55 ? 1 : 0);
      for (k = 0; k < cnt && net.sats.length < satMax; k++) {
        h1 = hashStr("s" + k + "|" + v.id);
        h2 = hashStr("sa" + k + "|" + v.id);
        ang = h2 * TAU;
        rad = (7 + h1 * 26) * S;
        net.sats.push({
          x: v.x + Math.cos(ang) * rad,
          y: v.y + Math.sin(ang) * rad * 0.85,
          a: 0.10 + h1 * 0.22,
          parent: i
        });
      }
    }

    // background dust
    var rng = makeRng(0x51f7a1);
    for (i = 0; i < 58; i++) {
      net.dust.push({
        x: (0.02 + rng() * 0.46) * W,
        y: (0.06 + rng() * 0.78) * H,
        a: 0.05 + rng() * 0.10
      });
    }

    // model links
    for (i = 0; i < links.length; i++) {
      var L = links[i];
      if (!L) continue;
      var aN = net.byId[L.from];
      var bN = net.byId[L.to];
      if (!aN || !bN || aN === bN) continue;
      addEdge(aN.x, aN.y, bN.x, bN.y, (hashStr("lb|" + i) - 0.5) * 0.42,
        0.10 + hashStr("la|" + i) * 0.14, hashStr("lh|" + i) < 0.18);
    }

    // everything converges into two bloom hubs, like the reference
    for (i = 0; i < net.nodes.length; i++) {
      v = net.nodes[i];
      var hub = HUBS[i > 0 && hashStr("hb|" + v.id) > 0.5 ? 1 : 0] || HUBS[0];
      addEdge(v.x, v.y, hub.x, hub.y, (v.seed - 0.5) * 0.75, 0.075 + v.seed * 0.075, v.seed > 0.82);
    }

    // extra node-to-node web
    var extra = Math.min(64, Math.max(10, Math.round(net.nodes.length * 1.6)));
    for (i = 0; i < extra; i++) {
      var ai = Math.floor(hashStr("pa|" + i) * net.nodes.length);
      var bi = Math.floor(hashStr("pb|" + i) * net.nodes.length);
      if (ai === bi) bi = (bi + 1) % net.nodes.length;
      var A = net.nodes[ai], B = net.nodes[bi];
      addEdge(A.x, A.y, B.x, B.y, (hashStr("pbow|" + i) - 0.5) * 0.85,
        0.05 + hashStr("pga|" + i) * 0.085, false);
    }

    // satellite hairlines back to their parent
    for (i = 0; i < net.sats.length; i++) {
      var sa = net.sats[i];
      var pv = net.nodes[sa.parent];
      if (pv) addEdge(pv.x, pv.y, sa.x, sa.y, (hashStr("sb|" + i) - 0.5) * 0.5, 0.05, false);
    }

    // spokes that bridge the network into the dial inner edge
    for (i = 0; i < 18; i++) {
      var hub2 = HUBS[i % HUBS.length] || HUBS[0];
      if (!hub2) break;
      ang = -1.16 + hashStr("spa|" + i) * 2.02;
      var f = 0.855 + hashStr("spf|" + i) * 0.05;
      dialPoint(f, ang, _p);
      addEdge(hub2.x, hub2.y, _p.x, _p.y, (hashStr("spb|" + i) - 0.5) * 0.5,
        0.06 + hashStr("spg|" + i) * 0.085, hashStr("sph|" + i) < 0.3);
    }

    // long sweeping depth arcs across the left field
    for (i = 0; i < 8; i++) {
      var ax = (0.06 + hashStr("l1|" + i) * 0.34) * W;
      var ay = (0.08 + hashStr("l2|" + i) * 0.72) * H;
      var bx = (0.05 + hashStr("l3|" + i) * 0.38) * W;
      var by = (0.10 + hashStr("l4|" + i) * 0.72) * H;
      addEdge(ax, ay, bx, by, 0.55 + hashStr("l5|" + i) * 0.55, 0.04 + hashStr("l6|" + i) * 0.03, false);
    }

    // bucket curves into four batched strokes
    net.pathsReady = (typeof Path2D === "function");
    net.pDim = net.pMid = net.pHot = net.pWhite = null;
    if (net.pathsReady) {
      net.pDim = new Path2D();
      net.pMid = new Path2D();
      net.pHot = new Path2D();
      net.pWhite = new Path2D();
      for (i = 0; i < net.edges.length; i++) {
        var e = net.edges[i];
        var pth = e.white ? net.pWhite : (e.hot ? net.pHot : (e.a > 0.115 ? net.pMid : net.pDim));
        pth.moveTo(e.x1, e.y1);
        pth.quadraticCurveTo(e.cx1, e.cy1, e.x2, e.y2);
      }
    }

    // beads sitting on brighter edges
    for (i = 0; i < net.edges.length && net.beads.length < 110; i++) {
      var eb2 = net.edges[i];
      if (!eb2.hot && eb2.a < 0.085) continue;
      var tt = 0.25 + hashStr("bead|" + i) * 0.5;
      var mt = 1 - tt;
      net.beads.push({
        x: mt * mt * eb2.x1 + 2 * mt * tt * eb2.cx1 + tt * tt * eb2.x2,
        y: mt * mt * eb2.y1 + 2 * mt * tt * eb2.cy1 + tt * tt * eb2.y2,
        b: hashStr("bb|" + i) > 0.5 ? 1 : 0
      });
    }

    // resettle travellers on the new edge set
    var en = net.edges.length;
    for (i = 0; i < trav.length; i++) {
      trav[i].ei = en ? ((i * 7 + 3) % en) : 0;
      trav[i].p = hashStr("tp|" + i);
      trav[i].boost = 0;
    }
  }

  // ---------------- pulse events ------------------------------------------
  function handlePulses(list) {
    if (!list || !list.length) return;
    var start = Math.max(0, list.length - 40);
    for (var i = start; i < list.length; i++) {
      var p = list[i];
      if (!p || typeof p !== "object") continue;
      var id = (p.id === 0 || p.id) ? String(p.id) : "";
      if (!id || seen[id]) continue;
      seen[id] = 1;
      seenCount++;
      if (seenCount > 320) { seen = {}; seenCount = 0; }
      triggerPulse(id);
    }
  }

  function triggerPulse(id) {
    var si = Math.floor(hashStr("pc|" + id) * CARD_N) % CARD_N;
    var s = cardSlots[si];
    if (s) s.flash = 1;

    if (net.nodes.length) {
      var ni = Math.floor(hashStr("pn|" + id) * net.nodes.length) % net.nodes.length;
      var nd = net.nodes[ni];
      if (nd) nd.flash = 1;
    }

    if (trav.length && net.edges.length) {
      var tv = trav[(pulseTrav++) % trav.length];
      tv.ei = Math.floor(hashStr("pe|" + id) * net.edges.length) % net.edges.length;
      tv.p = 0.02;
      tv.boost = 1;
    }

    spawnSparkBurst(id);
  }

  function spawnSparkBurst(id) {
    if (!sparks.length || !ANCHORS.length) return;
    var a = ANCHORS[Math.floor(hashStr("sp|" + id) * ANCHORS.length) % ANCHORS.length];
    for (var k = 0; k < 3; k++) {
      var sp = sparks[sparkCursor++ % sparks.length];
      if (!sp) continue;
      sp.x = a.x + (Math.random() - 0.5) * 44 * S;
      sp.y = a.y + (Math.random() - 0.5) * 30 * S;
      sp.vx = (24 + Math.random() * 170) * S;
      sp.vy = (Math.random() - 0.5) * 44 * S;
      sp.max = 0.5 + Math.random() * 0.85;
      sp.life = sp.max;
      sp.on = true;
    }
  }

  // ---------------- L4: streak / comet / spark systems --------------------
  function initParticles() {
    if (!usable) return;
    var i;
    if (parts.length !== MAXP) {
      parts = [];
      for (i = 0; i < MAXP; i++) {
        parts.push({ x: 0, y: 0, dirx: 1, diry: 0, len: 0, sp: 0, a: 0, vis: 1, on: false, hero: false, hue: 0 });
      }
    }
    for (i = 0; i < MAXP; i++) parts[i].on = false;
    partCount = 0;

    if (trav.length !== TRAV_N) {
      trav = [];
      for (i = 0; i < TRAV_N; i++) {
        trav.push({ ei: 0, p: Math.random(), sp: 0.2 + Math.random() * 0.25, boost: 0 });
      }
    }
    var en = net.edges.length;
    for (i = 0; i < trav.length; i++) {
      trav[i].ei = en ? ((i * 5 + 1) % en) : 0;
      trav[i].p = hashStr("tp|" + i);
      trav[i].boost = 0;
    }

    comets.length = 0;
    for (i = 0; i < COMET_N; i++) comets.push(resetComet({}));

    sparks.length = 0;
    for (i = 0; i < SPARK_N; i++) {
      sparks.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, on: false });
    }
    for (i = 0; i < 14; i++) spawnSparkBurst("seed|" + i);
  }

  function particleCount() {
    var base = reduced ? 340 : 520;
    var span = reduced ? 120 : 580;
    return Math.round(base + clamp01(intensity) * span);
  }

  // pick a streak hue from the weighted console mix (cyan dominant)
  function pickHue() {
    var r = Math.random();
    var acc = 0;
    for (var i = 0; i < HUE_WEIGHTS.length - 1; i++) {
      acc += HUE_WEIGHTS[i];
      if (r <= acc) return i;
    }
    return HUE_WEIGHTS.length - 1;
  }

  function calmMask(y) {
    var bottom = H * 0.842;
    var m = 1;
    if (y > bottom - H * 0.115) m = clamp01((bottom - y) / (H * 0.115));
    if (y < H * 0.028) m *= clamp(y / (H * 0.028), 0.25, 1);
    return m;
  }

  function calmMaskX(x) {
    var left = W * 0.135;
    if (x >= left) return 1;
    return clamp01(x / left);
  }

  // ---- V4 ray emission: every card is a nozzle ---------------------------
  // Continuous streak particles respawn at a rotating card's OUTER end and fly
  // along that card's outward radial normal (with a small fan).  rayCards is
  // rebuilt every frame in layoutCards() and only contains cards that are
  // bright enough and not pointing into the calm rails.
  function pickRayCard() {
    var m = rayCards.length;
    if (!m) return null;
    var s = rayCards[(Math.random() * m) | 0];
    // bias the fan toward the bright near-side cards
    if (Math.random() > 0.30 + 0.70 * s.alpha) {
      s = rayCards[(Math.random() * m) | 0];
    }
    return s;
  }

  function spawnStreak(p) {
    var s = pickRayCard();
    if (!s) {
      // fallback (before the first layout pass): right edge of the dial
      p.x = cx + ea;
      p.y = cy + (Math.random() - 0.5) * H * 0.35;
      p.dirx = 1;
      p.diry = (Math.random() - 0.5) * 0.10;
      p.len = (80 + Math.pow(Math.random(), 1.6) * 520) * S;
      p.sp = (440 + Math.random() * 1300) * S;
      p.a = 0.30 + Math.random() * 0.62;
      p.hue = pickHue();
      p.hero = p.hue < 2 && Math.random() < 0.06;
      p.on = true;
      return;
    }
    // direction = the card's outward radial normal, fanned a few degrees
    var spread = (Math.random() - 0.5) * 0.15;
    var cs = Math.cos(spread), sn = Math.sin(spread);
    p.dirx = s.dirx * cs - s.diry * sn;
    p.diry = s.dirx * sn + s.diry * cs;
    // start just inside the card's outer end so the ray appears to leave the box
    var outDist = s.radLen - 2 * S + Math.random() * 10 * S;
    p.x = s.px + s.dirx * outDist;
    p.y = s.py + s.diry * outDist;
    p.len = (80 + Math.pow(Math.random(), 1.55) * 620) * S * (0.72 + 0.5 * intensity);
    p.sp = (360 + Math.random() * 1500) * S * (0.85 + intensity * 0.5);
    p.a = 0.30 + Math.random() * 0.62;
    p.hue = pickHue();
    // hero glow only on the cyan-dominant hues, so accents stay sparse
    p.hero = p.hue < 2 && Math.random() < 0.055;
    p.on = true;
  }

  function resetComet(c) {
    var s = pickRayCard();
    var dx = 1, dy = 0, ox = cx + ea, oy = cy;
    if (s) {
      dx = s.dirx;
      dy = s.diry;
      ox = s.px + s.dirx * s.radLen;
      oy = s.py + s.diry * s.radLen;
    }
    var spread = (Math.random() - 0.5) * 0.10;
    var cs = Math.cos(spread), sn = Math.sin(spread);
    c.dirx = dx * cs - dy * sn;
    c.diry = dx * sn + dy * cs;
    c.len = (320 + Math.random() * 820) * S;
    c.h = (24 + Math.random() * 80) * S;
    c.sp = (80 + Math.random() * 300) * S;
    c.x = ox + c.dirx * 6 * S;
    c.y = oy + c.diry * 6 * S;
    c.a = 0.10 + Math.random() * 0.16;
    // 76% cyan, 14% warm, 10% violet — sparse hue accents
    var v = Math.random();
    c.variant = v < 0.76 ? 0 : (v < 0.90 ? 1 : 2);
    c.on = true;
    return c;
  }

  function updateCamera() {
    var k = reduced ? 0.18 : 1;
    camX = (Math.sin(t * 0.073) * 6 + Math.sin(t * 0.027 + 1.3) * 10) * k;
    camY = (Math.sin(t * 0.051 + 0.7) * 5 + Math.cos(t * 0.019) * 7) * k;
    camRot = Math.sin(t * 0.021) * 0.0032 * k;
  }

  function updateParticles(dt) {
    var i, p;
    var count = clamp(particleCount(), 0, MAXP);
    partCount = count;
    var spd = (0.62 + intensity * 0.95) * (reduced ? 0.55 : 1) * (1 - 0.55 * engageEase);
    for (i = 0; i < count; i++) {
      p = parts[i];
      if (!p.on) spawnStreak(p);
      p.x += p.dirx * p.sp * dt * spd;
      p.y += p.diry * p.sp * dt * spd;
      var tx = p.x - p.dirx * p.len;
      var ty = p.y - p.diry * p.len;
      if (tx < -W * 0.18 || tx > W * 1.18 || ty < -H * 0.18 || ty > H * 1.18) spawnStreak(p);
      p.vis = calmMask(p.y) * calmMaskX(p.x) * (0.58 + intensity * 0.6) *
        (1 - 0.55 * engageEase);
    }

    for (i = 0; i < comets.length; i++) {
      var cm = comets[i];
      if (!cm.on) { resetComet(cm); continue; }
      var cspd = (0.7 + intensity * 0.6) * (1 - 0.55 * engageEase);
      cm.x += cm.dirx * cm.sp * dt * cspd;
      cm.y += cm.diry * cm.sp * dt * cspd;
      var ctailX = cm.x - cm.dirx * cm.len;
      var ctailY = cm.y - cm.diry * cm.len;
      if (ctailX < -W * 0.2 || ctailX > W * 1.2 ||
        ctailY < -H * 0.2 || ctailY > H * 1.2) resetComet(cm);
    }

    for (i = 0; i < sparks.length; i++) {
      var sp = sparks[i];
      if (!sp.on) continue;
      sp.life -= dt;
      if (sp.life <= 0) { sp.on = false; continue; }
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vy += 26 * S * dt;
    }

    for (i = 0; i < cardSlots.length; i++) {
      var cs = cardSlots[i];
      if (cs && cs.flash > 0.004) cs.flash = Math.max(0, cs.flash - dt * 2.6);
    }

    for (i = 0; i < net.nodes.length; i++) {
      var nd = net.nodes[i];
      if (nd.flash > 0.004) nd.flash = Math.max(0, nd.flash - dt * 2.3);
    }

    var edgeN = net.edges.length;
    for (i = 0; i < trav.length; i++) {
      var tv = trav[i];
      if (!edgeN) break;
      var boost = tv.boost > 0.2;
      tv.p += (0.14 + tv.sp * 0.5) * dt * (0.8 + intensity * 0.8) * (boost ? 2.4 : 1);
      if (tv.p >= 1) {
        tv.p -= 1;
        tv.ei = (Math.random() * edgeN) | 0;
        if (tv.boost > 0) tv.boost = Math.max(0, tv.boost - 0.5);
      }
      if (tv.boost > 0) tv.boost = Math.max(0, tv.boost - dt * 1.1);
    }
  }

  // ---------------- draw: transforms & L0 --------------------------------
  function beginLayer(k, rotK) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!k && !rotK) return;
    ctx.translate(W * 0.5 + camX * k, H * 0.5 + camY * k);
    if (rotK) ctx.rotate(camRot * rotK);
    ctx.translate(-W * 0.5, -H * 0.5);
  }

  function quadPoint(e, tt, out) {
    var mt = 1 - tt;
    out.x = mt * mt * e.x1 + 2 * mt * tt * e.cx1 + tt * tt * e.x2;
    out.y = mt * mt * e.y1 + 2 * mt * tt * e.cy1 + tt * tt * e.y2;
    return out;
  }

  function drawBackground() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (bgCanvas) {
      ctx.drawImage(bgCanvas, 0, 0, W, H);
    } else {
      ctx.fillStyle = rgbaA(COL.bg, 1);
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------- draw: L1 network --------------------------------------
  function drawNetwork() {
    if (!usable || !net.nodes.length) return;
    beginLayer(0.58, 0);
    ctx.lineCap = "round";
    var i, nd, e, kk, kindKey;

    // ---- blue hairline web (#569cd6), cyan highlights for hot curves
    if (net.pathsReady && net.pDim) {
      ctx.strokeStyle = STY.edgeDim;
      ctx.lineWidth = Math.max(0.5, 0.55 * S);
      ctx.stroke(net.pDim);
      ctx.strokeStyle = STY.edgeMid;
      ctx.lineWidth = Math.max(0.6, 0.68 * S);
      ctx.stroke(net.pMid);
      ctx.strokeStyle = STY.edgeHot;
      ctx.lineWidth = Math.max(0.7, 0.85 * S);
      ctx.stroke(net.pHot);
      ctx.strokeStyle = STY.edgeSoft;
      ctx.lineWidth = Math.max(0.6, 0.7 * S);
      ctx.stroke(net.pWhite);
    } else {
      // Path2D-free fallback
      for (i = 0; i < net.edges.length; i++) {
        e = net.edges[i];
        ctx.strokeStyle = e.hot ? STY.edgeHot : (e.a > 0.115 ? STY.edgeMid : STY.edgeDim);
        ctx.lineWidth = e.hot ? 0.85 : 0.6;
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.quadraticCurveTo(e.cx1, e.cy1, e.x2, e.y2);
        ctx.stroke();
      }
    }

    // ---- background dust (neutral)
    var dustW = Math.max(1, 1.1 * S * 0.8);
    ctx.fillStyle = STY.dust;
    ctx.beginPath();
    for (i = 0; i < net.dust.length; i++) ctx.rect(net.dust[i].x, net.dust[i].y, dustW, dustW);
    ctx.fill();

    // ---- satellites, batched per parent kind (colour language on the left)
    var satW = Math.max(1.2, 1.6 * S * 0.9);
    for (kk = 0; kk < KIND_KEYS.length; kk++) {
      kindKey = KIND_KEYS[kk];
      ctx.fillStyle = rgbaA(COL[KIND_COLOR[kindKey]], 0.30);
      ctx.beginPath();
      for (i = 0; i < net.sats.length; i++) {
        var st = net.sats[i];
        var pn = net.nodes[st.parent];
        if (!pn || pn.kind !== kindKey || st.a < 0.17) continue;
        ctx.rect(st.x, st.y, satW, satW);
      }
      ctx.fill();
      ctx.fillStyle = rgbaA(COL[KIND_COLOR[kindKey]], 0.16);
      ctx.beginPath();
      for (i = 0; i < net.sats.length; i++) {
        var st2 = net.sats[i];
        var pn2 = net.nodes[st2.parent];
        if (!pn2 || pn2.kind !== kindKey || st2.a >= 0.17) continue;
        ctx.rect(st2.x, st2.y, satW * 0.85, satW * 0.85);
      }
      ctx.fill();
    }

    // ---- beads on brighter edges
    ctx.fillStyle = STY.beadA;
    ctx.beginPath();
    for (i = 0; i < net.beads.length; i++) {
      var bd = net.beads[i];
      if (!bd.b) ctx.rect(bd.x, bd.y, 1.5, 1.5);
    }
    ctx.fill();
    ctx.fillStyle = STY.beadB;
    ctx.beginPath();
    for (i = 0; i < net.beads.length; i++) {
      var bd2 = net.beads[i];
      if (bd2.b) ctx.rect(bd2.x, bd2.y, 1.6, 1.6);
    }
    ctx.fill();

    // ---- node glows: each kind gets its own hue
    for (i = 0; i < net.nodes.length; i++) {
      nd = net.nodes[i];
      var spr = KIND_GLOW[nd.kind] || KIND_GLOW.agent;
      if (!spr) continue;
      var gs = ((nd.kind === "agent" ? 32 : 22) * S + nd.weight * 10 * S);
      if (nd.flash > 0.01) gs *= 1 + nd.flash * 1.3;
      ctx.globalAlpha = clamp01(0.34 + nd.weight * 0.22 + nd.flash * 0.50);
      ctx.drawImage(spr, nd.x - gs * 0.5, nd.y - gs * 0.5, gs, gs);
    }
    ctx.globalAlpha = 1;

    // ---- node cores, batched per kind
    for (kk = 0; kk < KIND_KEYS.length; kk++) {
      kindKey = KIND_KEYS[kk];
      ctx.fillStyle = KIND_CORE[kindKey] || KIND_CORE.agent;
      ctx.beginPath();
      for (i = 0; i < net.nodes.length; i++) {
        nd = net.nodes[i];
        if (nd.kind !== kindKey) continue;
        var csz = (nd.kind === "agent" ? 2.1 : 1.6) * Math.max(0.8, S);
        ctx.rect(nd.x - csz * 0.5, nd.y - csz * 0.5, csz, csz);
      }
      ctx.fill();
    }

    // ---- labels in the node's own kind hue (crisp, small)
    if (F_LABEL) {
      ctx.font = F_LABEL;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      var lab = 0;
      for (i = 0; i < net.nodes.length && lab < 10; i++) {
        nd = net.nodes[i];
        if (!nd.label) continue;
        ctx.fillStyle = rgbaA(COL[KIND_COLOR[nd.kind] || "fgDim"], 0.55);
        ctx.fillText(clipStr(nd.label, 14), nd.x + 8 * S, nd.y - 5 * S);
        lab++;
      }
    }

    // ---- travelling pulses (cyan) + hub blooms (cyan anchor / violet counter)
    var edgeN = net.edges.length;
    if (edgeN) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = STY.travTail;
      ctx.lineWidth = Math.max(0.7, 0.9 * S);
      ctx.beginPath();
      for (i = 0; i < trav.length; i++) {
        var tv = trav[i];
        var ed = net.edges[tv.ei % edgeN];
        if (!ed) continue;
        var p1 = tv.p;
        var p0 = Math.max(0, p1 - 0.07);
        quadPoint(ed, p0, _p);
        quadPoint(ed, p1, _n);
        ctx.moveTo(_p.x, _p.y);
        ctx.lineTo(_n.x, _n.y);
      }
      ctx.stroke();

      ctx.fillStyle = STY.travHead;
      ctx.beginPath();
      for (i = 0; i < trav.length; i++) {
        var tv2 = trav[i];
        var ed2 = net.edges[tv2.ei % edgeN];
        if (!ed2) continue;
        quadPoint(ed2, tv2.p, _p);
        var hs = (2.2 + tv2.boost * 2.8) * Math.max(0.9, S);
        ctx.rect(_p.x - hs * 0.5, _p.y - hs * 0.5, hs, hs);
      }
      ctx.fill();

      // hub blooms
      for (i = 0; i < HUBS.length; i++) {
        var hub = HUBS[i];
        var hubSpr = i === 0 ? GLOW.cyan : GLOW.violet;
        var ha = 0.15 + 0.05 * Math.sin(t * 1.2 + hub.ph) + intensity * 0.05;
        var hsz = Math.min(W, H) * 0.16;
        if (hubSpr) {
          ctx.globalAlpha = clamp01(ha);
          ctx.drawImage(hubSpr, hub.x - hsz * 0.5, hub.y - hsz * 0.5, hsz, hsz);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = STY.hubRing;
      ctx.lineWidth = Math.max(0.6, 0.75 * S);
      for (i = 0; i < HUBS.length; i++) {
        var h2 = HUBS[i];
        ctx.beginPath();
        ctx.arc(h2.x, h2.y, 15 * S, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h2.x, h2.y, 22 * S, t * 0.5 + i, t * 0.5 + i + 1.7);
        ctx.stroke();
      }
    } else {
      // still show hub blooms when there are no edges at all
      ctx.globalCompositeOperation = "lighter";
      for (i = 0; i < HUBS.length; i++) {
        var hb = HUBS[i];
        var hbSpr = i === 0 ? GLOW.cyan : GLOW.violet;
        var hsz2 = Math.min(W, H) * 0.16;
        if (hbSpr) {
          ctx.globalAlpha = clamp01(0.15 + intensity * 0.05);
          ctx.drawImage(hbSpr, hb.x - hsz2 * 0.5, hb.y - hsz2 * 0.5, hsz2, hsz2);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------------- V4.2/V4.3: rotating carousel phase ---------------------
  // One phase drives cards + band necklace + radar sweep.  Idle ≈0.27 rad/s
  // (~23 s/turn).  Selecting a hub memory eases the whole ring from idle spin
  // down to a slow readable hover (0.03 rad/s).  If that memory carries a
  // cardId (HUD memory↔card link), the ring is also swung along the shortest
  // angular path so the linked card parks at LINK_TARGET_ANGLE (near/front,
  // fully readable), then holds there with a tiny idle drift.
  function updateRing(dt) {
    var i, s;
    // ---- resolve the memory→card link for the current selection
    var mem = activeNode;
    if (!mem && activeId != null) {
      for (i = 0; i < memNodes.length; i++) {
        if (memNodes[i].id === activeId) { mem = memNodes[i]; break; }
      }
    }
    var wantCard = -1;
    if (mem && mem.cardId) {
      for (i = 0; i < CARD_N; i++) {
        s = cardSlots[i];
        if (s && s.card && String(s.card.id).toLowerCase() === mem.cardId) {
          wantCard = i;
          break;
        }
      }
    }
    var prevLink = linkCard;
    if (wantCard !== linkCard) {
      if (wantCard >= 0) {
        // start a decelerating swing toward the readable near/front spot
        linkCard = wantCard;
        var slotAng = (TAU * wantCard) / CARD_N +
          ((cardSlots[wantCard] && cardSlots[wantCard].jAng) || 0);
        var targetPhase = wrapPi(LINK_TARGET_ANGLE - slotAng);
        var delta = wrapPi(targetPhase - ringPhase);
        var T = clamp(0.55 + Math.abs(delta) * 0.62 + (reduced ? 0.2 : 0), 1.2, 1.8);
        // start tangent continuity: keep the current measured spin; only trim
        // it when it would overshoot the (shortest-path) swing.  This removes
        // the old velocity kick at the start of the trip.
        var v0 = clamp(ringVel, -1.6, 1.6);
        if (delta === 0) {
          v0 = 0;
        } else {
          var maxV = (Math.abs(delta) + 0.05) / T;
          if (Math.abs(v0) > maxV) v0 = (v0 < 0 ? -1 : 1) * maxV;
        }
        linkTrip.on = true;
        linkTrip.t = 0;
        linkTrip.from = ringPhase;
        linkTrip.delta = delta;
        linkTrip.v0 = v0;
        linkTrip.dur = T;
        linkFlash = 0;
        focusCard = wantCard;
      } else {
        linkTrip.on = false;
        // release the focus only if it came from the memory link (a card click
        // must keep its own focus); memory-selection changes clear it
        if (prevLink >= 0 && focusCard === prevLink &&
          (activeId != null || activeNode)) focusCard = -1;
        linkCard = -1;
        linkFlash = 0;
      }
    }

    // ---- inspect mode: hub-memory selection / card focus / cloud drag
    engageTarget = (activeId != null || activeNode || focusCard >= 0 ||
      linkCard >= 0 || cloud.drag) ? 1 : 0;
    engage += (engageTarget - engage) * Math.min(1, dt * 3.2);
    if (engage < 0.002) engage = 0;
    engage = clamp01(engage);
    engageEase = engage * engage * (3 - 2 * engage);   // smoothstep

    var prevPhase = ringPhase;
    if (linkCard >= 0) {
      if (linkTrip.on) {
        // cubic Hermite: starts with the current ring velocity, decelerates
        // into the target spot (no snap) over dur ∈ [1.2, 1.8] s.
        //   p(u) = from + delta·(3u²−2u³) + v0·T·(u³−2u²+u)
        //   p'(u) = delta·(6u−6u²)/T + v0·(3u²−4u+1)  (v0 at u=0, 0 at u=1)
        linkTrip.t += dt;
        var u = clamp01(linkTrip.t / linkTrip.dur);
        var e = 3 * u * u - 2 * u * u * u;      // smoothstep 0 → 1
        var h10 = u * u * u - 2 * u * u + u;
        ringPhase = wrapPi(linkTrip.from + linkTrip.delta * e +
          linkTrip.v0 * linkTrip.dur * h10);
        // V4.4: ONE phase writer while the trip is active; ringSpeed carries the
        // Hermite tangent so release/arrival never jumps
        ringSpeed = (linkTrip.delta * (6 * u - 6 * u * u)) / linkTrip.dur +
          linkTrip.v0 * (3 * u * u - 4 * u + 1);
        if (u >= 1) {
          linkTrip.on = false;
          ringPhase = wrapPi(linkTrip.from + linkTrip.delta);
          ringSpeed = 0;                      // arrive at rest, then hold
          ringVel = 0;
          linkFlash = 1;                     // arrival pulse
          var fs = cardSlots[linkCard];
          if (fs) fs.flash = 1;              // brief card flash
        }
      } else {
        // hold near the readable spot: only a tiny idle drift (±0.6°)
        var holdTarget = wrapPi(linkTrip.from + linkTrip.delta +
          Math.sin(t * 0.35) * 0.010);
        var dh = wrapPi(holdTarget - ringPhase);
        ringPhase = wrapPi(ringPhase + dh * Math.min(1, dt * 3.0));
        ringSpeed = 0;
      }
    } else {
      var idle = 0.27 * (0.90 + intensity * 0.20) + Math.sin(t * 0.07) * 0.03;
      if (reduced) idle *= 0.5;
      // any memory/card selection eases the ring toward the hover speed
      var targetSpeed = idle * (1 - engageEase) + 0.03 * engageEase;
      ringSpeed += (targetSpeed - ringSpeed) * Math.min(1, dt * 3.6);
      ringPhase += ringSpeed * ringDir * dt;
    }
    if (ringPhase > TAU) ringPhase -= TAU;
    else if (ringPhase < 0) ringPhase += TAU;
    ringVel = clamp(wrapPi(ringPhase - prevPhase) / Math.max(1e-4, dt), -3.5, 3.5);
    if (linkFlash > 0.004) linkFlash = Math.max(0, linkFlash - dt * 1.7);
  }

  // ---------------- draw: L2/L3 rotating card corona -----------------------
  // Full-circle projection around the dial ellipse.  Cards are radial paddles:
  //   centre  = dialPoint(CARD_F, θ)
  //   long axis = outward normal R(θ) = dialNormal(θ)
  //   tangent   = dialNormal(θ) rotated 90°
  // Depth d = cos(θ − RING_NEAR) drives perspective:
  //   persp = D/(D − 0.62·d)              (D=2.3 → ~0.79 far … 1.37 near)
  //   radial scale  sx = persp·(0.985 + 0.015·k)   k = (d+1)/2
  //   tangential sy = persp·(0.94 + 0.06·k)        (near-rectangular boxes)
  //   alpha = deck·(0.10 + 0.78·smoothstep(−0.55, 0.98, d)), calm-masked
  // deck: real model cards 1.0, synthetic filler cards a single uniform 0.55;
  // jitter is a whisper (jAng ±0.008, jRad ±0.004, scale ±1 %, wobble 0.001) so
  // the corona reads as a tidy arc.  Positions are cached for drawing/hit tests.
  function layoutCards() {
    var D = 2.3;
    var cs = Math.cos(ROT), sn = Math.sin(ROT);
    cardOrder.length = 0;
    rayCards.length = 0;
    nozzleCards.length = 0;
    var calmLeft = W * 0.135;
    var calmBottom = H * 0.86;
    for (var i = 0; i < CARD_N; i++) {
      var s = cardSlots[i];
      if (!s) continue;
      // continuous carousel angle + a whisper of per-card variation
      var phi = cardPhaseAngle(i) + s.jAng +
        Math.sin(t * 0.6 + s.seed * TAU) * 0.001;
      var f = CARD_F + s.jRad;
      var ca = ea * f * Math.cos(phi), sa = eb * f * Math.sin(phi);
      s.px = cx + ca * cs - sa * sn;
      s.py = cy + ca * sn + sa * cs;
      // outward radial normal = card long axis (base space, includes dial tilt)
      var nx = Math.cos(phi) / ea, ny = Math.sin(phi) / eb;
      var nl = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= nl; ny /= nl;
      s.dirx = nx * cs - ny * sn;
      s.diry = nx * sn + ny * cs;
      s.rot = Math.atan2(s.diry, s.dirx);
      // depth & perspective
      var d = Math.cos(phi - RING_NEAR);
      var k = 0.5 + 0.5 * d;
      var persp = D / (D - 0.62 * d);
      s.depth = d;
      // near-uniform scale keeps the boxes rectangles (no parallelogram skew);
      // depth still shrinks far-side cards a little
      s.sx = persp * (0.985 + 0.015 * k) * s.jScale;
      s.sy = persp * (0.94 + 0.06 * k) * s.jScale;
      s.radLen = (s.w * 0.5) * s.sx;
      // V4.4: one uniform filler tone (no per-seed variance) + equal card size,
      // so synthetic neighbours line up instead of looking ragged
      var deck = s.real ? 1.0 : 0.55;
      var a = deck * (0.10 + 0.78 * smoothstep(-0.55, 0.98, d));
      if (i === focusCard) a = Math.min(1, a + 0.24);
      if (engageEase > 0.01 && focusCard >= 0 && i !== focusCard) {
        a *= 1 - 0.42 * engageEase;
      }
      // calm rails: never paint into the left rail; cards may extend behind the
      // bottom HUD strip but fade out as they reach it
      a *= calmMaskX(s.px) * clamp01((H * 0.95 - s.py) / (H * 0.09));
      s.alpha = clamp01(a);
      s.visible = s.alpha > 0.03 &&
        s.px > -W * 0.30 && s.px < W * 1.30 &&
        s.py > -H * 0.30 && s.py < H * 1.30;
      var outX = s.px + s.dirx * s.radLen;
      var outY = s.py + s.diry * s.radLen;
      // every visible bright card is a nozzle (pulse through the box)
      s.noz = s.visible && s.alpha > 0.16;
      // the outward streak fan only leaves cards facing the visible right arc
      s.ray = s.visible && s.alpha > 0.16 &&
        Math.abs(s.diry) < 0.72 &&
        outX > calmLeft && outX < W * 0.98 &&
        outY > 8 * S && outY < calmBottom;
      if (s.visible) cardOrder.push(s);
      if (s.ray) rayCards.push(s);
      if (s.noz) nozzleCards.push(s);
    }
    // painter's algorithm: far side first so near cards overlap correctly
    cardOrder.sort(function (a2, b2) { return a2.depth - b2.depth; });
  }

  function drawCards() {
    for (var k = 0; k < cardOrder.length; k++) drawCardSlot(cardOrder[k]);
  }

  function drawCardSlot(s) {
    if (!s || !s.canvas || !s.visible) return;
    var hovered = !!(hover && hover.type === "card" && s.card && hover.id === s.card.id);
    var focus = (s.slotIndex === focusCard) || hovered;
    // V4.3: a memory-linked card is lit while its memory is selected — soft
    // spotlight + an expanding arrival pulse ring when it reaches the spot
    if (s.slotIndex === linkCard) {
      var linkGlow = GLOW.cyan;
      if (linkGlow) {
        var lgs = Math.max(40 * S, s.w * s.sx * 1.45) * (1 + 0.25 * linkFlash);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = clamp01(0.26 + 0.60 * linkFlash) * Math.max(0.35, s.alpha);
        ctx.drawImage(linkGlow, s.px - lgs * 0.5, s.py - lgs * 0.5, lgs, lgs);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      if (linkFlash > 0.02) {
        var pr = s.w * s.sx * 0.5 + (1 - linkFlash) * 26 * S;
        ctx.strokeStyle = rgbaA(COL.nearWhite, 0.70 * linkFlash);
        ctx.lineWidth = Math.max(1, 1.5 * S);
        ctx.beginPath();
        ctx.arc(s.px, s.py, pr, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.save();
    ctx.translate(s.px, s.py);
    ctx.rotate(s.rot);
    ctx.scale(s.sx, s.sy);
    // no shear: the status boxes must stay axis-aligned rectangles under rotation
    ctx.transform(1, 0, 0, 1, 0, 0);
    if (focus) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.26 + 0.14 * Math.sin(t * 5.0);
      ctx.strokeStyle = rgbaA(COL.cyan, 0.85);
      ctx.lineWidth = Math.max(0.9, 1.0 * S) / Math.max(0.22, s.sx);
      ctx.strokeRect(-s.w * 0.5 - 2.5, -s.h * 0.5 - 2.5, s.w + 5, s.h + 5);
      ctx.globalAlpha = 0.055;
      ctx.fillStyle = rgbaA(COL.cyan, 0.9);
      ctx.fillRect(-s.w * 0.5 - 2.5, -s.h * 0.5 - 2.5, s.w + 5, s.h + 5);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
    if (s.flash > 0.02) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(0.7, s.flash * 0.6) * s.alpha;
      ctx.drawImage(s.canvas, -s.w * 0.5, -s.h * 0.5, s.w, s.h);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = s.alpha;
    ctx.drawImage(s.canvas, -s.w * 0.5, -s.h * 0.5, s.w, s.h);
    ctx.globalAlpha = 1;
    // live status pip, scaled with the card
    if (s.status === "run") {
      var pulse = 0.28 + 0.34 * Math.sin(t * 4.2 + s.slotIndex * 1.7);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgbaA(COL.cyan, pulse * s.alpha);
      ctx.fillRect(s.w * 0.5 - 3, -1.2, 2.0, 2.0);
      ctx.globalCompositeOperation = "source-over";
    } else if (s.status === "error") {
      var pulse2 = 0.22 + 0.32 * Math.sin(t * 3.1 + s.slotIndex);
      ctx.fillStyle = rgbaA(COL.alert, pulse2 * s.alpha);
      ctx.fillRect(-s.w * 0.5 + 1.4, -s.h * 0.5 + 1.4, 1.8, 1.8);
    }
    ctx.restore();
  }

  function drawReadout() {
    // upper interior, tucked left of the hero memory cloud so it stays clear
    var ang = -0.92, f = 0.56;
    var ca = ea * f * Math.cos(ang), sa = eb * f * Math.sin(ang);
    var cs = Math.cos(ROT), sn = Math.sin(ROT);
    var px = cx + ca * cs - sa * sn;
    var py = cy + ca * sn + sa * cs;

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = F_TINY;
    ctx.fillStyle = palA("fgMuted", 0.72);
    ctx.fillText("SCENE CLOCK // LOCAL", px, py - 27 * S);

    ctx.font = F_CLOCK;
    ctx.fillStyle = palA("fg", 0.70);
    var clk = model.clock;
    if (!clk) {
      // no host clock supplied: keep a self-consistent, slow scene time
      var total = 16 * 3600 + 3 * 60 + 41 + Math.floor(t);
      clk = pad2(Math.floor(total / 3600) % 24) + ":" +
        pad2(Math.floor(total / 60) % 60) + ":" + pad2(total % 60);
    }
    ctx.fillText(clk, px, py);

    var wpx = 124 * S;
    ctx.fillStyle = palA("border", 0.70);
    ctx.fillRect(px, py + 5 * S, wpx, 1);
    ctx.fillStyle = palA("blue", 0.42);
    for (var i = 0; i < 9; i++) {
      var tx = px + (i / 8) * wpx;
      ctx.fillRect(tx, py + 7 * S, 1, (i % 4 === 0) ? 5 * S : 2.6 * S);
    }

    ctx.font = F_TINY;
    ctx.fillStyle = model.mode === "LIVE" ? palA("teal", 0.78) : palA("amber", 0.78);
    ctx.fillText(model.mode === "LIVE" ? "LIVE FEED" : "SIMULATION", px, py + 27 * S);

    ctx.fillStyle = palA("blue", 0.30);
    for (i = 0; i < 6; i++) ctx.fillRect(px + wpx + 7 * S + i * 3.4 * S, py + 7 * S, 1.6 * S, 4 * S);
  }

  function drawRing() {
    if (!usable) return;
    beginLayer(1, 1);
    if (ringCanvas) ctx.drawImage(ringCanvas, ringBX, ringBY, ringBW, ringBH);

    // outer edge shimmer (cyan, scene-level mark only)
    ctx.globalCompositeOperation = "lighter";
    var sh = 0.05 + 0.028 * Math.sin(t * 1.7) + intensity * 0.05;
    ctx.strokeStyle = rgbaA(COL.cyan, sh);
    ctx.lineWidth = Math.max(1, 1.2 * S);
    ctx.beginPath();
    ctx.ellipse(cx, cy, ea, eb, ROT, -1.18, 1.18);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    // rotating rim highlight riding the same phase as the card carousel
    ctx.globalCompositeOperation = "lighter";
    var rimA = ringPhase + 0.9;
    for (var rk = 0; rk < 4; rk++) {
      var ra0 = rimA - 0.06 - rk * 0.06;
      ctx.strokeStyle = rgbaA(rk === 0 ? COL.nearWhite : COL.cyan, 0.30 - rk * 0.06);
      ctx.lineWidth = Math.max(1.2, (3.2 - rk * 0.5) * S);
      ctx.beginPath();
      ctx.ellipse(cx, cy, ea, eb, ROT, ra0, ra0 + 0.07);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    // rotating carousel (painter-sorted far -> near)
    drawCards();
    drawReadout();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ================= V4: interaction plumbing =============================
  // Camera-aware coordinate mapping: interactive layers are drawn through the
  // camera transform (translate + micro rotation about screen centre), so the
  // pointer must be mapped back into base space before hit testing.
  var _bs = { x: 0, y: 0 };
  var _sb = { x: 0, y: 0 };

  function baseToScreen(x, y, out) {
    var dx = x - W * 0.5, dy = y - H * 0.5;
    var cs = Math.cos(camRot), sn = Math.sin(camRot);
    out.x = W * 0.5 + dx * cs - dy * sn + camX;
    out.y = H * 0.5 + dx * sn + dy * cs + camY;
    return out;
  }

  function screenToBase(x, y, out) {
    var dx = x - W * 0.5 - camX;
    var dy = y - H * 0.5 - camY;
    var cs = Math.cos(-camRot), sn = Math.sin(-camRot);
    out.x = W * 0.5 + dx * cs - dy * sn;
    out.y = H * 0.5 + dx * sn + dy * cs;
    return out;
  }

  function inCloudZone(bx, by) {
    var dx = (bx - memC.x) / (memC.r * 1.98);
    var dy = (by - memC.y) / (memC.r * 1.66);
    return dx * dx + dy * dy <= 1;
  }

  function memColorKey(kind) { return MEM_COLOR[kind] || "cyan"; }

  // hit objects are only allocated when the hover target changes
  function makeHit(type, id, label, detail, bx, by) {
    baseToScreen(bx, by, _bs);
    return {
      type: type,
      id: (id == null) ? "" : String(id),
      label: label == null ? "" : String(label),
      detail: detail == null ? "" : String(detail),
      x: Math.round(_bs.x),
      y: Math.round(_bs.y)
    };
  }

  function emitHover(next) {
    var key = next ? (next.type + "|" + next.id) : "";
    if (key === hoverKey) return;
    hoverKey = key;
    hover = next;
    if (!onHoverCb) return;
    try {
      if (next) onHoverCb(next, Math.round(pointer.x), Math.round(pointer.y));
      else onHoverCb(null, Math.round(pointer.x), Math.round(pointer.y));
    } catch (e) { /* host callback must never break the scene */ }
  }

  function emitSelect(next) {
    if (!onSelectCb) return;
    try { onSelectCb(next || null); } catch (e) { /* ignore */ }
  }

  function updateCursor() {
    var mode = "default";
    if (pointer.down && cloud.drag) mode = "grabbing";
    else if (hover) mode = "pointer";
    else if (pointer.inside && inCloudZone(pointer.bx, pointer.by)) mode = "grab";
    if (mode === cursorMode) return;
    cursorMode = mode;
    try { if (canvas) canvas.style.cursor = mode; } catch (e) { /* ignore */ }
  }

  function updatePointer(e) {
    if (!canvas) return;
    var rect = null;
    try { rect = canvas.getBoundingClientRect(); } catch (e1) { rect = null; }
    var sx = Number(e.clientX) || 0;
    var sy = Number(e.clientY) || 0;
    if (rect && rect.width > 0 && rect.height > 0) {
      sx = (sx - rect.left) * (W / rect.width);
      sy = (sy - rect.top) * (H / rect.height);
    }
    pointer.x = sx;
    pointer.y = sy;
    pointer.has = true;
    pointer.inside = sx >= 0 && sy >= 0 && sx <= W && sy <= H;
    screenToBase(sx, sy, _sb);
    pointer.bx = _sb.x;
    pointer.by = _sb.y;
  }

  // ---- hit tests (base space) --------------------------------------------
  function hitMemoryNode() {
    var best = null, bestScore = -1e9;
    for (var i = 0; i < memNodes.length; i++) {
      var n = memNodes[i];
      var dx = pointer.bx - n.px, dy = pointer.by - n.py;
      var rr = Math.max(8 * S, n.r * 2.9);
      var d2 = dx * dx + dy * dy;
      if (d2 > rr * rr) continue;
      var score = n.depth + (1 - Math.sqrt(d2) / rr) * 0.35;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  function hitCardSlot() {
    for (var i = 0; i < CARD_N; i++) {
      var s = cardSlots[i];
      if (!s || !s.canvas || !s.visible || s.alpha < 0.10) continue;
      var dx = pointer.bx - s.px, dy = pointer.by - s.py;
      var cs = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0);
      // card local frame: +x = radial long axis, +y = tangential short axis
      var lx = (dx * cs + dy * sn) / Math.max(0.05, s.sx || 1);
      var ly = (-dx * sn + dy * cs) / Math.max(0.05, s.sy || 1);
      if (Math.abs(lx) <= s.w * 0.5 + 3 * S && Math.abs(ly) <= s.h * 0.5 + 3 * S) {
        return s;
      }
    }
    return null;
  }

  function updateHover() {
    if (!pointer.inside || !pointer.has) {
      emitHover(null);
      updateCursor();
      return;
    }
    if (pointer.down && pointer.moved > 6) {
      emitHover(null);
      updateCursor();
      return;
    }
    var mn = hitMemoryNode();
    if (mn) {
      emitHover(makeHit("memory", mn.id, mn.label, mn.detail, mn.px, mn.py));
      updateCursor();
      return;
    }
    var cd = hitCardSlot();
    if (cd && cd.card) {
      emitHover(makeHit("card", cd.card.id, cd.card.title, cd.card.line1, cd.px, cd.py));
      updateCursor();
      return;
    }
    emitHover(null);
    updateCursor();
  }

  // ---- selection ---------------------------------------------------------
  function selectMemory(node) {
    if (!node) return;
    activeId = node.id;
    activeNode = node;
    focusCard = -1;
    emitSelect(makeHit("memory", node.id, node.label, node.detail, node.px, node.py));
  }

  function selectCardSlot(s) {
    if (!s || !s.card) return;
    var idx = (s.slotIndex != null) ? s.slotIndex : cardSlots.indexOf(s);
    if (idx >= 0) {
      focusCard = idx;
      activeId = null;
      activeNode = null;
    }
    s.flash = 1;
    emitSelect(makeHit("card", s.card.id, s.card.title, s.card.line1, s.px, s.py));
  }

  function clearSelection() {
    activeId = null;
    activeNode = null;
    focusCard = -1;
    emitSelect(null);
  }

  // ---- pointer handlers --------------------------------------------------
  function onPointerDown(e) {
    if (disposed) return;
    try {
      updatePointer(e);
      pointer.down = true;
      pointer.moved = 0;
      pointer.downX = pointer.x;
      pointer.downY = pointer.y;
      pointer.pendingMemory = hitMemoryNode();
      pointer.pendingCard = pointer.pendingMemory ? null : hitCardSlot();
      cloud.drag = false;
      cloud.yawVel = 0;
      cloud.pitchVel = 0;
      if (inCloudZone(pointer.bx, pointer.by)) {
        cloud.drag = true;
        try {
          if (canvas.setPointerCapture && e.pointerId != null) canvas.setPointerCapture(e.pointerId);
        } catch (e1) { /* ignore */ }
        if (typeof e.preventDefault === "function") e.preventDefault();
      }
      updateHover();
    } catch (err) { /* ignore */ }
  }

  function onPointerMove(e) {
    if (disposed) return;
    try {
      var prevX = pointer.x, prevY = pointer.y;
      updatePointer(e);
      if (pointer.down) {
        var dx = pointer.x - prevX;
        var dy = pointer.y - prevY;
        pointer.moved += Math.abs(dx) + Math.abs(dy);
        if (cloud.drag && pointer.moved > 2) {
          cloud.yaw += dx * 0.011;
          cloud.pitch = clamp(cloud.pitch + dy * 0.008, -0.85, 0.85);
          cloud.yawVel = dx * 0.12;
          cloud.pitchVel = dy * 0.09;
        }
      }
      updateHover();
    } catch (err) { /* ignore */ }
  }

  function onPointerUp(e) {
    if (disposed) return;
    try {
      updatePointer(e);
      var wasDrag = pointer.moved > 6;
      pointer.down = false;
      cloud.drag = false;
      try {
        if (canvas.releasePointerCapture && e.pointerId != null &&
          canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch (e2) { /* ignore */ }
      if (!wasDrag) {
        if (pointer.pendingMemory) selectMemory(pointer.pendingMemory);
        else if (pointer.pendingCard) selectCardSlot(pointer.pendingCard);
        else clearSelection();   // empty click: release the ring, spin back up
      }
      pointer.pendingMemory = null;
      pointer.pendingCard = null;
      updateHover();
    } catch (err) { /* ignore */ }
  }

  function onPointerCancel() {
    pointer.down = false;
    cloud.drag = false;
    pointer.pendingMemory = null;
    pointer.pendingCard = null;
  }

  function onPointerLeave() {
    pointer.inside = false;
    if (!pointer.down) {
      cloud.drag = false;
      emitHover(null);
      updateCursor();
    }
  }

  function onWheel(e) {
    if (disposed) return;
    try {
      updatePointer(e);
      if (!inCloudZone(pointer.bx, pointer.by)) return;
      if (typeof e.preventDefault === "function") e.preventDefault();
      var dz = (e.deltaMode === 1) ? e.deltaY * 16 : e.deltaY;
      if (!isFinite(dz)) dz = 0;
      // zoom is clamped so the hero cloud can never grow across the card corona
      cloud.zoom = clamp(cloud.zoom * Math.exp(-dz * 0.0011), 0.60, 1.15);
      updateHover();
    } catch (err) { /* ignore */ }
  }

  // ---- memory cloud: build (model) + project (frame) ----------------------
  function buildMemoryCloud(force) {
    var list = memories;
    var i, j, n, m;
    if (force || memNodes.length !== list.length) {
      memNodes.length = 0;
      for (i = 0; i < list.length; i++) {
        m = list[i];
        var u1 = hashStr("mu|" + m.id);
        var u2 = hashStr("mv|" + m.id);
        var u3 = hashStr("mw|" + m.id);
        var theta = Math.acos(clamp(2 * u1 - 1, -1, 1));
        var phi = u2 * TAU;
        var shell = 0.70 + u3 * 0.42;
        memNodes.push({
          id: m.id,
          kind: m.kind,
          label: m.label,
          detail: m.detail,
          weight: m.weight,
          t: m.t,
          cardId: m.cardId || "",
          nx: Math.sin(theta) * Math.cos(phi) * shell,
          ny: Math.cos(theta) * shell * 0.88,
          nz: Math.sin(theta) * Math.sin(phi) * shell,
          px: memC.x, py: memC.y,
          depth: 0, r: 2, alpha: 1,
          hueKey: memColorKey(m.kind),
          hovered: false, pinned: false
        });
      }
    } else {
      for (i = 0; i < list.length; i++) {
        m = list[i];
        n = memNodes[i];
        if (!n || n.id !== m.id) { buildMemoryCloud(true); return; }
        n.kind = m.kind;
        n.label = m.label;
        n.detail = m.detail;
        n.weight = m.weight;
        n.t = m.t;
        n.cardId = m.cardId || "";
        n.hueKey = memColorKey(m.kind);
      }
    }

    activeNode = null;
    for (i = 0; i < memNodes.length; i++) {
      if (memNodes[i].id === activeId) { activeNode = memNodes[i]; break; }
    }

    // relation edges: sequence by time + semantic tool->file / agent->tool …
    memEdges.length = 0;
    var byKind = {};
    for (i = 0; i < memNodes.length; i++) {
      var k = memNodes[i].kind;
      if (!byKind[k]) byKind[k] = [];
      byKind[k].push(memNodes[i]);
    }
    for (i = 0; i < memNodes.length; i++) {
      for (j = 0; j < memNodes.length; j++) {
        if (i === j) continue;
        var a = memNodes[i], b = memNodes[j];
        var pairKey = "rel|" + a.kind + ">" + b.kind;
        var rel = (a.kind === "tool" && b.kind === "file") ||
          (a.kind === "agent" && b.kind === "tool") ||
          (a.kind === "thought" && b.kind === "answer") ||
          (a.kind === "tool" && b.kind === "thought") ||
          (a.kind === "file" && b.kind === "answer");
        if (rel && hashStr(pairKey + "|" + a.id + "|" + b.id) < 0.26) {
          memEdges.push({ a: a, b: b, hueKey: "blue" });
        }
        if (memEdges.length >= 96) break;
      }
      if (memEdges.length >= 96) break;
    }
    // time-ordered sequence edges (thin connective tissue through memory)
    if (memNodes.length > 1) {
      var seq = memNodes.slice(0);
      seq.sort(function (x, y) { return (x.t - y.t) || (x.id < y.id ? -1 : 1); });
      for (i = 0; i + 1 < seq.length; i++) {
        if (memEdges.length >= 120) break;
        if (hashStr("seq|" + seq[i].id + "|" + seq[i + 1].id) < 0.55) {
          memEdges.push({ a: seq[i], b: seq[i + 1], hueKey: "teal" });
        }
      }
    }
  }

  function updateMemoryCloud(dt) {
    if (!memNodes.length) { activeNode = null; return; }
    if (!cloud.drag) {
      cloud.yaw += dt * (0.34 * (1 - 0.92 * engage)) + cloud.yawVel * dt;
      cloud.pitch = clamp(cloud.pitch + cloud.pitchVel * dt, -0.85, 0.85);
      cloud.yawVel *= Math.exp(-dt * 3.4);
      cloud.pitchVel *= Math.exp(-dt * 4.2);
      if (Math.abs(cloud.yawVel) < 0.002) cloud.yawVel = 0;
      if (Math.abs(cloud.pitchVel) < 0.002) cloud.pitchVel = 0;
    }
    var cyw = Math.cos(cloud.yaw), syw = Math.sin(cloud.yaw);
    var cp = Math.cos(cloud.pitch), sp = Math.sin(cloud.pitch);
    var D = 2.7;
    var i, n, x1, z1, y1, z2, denom, persp, scale;
    for (i = 0; i < memNodes.length; i++) {
      n = memNodes[i];
      x1 = n.nx * cyw + n.nz * syw;
      z1 = -n.nx * syw + n.nz * cyw;
      y1 = n.ny * cp - z1 * sp;
      z2 = n.ny * sp + z1 * cp;
      denom = D - z2;
      if (denom < 1.1) denom = 1.1;
      persp = D / denom;                              // far ~0.74 / near ~1.56
      scale = memC.r * cloud.zoom * persp;
      n.px = memC.x + x1 * scale;
      n.py = memC.y + y1 * scale * 0.90;
      n.depth = z2;                                   // >0 = nearer
      n.r = (1.9 + n.weight * 2.6) * S * (0.72 + persp * 0.36);
      n.alpha = clamp01(0.42 + (z2 + 1) * 0.33);
      n.hovered = !!(hover && hover.type === "memory" && hover.id === n.id);
      n.pinned = (n.id === activeId);
    }
    // painter's algorithm: far -> near
    memOrder.length = 0;
    for (i = 0; i < memNodes.length; i++) memOrder.push(memNodes[i]);
    memOrder.sort(function (a, b) { return a.depth - b.depth; });
    activeNode = null;
    for (i = 0; i < memNodes.length; i++) {
      if (memNodes[i].id === activeId) { activeNode = memNodes[i]; break; }
    }
  }

  // ---------------- V4.2: card-nozzle rays (entry -> exit -> divergence) ---
  // Every card is a particle nozzle with a legible three-beat structure:
  //   1. a particle enters at the card's LEFT midpoint (inner end),
  //   2. crosses the box along the radial long axis (bright crossing dot),
  //   3. exits at the RIGHT midpoint (outer end) where it bursts into a short
  //      divergence fan (±FAN_SPREAD), then keeps flying outward and feeds the
  //      long additive streak fan (spawnStreak anchors at the same exits).
  var RAY_ALERT_HUE = 4;   // "alert" has no HUE_KEYS token: use magenta
  function hueIndexOfKey(key) {
    var idx = HUE_KEYS.indexOf(key);
    return idx >= 0 ? idx : RAY_ALERT_HUE;
  }

  function initNozzles() {
    NOZ.length = 0;
    for (var i = 0; i < MAX_NOZ; i++) {
      NOZ.push({ on: false, ci: 0, t: 0, dur: 0.3, hueKey: "cyan", seed: 0 });
    }
    nozCursor = 0;
    // per-card cooldowns, staggered so the ring doesn't pulse in unison
    for (var j = 0; j < CARD_N; j++) {
      cardFireT[j] = 0.15 + hashStr("fire|" + j) * 1.4;
    }
    // divergence-fan pool (several fast particles per card exit)
    FAN.length = 0;
    for (var f = 0; f < MAX_FAN; f++) {
      FAN.push({ on: false, x: 0, y: 0, dirx: 1, diry: 0, sp: 0, len: 0, a: 0, hue: 0 });
    }
    fanCursor = 0;
  }

  function spawnNozzle(s, idx) {
    if (!NOZ.length || !s) return;
    var n = NOZ[nozCursor % NOZ.length];
    nozCursor++;
    n.on = true;
    n.ci = idx;
    n.t = 0;
    // long enough to read the three beats: entry spark -> crossing dot -> exit
    n.dur = 0.22 + Math.random() * 0.20;
    n.hueKey = (STATUS[s.status] && STATUS[s.status].key) || "cyan";
    n.seed = Math.random();
  }

  function fanEmit(p, s, frac, hueMix) {
    var spread = frac * FAN_SPREAD + (Math.random() - 0.5) * 0.06;
    var cs = Math.cos(spread), sn = Math.sin(spread);
    p.dirx = s.dirx * cs - s.diry * sn;
    p.diry = s.dirx * sn + s.diry * cs;
    // start exactly at the RIGHT midpoint, just outside the box
    p.x = s.px + s.dirx * (s.radLen + 1.5 * S);
    p.y = s.py + s.diry * (s.radLen + 1.5 * S);
    p.sp = (640 + Math.random() * 980) * S * (0.85 + intensity * 0.4);
    p.len = (24 + Math.pow(Math.random(), 1.35) * 120) * S;
    p.a = 0.40 + Math.random() * 0.50;
    p.hue = (hueMix >= 0 && Math.random() < 0.62) ? hueMix : pickHue();
    p.on = true;
  }

  function fireFan(s, hueKey) {
    if (!s || !FAN.length) return;
    var mix = hueIndexOfKey(hueKey);
    for (var k = 0; k < FAN_PER_EXIT; k++) {
      var p = FAN[fanCursor % FAN.length];
      fanCursor++;
      var frac = (FAN_PER_EXIT === 1) ? 0 : ((k / (FAN_PER_EXIT - 1)) * 2 - 1);
      fanEmit(p, s, frac, mix);
    }
  }

  function updateFan(dt) {
    var spd = (0.95 + intensity * 0.5) * (reduced ? 0.6 : 1) * (1 - 0.55 * engageEase);
    for (var i = 0; i < FAN.length; i++) {
      var p = FAN[i];
      if (!p.on) continue;
      p.x += p.dirx * p.sp * dt * spd;
      p.y += p.diry * p.sp * dt * spd;
      var tx = p.x - p.dirx * p.len;
      var ty = p.y - p.diry * p.len;
      if (tx < -W * 0.15 || tx > W * 1.15 || ty < -H * 0.15 || ty > H * 1.15) p.on = false;
    }
  }

  function updateNozzles(dt) {
    // per-card emission timers: bright visible cards pulse more often
    var emitSpd = (0.75 + intensity * 0.9) * (reduced ? 0.5 : 1) * (1 - 0.6 * engageEase);
    var i, s;
    for (i = 0; i < nozzleCards.length; i++) {
      s = nozzleCards[i];
      if (!s || !s.noz) continue;
      cardFireT[s.slotIndex] -= dt * emitSpd;
      if (cardFireT[s.slotIndex] <= 0) {
        spawnNozzle(s, s.slotIndex);
        cardFireT[s.slotIndex] = (0.22 + Math.random() * 0.60) / (0.45 + s.alpha);
      }
    }
    // advance the pulses (inner midpoint -> through the box -> outer midpoint)
    var trSpd = (0.85 + intensity * 0.30) * (reduced ? 0.7 : 1) * (1 - 0.62 * engageEase);
    for (i = 0; i < NOZ.length; i++) {
      var n = NOZ[i];
      if (!n.on) continue;
      n.t += (dt / n.dur) * trSpd;
      if (n.t >= 1) {
        n.on = false;
        var sc = cardSlots[n.ci];
        // the exit burst: several particles diverge from the RIGHT midpoint
        if (sc && sc.noz) fireFan(sc, n.hueKey);
        continue;
      }
      if (!cardSlots[n.ci] || !cardSlots[n.ci].visible) n.on = false;
    }
  }

  // ---- draw: memory cloud -------------------------------------------------
  function drawMemoryCloud() {
    if (!usable) return;
    beginLayer(1.0, 1.0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // hologram base rings + rotating tick ring (reads as a 3D volume)
    ctx.strokeStyle = palA("blue", 0.26);
    ctx.lineWidth = Math.max(0.5, 0.7 * S);
    ctx.setLineDash([2 * S, 6 * S]);
    ctx.beginPath();
    ctx.ellipse(memC.x, memC.y, memC.r * 1.22, memC.r * 0.90, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    var tickCount = 44;
    var tickSel = 0;
    var ta, tx, ty;
    ctx.fillStyle = palA("blue", 0.38);
    ctx.beginPath();
    for (tickSel = 0; tickSel < tickCount; tickSel++) {
      if (tickSel % 4 === 0) continue;
      ta = cloud.yaw * 0.7 + (TAU * tickSel) / tickCount;
      tx = memC.x + Math.cos(ta) * memC.r * 1.22;
      ty = memC.y + Math.sin(ta) * memC.r * 0.90;
      if (tx < -2 || tx > W + 2 || ty < -2 || ty > H + 2) continue;
      ctx.rect(tx - 0.7 * S, ty - 0.7 * S, 1.4 * S, 1.4 * S);
    }
    ctx.fill();
    ctx.fillStyle = palA("teal", 0.72);
    ctx.beginPath();
    for (tickSel = 0; tickSel < tickCount; tickSel += 4) {
      ta = cloud.yaw * 0.7 + (TAU * tickSel) / tickCount;
      tx = memC.x + Math.cos(ta) * memC.r * 1.22;
      ty = memC.y + Math.sin(ta) * memC.r * 0.90;
      if (tx < -2 || tx > W + 2 || ty < -2 || ty > H + 2) continue;
      ctx.rect(tx - 1.2 * S, ty - 1.2 * S, 2.4 * S, 2.4 * S);
    }
    ctx.fill();

    // soft hero halo so the memory cloud owns the composition
    if (GLOW.cyan) {
      ctx.globalCompositeOperation = "lighter";
      var haloSize = memC.r * 3.4;
      ctx.globalAlpha = 0.10;
      ctx.drawImage(GLOW.cyan, memC.x - haloSize * 0.5, memC.y - haloSize * 0.5, haloSize, haloSize);
      if (GLOW.violet) {
        ctx.globalAlpha = 0.06;
        ctx.drawImage(GLOW.violet, memC.x - haloSize * 0.34,
          memC.y - haloSize * 0.30, haloSize * 0.68, haloSize * 0.60);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    if (!memNodes.length) {
      ctx.font = F_LABEL;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = palA("fgMuted", 0.9);
      ctx.fillText("// MEMORY BUFFER EMPTY", memC.x, memC.y);
      ctx.textAlign = "left";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return;
    }

    var i, j, k, n, e;
    // ---- relation edges: dim blue back tier + hue-bucketed front tier
    ctx.strokeStyle = palA("blue", 0.16);
    ctx.lineWidth = Math.max(0.5, 0.72 * S);
    ctx.beginPath();
    for (i = 0; i < memEdges.length; i++) {
      e = memEdges[i];
      if ((e.a.depth + e.b.depth) * 0.5 > 0.10) continue;
      ctx.moveTo(e.a.px, e.a.py);
      ctx.lineTo(e.b.px, e.b.py);
    }
    ctx.stroke();

    var edgeHues = ["blue", "teal", "amber", "violet", "magenta", "cyan"];
    for (j = 0; j < edgeHues.length; j++) {
      ctx.strokeStyle = palA(edgeHues[j], 0.38);
      ctx.lineWidth = Math.max(0.6, 1.0 * S);
      ctx.beginPath();
      var anyEdge = false;
      for (i = 0; i < memEdges.length; i++) {
        e = memEdges[i];
        if (e.hueKey !== edgeHues[j]) continue;
        if ((e.a.depth + e.b.depth) * 0.5 <= 0.10) continue;
        ctx.moveTo(e.a.px, e.a.py);
        ctx.lineTo(e.b.px, e.b.py);
        anyEdge = true;
      }
      if (anyEdge) ctx.stroke();
    }

    // ---- nodes, painter order far -> near, colored glows + crisp cores
    for (k = 0; k < memOrder.length; k++) {
      n = memOrder[k];
      var glowSpr = memGlow[n.hueKey] || GLOW.cyan;
      var emphasis = (n.hovered || n.pinned) ? 1 : 0;
      if (glowSpr) {
        ctx.globalCompositeOperation = "lighter";
        var gs = n.r * (emphasis ? 11.0 : 7.6) * (0.85 + n.alpha * 0.5);
        ctx.globalAlpha = clamp01(n.alpha * (emphasis ? 1.25 : 0.92));
        ctx.drawImage(glowSpr, n.px - gs * 0.5, n.py - gs * 0.5, gs, gs);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      var cs = n.r * (emphasis ? 1.75 : 1.30);
      ctx.fillStyle = rgbaA(COL[n.hueKey] || COL.cyan, n.alpha);
      ctx.fillRect(n.px - cs * 0.5, n.py - cs * 0.5, cs, cs);
      // hot white center keeps every node readable at a glance
      ctx.fillStyle = rgbaA(COL.nearWhite, 0.55 * n.alpha);
      ctx.fillRect(n.px - cs * 0.18, n.py - cs * 0.18, cs * 0.36, cs * 0.36);
      if (emphasis) {
        ctx.strokeStyle = rgbaA(n.pinned ? COL.nearWhite : (COL[n.hueKey] || COL.cyan),
          n.pinned ? 0.9 : 0.65);
        ctx.lineWidth = Math.max(0.7, 0.9 * S);
        ctx.beginPath();
        ctx.arc(n.px, n.py, n.r * 2.1 + 2 * S, 0, TAU);
        ctx.stroke();
        if (n.pinned) {
          ctx.strokeStyle = rgbaA(COL.amber, 0.8);
          ctx.beginPath();
          ctx.arc(n.px, n.py, n.r * 3.1 + 3 * S, t * 1.8, t * 1.8 + 4.0);
          ctx.stroke();
        }
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- draw: band-edge necklace + radar sweep (both ride ringPhase) --------
  function drawRingDots() {
    if (!usable) return;
    beginLayer(1.0, 1.0);
    var i, np;

    // visibly rotating dot necklace on the band's outer edge
    var necklace = 96;
    var spinBase = ringPhase * 0.45;
    ctx.fillStyle = palA("cyan", 0.30);
    ctx.beginPath();
    for (i = 0; i < necklace; i++) {
      np = dialPoint(1.05, spinBase + (TAU * i) / necklace, _p);
      if (np.x < -2 || np.x > W + 2 || np.y < -2 || np.y > H + 2) continue;
      ctx.rect(np.x - 0.7 * S, np.y - 0.7 * S, 1.4 * S, 1.4 * S);
    }
    ctx.fill();
    ctx.fillStyle = palA("teal", 0.55);
    ctx.beginPath();
    for (i = 0; i < necklace; i += 8) {
      np = dialPoint(1.05, spinBase + (TAU * i) / necklace, _p);
      if (np.x < -2 || np.x > W + 2 || np.y < -2 || np.y > H + 2) continue;
      ctx.rect(np.x - 1.2 * S, np.y - 1.2 * S, 2.4 * S, 2.4 * S);
    }
    ctx.fill();

    // radar-style sweep: leading tick + short fading arc = clear ring rotation
    var sweepA = -1.24 + ((ringPhase * 0.55) % 2.48);
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < 5; i++) {
      var a0 = sweepA - 0.015 - i * 0.045;
      ctx.strokeStyle = rgbaA(i === 0 ? COL.nearWhite : COL.cyan, 0.32 * (1 - i * 0.17));
      ctx.lineWidth = Math.max(1, (1.7 - i * 0.22) * S);
      ctx.beginPath();
      ctx.ellipse(cx, cy, ea * 1.015, eb * 1.015, ROT, a0, a0 + 0.05);
      ctx.stroke();
    }
    np = dialPoint(1.035, sweepA, _p);
    dialNormal(sweepA, _n);
    ctx.strokeStyle = rgbaA(COL.nearWhite, 0.85);
    ctx.lineWidth = Math.max(1, 1.2 * S);
    ctx.beginPath();
    ctx.moveTo(np.x - _n.x * 7 * S, np.y - _n.y * 7 * S);
    ctx.lineTo(np.x + _n.x * 9 * S, np.y + _n.y * 9 * S);
    ctx.stroke();
    if (GLOW.cyan) {
      ctx.globalAlpha = 0.45;
      ctx.drawImage(GLOW.cyan, np.x - 22 * S, np.y - 22 * S, 44 * S, 44 * S);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- draw: card-nozzle particle (entry -> crossing -> exit bloom) -------
  // Beat 1: an inbound particle reaches the LEFT midpoint (entry spark).
  // Beat 2: a bright crossing dot rides the radial long axis through the box.
  // Beat 3: a bloom at the RIGHT midpoint hands over to the divergence fan.
  function drawNozzles() {
    if (!usable) return;
    beginLayer(1.0, 1.0);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    var calm = 1 - 0.6 * engageEase;
    var i, n, s, col, halo;
    for (i = 0; i < NOZ.length; i++) {
      n = NOZ[i];
      if (!n.on) continue;
      s = cardSlots[n.ci];
      if (!s || !s.visible) continue;
      col = COL[n.hueKey] || COL.cyan;
      halo = GLOW[n.hueKey] || GLOW.cyan;
      var t01 = n.t;
      var half = s.radLen;
      // particle path: LEFT midpoint (-half) -> RIGHT midpoint (+half)
      var run = half * (2.0 * t01 - 1.0);
      var px2 = s.px + s.dirx * run;
      var py2 = s.py + s.diry * run;
      var alpha = (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t01))) * calm * s.alpha;
      if (alpha <= 0.01) continue;

      // ---- beat 1: inbound particle + entry spark at the LEFT midpoint
      if (t01 < 0.42) {
        var inA = (1 - t01 / 0.42) * 0.55 * calm * s.alpha;
        var inLen = (9 + 16 * (1 - t01 / 0.42)) * S;
        var ex = s.px - s.dirx * half;
        var ey = s.py - s.diry * half;
        ctx.strokeStyle = rgbaA(col, inA);
        ctx.lineWidth = Math.max(0.8, 1.1 * S);
        ctx.beginPath();
        ctx.moveTo(ex - s.dirx * inLen, ey - s.diry * inLen);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.fillStyle = rgbaA(COL.nearWhite, inA * 1.5);
        ctx.fillRect(ex - 1.6 * S, ey - 1.6 * S, 3.2 * S, 3.2 * S);
        ctx.fillStyle = rgbaA(col, inA);
        ctx.fillRect(ex - 3.4 * S, ey - 0.5 * S, 6.8 * S, 1.0 * S);
        ctx.fillRect(ex - 0.5 * S, ey - 3.4 * S, 1.0 * S, 6.8 * S);
      }

      // ---- beat 2: crossing dot + short longitudinal tail through the box
      var trail = half * (0.72 + 0.30 * t01);
      ctx.strokeStyle = rgbaA(col, 0.45 * alpha);
      ctx.lineWidth = Math.max(0.8, 1.25 * S);
      ctx.beginPath();
      ctx.moveTo(px2 - s.dirx * trail, py2 - s.diry * trail);
      ctx.lineTo(px2, py2);
      ctx.stroke();
      if (halo) {
        var hs = (10 + 6 * Math.sin(Math.PI * t01)) * S;
        ctx.globalAlpha = 0.55 * alpha;
        ctx.drawImage(halo, px2 - hs * 0.5, py2 - hs * 0.5, hs, hs);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = rgbaA(COL.nearWhite, 0.90 * alpha);
      ctx.fillRect(px2 - 1.6 * S, py2 - 1.6 * S, 3.2 * S, 3.2 * S);

      // ---- beat 3: exit bloom at the RIGHT midpoint (fan particles follow)
      if (t01 > 0.58) {
        var exf = (t01 - 0.58) / 0.42;
        var ox2 = s.px + s.dirx * half;
        var oy2 = s.py + s.diry * half;
        var bloomR = (2 + 7 * exf) * S;
        ctx.strokeStyle = rgbaA(COL.nearWhite, 0.55 * exf * calm * s.alpha);
        ctx.lineWidth = Math.max(0.9, 1.3 * S);
        ctx.beginPath();
        ctx.arc(ox2, oy2, bloomR, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = rgbaA(col, 0.45 * exf * calm * s.alpha);
        ctx.fillRect(ox2 - 2.0 * S, oy2 - 2.0 * S, 4.0 * S, 4.0 * S);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- draw: divergence fan (fast particles leaving each card's exit) -----
  function drawFanRays() {
    if (!FAN.length) return;
    var rayCalm = 1 - 0.55 * engageEase;
    var prevA = ctx.globalAlpha;
    ctx.globalAlpha = 1;
    var i, p, any, vis;
    // short coloured trails, batched per console hue
    for (var hi = 0; hi < HUE_KEYS.length; hi++) {
      any = false;
      ctx.strokeStyle = rgbaA(COL[HUE_KEYS[hi]] || COL.cyan, 0.36 * rayCalm);
      ctx.lineWidth = Math.max(0.6, 0.95 * S);
      ctx.beginPath();
      for (i = 0; i < FAN.length; i++) {
        p = FAN[i];
        if (!p.on || p.hue !== hi) continue;
        vis = calmMask(p.y) * calmMaskX(p.x) * p.a;
        if (vis < 0.05) continue;
        ctx.moveTo(p.x - p.dirx * p.len, p.y - p.diry * p.len);
        ctx.lineTo(p.x, p.y);
        any = true;
      }
      if (any) ctx.stroke();
    }
    // near-white heads: the fan must read as fast particles, not strokes
    ctx.strokeStyle = rgbaA(COL.nearWhite, 0.62 * rayCalm);
    ctx.lineWidth = Math.max(0.9, 1.2 * S);
    ctx.beginPath();
    any = false;
    for (i = 0; i < FAN.length; i++) {
      p = FAN[i];
      if (!p.on) continue;
      vis = calmMask(p.y) * calmMaskX(p.x) * p.a;
      if (vis < 0.05) continue;
      ctx.moveTo(p.x - p.dirx * 8 * S, p.y - p.diry * 8 * S);
      ctx.lineTo(p.x, p.y);
      any = true;
    }
    if (any) ctx.stroke();
    ctx.globalAlpha = prevA;
  }

  // ---- draw: hover / pinned labels (crisp, above the CRT post) ------------
  function drawHoverOverlay() {
    if (!usable || !showHoverLabels) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    var h = hover;
    if (!h && activeNode) {
      baseToScreen(activeNode.px, activeNode.py, _bs);
      h = {
        type: "memory", id: activeNode.id, label: activeNode.label,
        detail: activeNode.detail, x: _bs.x, y: _bs.y, pinned: true
      };
    }
    if (!h) return;

    var i, kindKey = "cyan";
    if (h.type === "memory") {
      for (i = 0; i < memNodes.length; i++) {
        if (memNodes[i].id === h.id) { kindKey = memNodes[i].hueKey; break; }
      }
    } else {
      kindKey = "teal";
    }
    var col = COL[kindKey] || COL.cyan;
    var fsL = clamp(9.4 * S, 7, 12.5);
    var fsS = clamp(7.2 * S, 5.4, 9.4);
    var fLabel = "600 " + fsL.toFixed(1) + "px " + MONO;
    var fSmall = "500 " + fsS.toFixed(1) + "px " + MONO;
    var tag = h.type === "memory" ? "MEM" : "CARD";
    var wTag = 30 * S;
    var label = clipStr(h.label || h.id || "", 26);
    var detail = clipStr(h.detail || "", 34);

    ctx.font = fSmall;
    var wTagM = ctx.measureText(tag).width + 8 * S;
    ctx.font = fLabel;
    var w1 = ctx.measureText(label).width;
    ctx.font = fSmall;
    var w2 = detail ? ctx.measureText(detail).width : 0;
    var bw = Math.max(wTagM + w1, w2) + 18 * S;
    var bh = (detail ? 27 : 20) * S;
    var bx = h.x + 14 * S;
    var by = h.y - bh - 12 * S;
    if (bx + bw > W - 8 * S) bx = h.x - bw - 14 * S;
    if (by < 8 * S) by = h.y + 16 * S;
    if (bx < 8 * S) bx = 8 * S;

    ctx.fillStyle = "rgba(2,10,10,0.84)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = rgbaA(col, 0.8);
    ctx.lineWidth = Math.max(0.6, 0.7 * S);
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = rgbaA(col, 0.95);
    ctx.fillRect(bx + 1, by + 1, 3 * S, bh - 2);
    // corner notches
    ctx.fillStyle = rgbaA(col, 0.55);
    ctx.fillRect(bx + bw - 8 * S, by + 1, 6 * S, 1);
    ctx.fillRect(bx + bw - 8 * S, by + bh - 2, 6 * S, 1);

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = fSmall;
    ctx.fillStyle = rgbaA(col, 0.9);
    ctx.fillText(tag, bx + 8 * S, by + bh * 0.32);
    ctx.font = fLabel;
    ctx.fillStyle = palA("fg", 0.96);
    ctx.fillText(label, bx + 8 * S + wTagM, by + bh * 0.32);
    if (detail) {
      ctx.font = fSmall;
      ctx.fillStyle = palA("fgMuted", 0.95);
      ctx.fillText(detail, bx + 8 * S, by + bh * 0.74);
    }
    // pinned pip
    if (h.pinned) {
      ctx.fillStyle = rgbaA(COL.amber, 0.95);
      ctx.fillRect(bx + bw - 6 * S, by + 3 * S, 3 * S, 3 * S);
    }
    // leader line from the object
    var ex = bx + (h.x > bx ? 0 : bw);
    var ey = by + bh * 0.5;
    ctx.strokeStyle = rgbaA(col, 0.5);
    ctx.lineWidth = Math.max(0.5, 0.6 * S);
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.lineTo(h.x + (h.x > bx ? 7 : -7) * S, h.y - 5 * S);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }

  function setActive(id) {
    var next = (id == null || id === "") ? null : String(id);
    activeId = next;
    activeNode = null;
    if (next) {
      for (var i = 0; i < memNodes.length; i++) {
        if (memNodes[i].id === next) { activeNode = memNodes[i]; break; }
      }
    }
    if (!next) {
      // clearing the HUD selection resumes the carousel
      focusCard = -1;
    } else if (activeNode) {
      // HUD memory selection overrides a card focus
      focusCard = -1;
    } else if (focusCard >= 0) {
      // HUD may echo any onSelect hit id (including a card) back through
      // setActive; keep the focused card only if the id matches it
      var fs = cardSlots[focusCard];
      if (!fs || !fs.card || String(fs.card.id) !== next) focusCard = -1;
    }
    if (!running) safeDraw(0.016);
  }


  function drawStreaks() {
    if (!usable || !partCount) return;
    beginLayer(1.0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    // engage calms/dims the ray fan so the inspected card stays readable
    var rayCalm = 1 - 0.55 * engageEase;
    ctx.globalAlpha = rayCalm;

    // broad comet swaths (behind the thin streaks) — hue-varied variants
    for (var ci = 0; ci < comets.length; ci++) {
      var cm = comets[ci];
      var ca = cm.a * calmMask(cm.y) * (0.6 + intensity * 0.6);
      if (ca <= 0.004) continue;
      var cspr = COMET_SPRITES[cm.variant] || COMET_SPRITES[0];
      if (!cspr) continue;
      ctx.save();
      ctx.translate(cm.x, cm.y);
      ctx.rotate(Math.atan2(cm.diry, cm.dirx));
      ctx.globalAlpha = ca * rayCalm;
      ctx.drawImage(cspr, -cm.len, -cm.h * 0.5, cm.len, cm.h);
      ctx.restore();
    }
    ctx.globalAlpha = rayCalm;

    var n = partCount, i, p, x0, y0, hi, pi;

    // multi-hue streaks: dominant cyan/teal/blue, sparse hue accents.
    // Each hue draws a few batched stroke bands (faint tail / bright mid /
    // hot head) so the draw-call count stays flat while every particle carries
    // its own console hue.
    for (hi = 0; hi < HUE_PASSES.length; hi++) {
      var passList = HUE_PASSES[hi];
      for (pi = 0; pi < passList.length; pi++) {
        var ps = passList[pi];
        ctx.strokeStyle = ps.style;
        ctx.lineWidth = Math.max(0.5, ps.width * S);
        ctx.beginPath();
        for (i = 0; i < n; i++) {
          p = parts[i];
          if (p.hue !== hi || p.vis < ps.minVis) continue;
          x0 = p.x - p.dirx * p.len * ps.from;
          y0 = p.y - p.diry * p.len * ps.from;
          ctx.moveTo(x0, y0);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }

    // hero streaks — soft additive cyan glow + crisp light core
    ctx.strokeStyle = STY.heroGlow;
    ctx.lineWidth = Math.max(1.6, 2.9 * S);
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      p = parts[i];
      if (!p.hero || p.hue >= 2 || p.vis < 0.4) continue;
      x0 = p.x - p.dirx * p.len * 0.55;
      y0 = p.y - p.diry * p.len * 0.55;
      ctx.moveTo(x0, y0);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.strokeStyle = STY.heroCore;
    ctx.lineWidth = Math.max(1.0, 1.5 * S);
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      p = parts[i];
      if (!p.hero || p.hue >= 2 || p.vis < 0.4) continue;
      x0 = p.x - p.dirx * p.len * 0.18;
      y0 = p.y - p.diry * p.len * 0.18;
      ctx.moveTo(x0, y0);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // divergence fan from the card exits (fast particles, short bright trails)
    drawFanRays();

    // event sparks — cyan/blue only
    var sc = 0;
    ctx.fillStyle = STY.sparkDim;
    ctx.beginPath();
    for (i = 0; i < sparks.length; i++) {
      var sp = sparks[i];
      if (!sp.on || sp.life < sp.max * 0.5) continue;
      var ss = 1.4 * Math.max(1, S * 0.9);
      ctx.rect(sp.x - ss * 0.5, sp.y - ss * 0.5, ss, ss);
      sc++;
    }
    if (sc) ctx.fill();
    sc = 0;
    ctx.fillStyle = STY.sparkHot;
    ctx.beginPath();
    for (i = 0; i < sparks.length; i++) {
      var sp2 = sparks[i];
      if (!sp2.on || sp2.life >= sp2.max * 0.5) continue;
      var ss2 = 2.0 * Math.max(1, S);
      ctx.rect(sp2.x - ss2 * 0.5, sp2.y - ss2 * 0.5, ss2, ss2);
      sc++;
    }
    if (sc) ctx.fill();

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------------- draw: L5 CRT post -------------------------------------
  function drawPostFX() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    if (overlayCanvas) ctx.drawImage(overlayCanvas, 0, 0, W, H);

    // scanlines (neutral, very subtle)
    if (scanPattern) {
      ctx.fillStyle = scanPattern;
      ctx.globalAlpha = reduced ? 0.030 : (0.044 + 0.008 * Math.sin(t * 2.3));
      var off = reduced ? 0 : (t * 7) % 3;
      ctx.save();
      ctx.translate(0, off);
      ctx.fillRect(0, -off - 3, W, H + 6);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // animated neutral grain
    if (grainPatterns.length) {
      var gp = grainPatterns[(frameNo >> 1) % grainPatterns.length];
      var gx = ((Math.random() * 89) | 0) - 44;
      var gy = ((Math.random() * 89) | 0) - 44;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = reduced ? 0.016 : 0.028;
      ctx.fillStyle = gp;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.fillRect(-gx, -gy, W, H);
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }

    if (!reduced) {
      // occasional CCD row flicker (neutral white)
      if (t > flick.next && t > flick.until + 0.4) {
        flick.until = t + 0.05 + Math.random() * 0.11;
        flick.next = t + 2.2 + Math.random() * 4.5;
        flick.n = 2 + ((Math.random() * 3) | 0);
        for (var i = 0; i < flick.n; i++) flick.rows[i] = (Math.random() * H) | 0;
      }
      if (t < flick.until) {
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = palA("pureWhite", 0.026);
        for (var j = 0; j < flick.n; j++) ctx.fillRect(0, flick.rows[j], W, 2 * S);
        ctx.globalCompositeOperation = "source-over";
      }
      // slow rolling CRT band (neutral)
      var ry = ((t * 26) % (H + 200 * S)) - 100 * S;
      ctx.globalAlpha = 0.035;
      ctx.fillStyle = palA("pureBlack", 1);
      ctx.fillRect(0, ry, W, 34 * S);
      ctx.globalAlpha = 0.014;
      ctx.fillStyle = palA("pureWhite", 1);
      ctx.fillRect(0, ry + 34 * S, W, 1.2);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------- frame loop --------------------------------------------
  function drawFrame(dt) {
    if (!ctx || !W || !H) return;
    frameNo++;
    t += dt * (reduced ? 0.75 : 1);
    updateCamera();
    intensity += (targetIntensity - intensity) * Math.min(1, dt * 1.8);
    intensity = clamp01(intensity);

    // ---- update phase (carousel phase first: cards, necklace, sweep and the
    // ray fan all ride it; engage eases the whole ring down on selection)
    updateRing(dt);
    layoutCards();
    updateParticles(dt);
    updateNozzles(dt);
    updateFan(dt);
    updateMemoryCloud(dt);
    updateHover();

    // ---- draw phase (back -> front)
    drawBackground();
    drawNetwork();
    drawRing();
    drawMemoryCloud();
    drawRingDots();
    drawNozzles();
    drawStreaks();
    drawPostFX();
    drawHoverOverlay();
  }

  function loop(nowMs) {
    if (disposed || !running) return;
    raf = window.requestAnimationFrame(loop);
    var now = (typeof nowMs === "number") ? nowMs : 0;
    var dt = lastFrameMs ? (now - lastFrameMs) / 1000 : 0.016;
    lastFrameMs = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;
    try {
      if (typeof document !== "undefined" && document.hidden) return;
      drawFrame(dt);
    } catch (err) {
      if (!warned) {
        warned = true;
        try {
          if (typeof console !== "undefined" && console.warn) {
            console.warn("[agent-ops/scene] frame error", err);
          }
        } catch (e2) { /* ignore */ }
      }
    }
  }

  function onWindowResize() {
    if (disposed) return;
    lastFrameMs = 0;
    resize();
  }

  function onVisibility() {
    lastFrameMs = 0;
  }

  // ---------------- public API --------------------------------------------
  function setRunning(on) {
    on = !!on;
    if (disposed || !usable) return;
    if (on === running) return;
    if (on) {
      running = true;
      lastFrameMs = 0;
      try { raf = window.requestAnimationFrame(loop); } catch (e) { raf = 0; }
    } else {
      running = false;
      if (raf) {
        try { window.cancelAnimationFrame(raf); } catch (e2) { /* ignore */ }
        raf = 0;
      }
    }
  }

  function setModel(next) {
    if (disposed) return;
    try {
      var m = (next && typeof next === "object") ? next : {};
      model.mode = m.mode === "LIVE" ? "LIVE" : "SIMULATION";
      model.clock = (typeof m.clock === "string")
        ? m.clock.replace(/[^\d:.\- ]/g, "").slice(0, 12)
        : "";
      var ti = Number(m.intensity);
      targetIntensity = isFinite(ti) ? clamp01(ti) : 0.55;

      // ---- nodes (cap 60, always objects with sane fields)
      var nodes = [];
      if (m.nodes && typeof m.nodes.length === "number" && m.nodes.length) {
        var ncap = Math.min(m.nodes.length, 60);
        for (var i = 0; i < ncap; i++) {
          var n = m.nodes[i];
          if (!n || typeof n !== "object") continue;
          var nid = (n.id == null || n.id === "") ? ("node-" + i) : String(n.id);
          nodes.push({
            id: nid,
            label: clipStr(n.label || nid, 18),
            kind: (n.kind === "tool" || n.kind === "file" || n.kind === "msg") ? n.kind : "agent",
            weight: clamp01(Number(n.weight) || 0.5)
          });
        }
      }
      model.nodes = nodes;

      // ---- links (cap 160, only between known nodes ids)
      var links = [];
      if (m.links && typeof m.links.length === "number" && m.links.length) {
        var lcap = Math.min(m.links.length, 160);
        for (var j = 0; j < lcap; j++) {
          var L = m.links[j];
          if (!L || typeof L !== "object") continue;
          var from = (L.from == null) ? "" : String(L.from);
          var to = (L.to == null) ? "" : String(L.to);
          if (!from || !to || from === to) continue;
          links.push({ from: from, to: to, weight: clamp01(Number(L.weight) || 0.5) });
        }
      }
      model.links = links;

      // ---- cards (cap 14, status whitelist, strings truncated)
      var cards = [];
      if (m.cards && typeof m.cards.length === "number" && m.cards.length) {
        var ccap = Math.min(m.cards.length, 14);
        for (var k = 0; k < ccap; k++) {
          var cd = m.cards[k];
          if (!cd || typeof cd !== "object") continue;
          var st = (cd.status === "ok" || cd.status === "wait" || cd.status === "error")
            ? cd.status : "run";
          cards.push({
            id: (cd.id == null || cd.id === "") ? ("card-" + k) : String(cd.id),
            title: clipStr(cd.title || cd.id || "CARD", 15),
            line1: clipStr(cd.line1, 17),
            line2: clipStr(cd.line2, 17),
            status: st,
            tone: clamp01(Number(cd.tone) || 0)
          });
        }
      }
      model.cards = cards;

      // ---- V3 memories (cap 48; kind whitelist; safe strings/numbers)
      var memo = [];
      if (m.memories && typeof m.memories.length === "number" && m.memories.length) {
        var mcap = Math.min(m.memories.length, 48);
        for (var mi = 0; mi < mcap; mi++) {
          var mm = m.memories[mi];
          if (!mm || typeof mm !== "object") continue;
          var mid = (mm.id == null || mm.id === "") ? ("mem-" + mi) : String(mm.id);
          var mkind = mm.kind;
          if (mkind !== "tool" && mkind !== "file" && mkind !== "thought" &&
            mkind !== "answer" && mkind !== "agent") mkind = "thought";
          memo.push({
            id: mid,
            kind: mkind,
            label: clipStr(mm.label || mid, 26),
            detail: clipStr(mm.detail, 40),
            weight: clamp01(Number(mm.weight) || 0.5),
            t: isFinite(Number(mm.t)) ? Number(mm.t) : 0,
            // V4.3 HUD memory→card link (e.g. "c:12"); lowercase canonical id
            cardId: (mm.cardId == null) ? "" :
              String(mm.cardId).replace(/[^\w:.\-]/g, "").toLowerCase().slice(0, 40)
          });
        }
      }
      memories = memo;

      // ---- active memory (HUD two-way selection)
      if (Object.prototype.hasOwnProperty.call(m, "activeId")) {
        activeId = (m.activeId == null || m.activeId === "") ? null : String(m.activeId);
      }

      if (!W || !H) resize();

      // V4.4: only rebuild heavy layers when their data actually changed.
      // HUD polls arrive several times a second; rebuilding the network, cloud
      // and sprite layers on every poll dropped sync work onto the swing frames
      // and caused micro-stutter.  Signatures are cheap string compares per poll.
      var netNow = "";
      var ni2, li2;
      for (ni2 = 0; ni2 < nodes.length; ni2++) {
        netNow += nodes[ni2].id + nodes[ni2].kind + "|";
      }
      for (li2 = 0; li2 < links.length; li2++) {
        netNow += links[li2].from + ">" + links[li2].to + ",";
      }
      if (netNow !== netSig) {
        netSig = netNow;
        buildNetwork();
      }

      var cardNow = "";
      var ci2;
      for (ci2 = 0; ci2 < cards.length; ci2++) {
        cardNow += cards[ci2].id + "|" + cards[ci2].title + "|" + cards[ci2].line1 +
          "|" + cards[ci2].line2 + "|" + cards[ci2].status + "|" + cards[ci2].tone + ";";
      }
      if (cardNow !== cardSig) {
        cardSig = cardNow;
        rebuildCardSlots(false);   // stable slots: only sig-changed sprites re-bake
      }

      var memNow = "";
      var mi2;
      for (mi2 = 0; mi2 < memo.length; mi2++) {
        memNow += memo[mi2].id + "|" + memo[mi2].kind + ";";
      }
      if (memNow !== memSig || memNodes.length !== memo.length) {
        memSig = memNow;
        buildMemoryCloud(true);
      } else {
        // same structure: refresh mutable text/weight/link fields in place,
        // without re-running the O(n²) edge rebuild
        for (mi2 = 0; mi2 < memo.length; mi2++) {
          var mm2 = memo[mi2], mn2 = memNodes[mi2];
          if (!mn2 || mn2.id !== mm2.id) { buildMemoryCloud(true); break; }
          mn2.label = mm2.label;
          mn2.detail = mm2.detail;
          mn2.weight = mm2.weight;
          mn2.t = mm2.t;
          mn2.cardId = mm2.cardId || "";
        }
      }

      handlePulses(m.pulses);
      if (!running) safeDraw(0.016);
    } catch (err) {
      try {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[agent-ops/scene] rejected malformed model", err);
        }
      } catch (e3) { /* ignore */ }
    }
  }

  function safeDraw(dt) {
    try { drawFrame(dt > 0 ? dt : 0.016); } catch (e) { /* keep host alive */ }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    running = false;
    if (raf) {
      try { window.cancelAnimationFrame(raf); } catch (e) { /* ignore */ }
      raf = 0;
    }
    if (ro) {
      try { ro.disconnect(); } catch (e2) { /* ignore */ }
      ro = null;
    }
    try { window.removeEventListener("resize", onWindowResize, false); } catch (e3) { /* ignore */ }
    try {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility, false);
    } catch (e4) { /* ignore */ }
    // V3 pointer plumbing
    try {
      if (canvas && canvas.removeEventListener) {
        canvas.removeEventListener("pointermove", onPointerMove, false);
        canvas.removeEventListener("pointerdown", onPointerDown, false);
        canvas.removeEventListener("pointerup", onPointerUp, false);
        canvas.removeEventListener("pointercancel", onPointerCancel, false);
        canvas.removeEventListener("pointerleave", onPointerLeave, false);
        canvas.removeEventListener("wheel", onWheel, false);
      }
    } catch (e5) { /* ignore */ }

    bgCanvas = null;
    overlayCanvas = null;
    ringCanvas = null;
    GLOW = {};
    COMET_SPRITES.length = 0;
    for (var kg = 0; kg < KIND_KEYS.length; kg++) KIND_GLOW[KIND_KEYS[kg]] = null;
    memGlow = {};
    scanPattern = null;
    grainPatterns.length = 0;
    for (var i = 0; i < cardSlots.length; i++) {
      if (cardSlots[i]) cardSlots[i].canvas = null;
    }
    cardSlots.length = 0;
    net.nodes.length = 0;
    net.sats.length = 0;
    net.dust.length = 0;
    net.edges.length = 0;
    net.beads.length = 0;
    net.pDim = net.pMid = net.pHot = net.pWhite = null;
    net.pathsReady = false;
    parts.length = 0;
    comets.length = 0;
    sparks.length = 0;
    trav.length = 0;
    memNodes.length = 0;
    memEdges.length = 0;
    memOrder.length = 0;
    memories.length = 0;
    NOZ.length = 0;
    FAN.length = 0;
    linkCard = -1;
    linkTrip.on = false;
    linkFlash = 0;
    cardSlotMap = {};
    cardSlotTaken.fill(0);
    cardList.length = 0;
    cardKeys.length = 0;
    netSig = cardSig = memSig = "";
    cardOrder.length = 0;
    rayCards.length = 0;
    nozzleCards.length = 0;
    hover = null;
    hoverKey = "";
    activeNode = null;
    model.nodes.length = 0;
    model.links.length = 0;
    model.cards.length = 0;
    seen = {};
    seenCount = 0;
  }

  // ---------------- boot ---------------------------------------------------
  function boot() {
    if (!usable) return;
    // ---- palette-resolved sprite assets (created once, reused every frame)
    GLOW.agent = makeGlowSprite(64, COL.teal, 0.95);
    GLOW.tool = makeGlowSprite(64, COL.amber, 0.95);
    GLOW.file = makeGlowSprite(64, COL.magenta, 0.95);
    GLOW.msg = makeGlowSprite(64, COL.violet, 0.95);
    GLOW.hub = makeGlowSprite(96, COL.cyan, 0.90);
    // hue-keyed glows for the ring marks, card rays and the memory cloud
    var hueKeys = ["cyan", "teal", "violet", "magenta", "amber", "blue", "lime", "alert", "nearWhite"];
    for (var hk = 0; hk < hueKeys.length; hk++) {
      GLOW[hueKeys[hk]] = makeGlowSprite(48, COL[hueKeys[hk]], 0.92);
    }
    for (var kg = 0; kg < KIND_KEYS.length; kg++) {
      var kk = KIND_KEYS[kg];
      KIND_GLOW[kk] = GLOW[KIND_COLOR[kk]] || GLOW.cyan;
    }
    memGlow = {};
    for (var mk = 0; mk < MEM_KEYS.length; mk++) {
      var mTok = MEM_COLOR[MEM_KEYS[mk]];
      memGlow[mTok] = makeGlowSprite(48, COL[mTok], 0.95);
    }
    COMET_SPRITES.length = 0;
    COMET_SPRITES.push(makeCometSprite(COL.cyan, COL.nearWhite));   // dominant cyan
    COMET_SPRITES.push(makeCometSprite(COL.amber, COL.lime));       // warm accent
    COMET_SPRITES.push(makeCometSprite(COL.magenta, COL.violet));   // magenta/violet accent
    try {
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.pointerEvents = "auto";
      canvas.style.touchAction = "none";
      canvas.style.userSelect = "none";
      canvas.style.cursor = "default";
    } catch (e0) { /* ignore */ }
    // V4 pointer plumbing: the HUD root is pointer-events:none and only its
    // panels opt back in, so empty space over the scene reaches this canvas.
    try {
      if (canvas.addEventListener) {
        canvas.addEventListener("pointermove", onPointerMove, false);
        canvas.addEventListener("pointerdown", onPointerDown, false);
        canvas.addEventListener("pointerup", onPointerUp, false);
        canvas.addEventListener("pointercancel", onPointerCancel, false);
        canvas.addEventListener("pointerleave", onPointerLeave, false);
        canvas.addEventListener("wheel", onWheel, { passive: false });
      }
    } catch (eEv) { /* ignore */ }
    try {
      if (typeof ResizeObserver !== "undefined" && canvas.parentElement) {
        ro = new ResizeObserver(function () { if (!disposed) resize(); });
        ro.observe(canvas.parentElement);
      }
    } catch (e1) { ro = null; }
    try { window.addEventListener("resize", onWindowResize, false); } catch (e2) { /* ignore */ }
    try {
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility, false);
    } catch (e3) { /* ignore */ }
    resize();
    setRunning(true);
  }

  boot();

  return {
    resize: resize,
    setModel: setModel,
    setActive: setActive,
    setRunning: setRunning,
    dispose: dispose
  };
}





