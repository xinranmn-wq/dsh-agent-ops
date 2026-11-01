// ==== HUD (V3 — colorful V1 console skin + memory interaction) ====
// Full-screen Agent Ops overlay: V1 console chrome (dense monospace,
// corner brackets, big arc/network scene behind), repainted with a colorful
// semantic palette, plus a pointer-interactive memory layer.
// Concatenated after src/scene.js inside one factory scope, so `React`, `h` and
// `createScene` already exist here. No modules, no JSX, all CSS in one <style>.
//
// Data flow:  GET /dsh-agent-ops/state  ──▶ normalize ──▶ React render (~0.9 Hz)
//                    │                                     └──▶ scene.setModel()
//                    └── idle / error / empty ──▶ deterministic simulation tick
//
// V3: root is pointer-events:none (panels/bars/pill opt back in) so the canvas
// owns drag/zoom/hover. Up to ~48 memories are fed to the scene; scene hit
// callbacks drive a floating hover label + MEMORY INSPECTOR; TASK FEED rows and
// DISPATCH BUFFER rows select the matching memory and call scene.setActive().

const AO_ROUTE = '/dsh-agent-ops/state';
const AO_POLL_MS = 1100;
const AO_HUD_VERSION = '3.0.0';
const AO_SIM_MAX_EVENTS = 160;
const AO_SIM_MAX_TOOLS = 40;
const AO_SIM_MAX_FILES = 18;
const AO_SIM_MAX_AGENTS = 6;
const AO_MAX_MEMORIES = 48;

const AO_CSS = `
.ao-root{position:fixed;inset:0;z-index:2147482000;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:8px;padding:9px 12px 12px;overflow:hidden;contain:strict;pointer-events:none;isolation:isolate;background:#030a0c;color:#e8fff6;font-family:var(--ao-mono);font-size:10px;line-height:1.25;letter-spacing:.1em;text-transform:uppercase;font-variant-numeric:tabular-nums;--ao-mono:ui-monospace,"Cascadia Mono","SFMono-Regular","JetBrains Mono",Menlo,Consolas,"Liberation Mono",monospace;--ao-bg:#030a0c;--ao-deep:#04120f;--ao-panel:rgba(3,10,12,.74);--ao-panel2:rgba(4,18,15,.58);--ao-white:#e8fff6;--ao-dim:#3f7f74;--ao-dim2:#2a5a52;--ao-cyan:#5ff2ff;--ao-teal:#3ef0b3;--ao-violet:#b07cff;--ao-magenta:#ff5ea8;--ao-amber:#ffc857;--ao-blue:#7aa2ff;--ao-lime:#b6ff7a;--ao-alert:#ff5f6d;--ao-line:rgba(95,242,255,.2);--ao-line-soft:rgba(95,242,255,.09);--ao-glow:rgba(95,242,255,.32);--ao-rail-l:clamp(184px,14.5vw,308px);--ao-rail-r:clamp(196px,15vw,320px);--ao-bottom-h:clamp(142px,17.5vh,198px)}
.ao-root::before{content:"";position:absolute;inset:5px;z-index:4;pointer-events:none;opacity:.5;background:linear-gradient(var(--ao-cyan),var(--ao-cyan)) left top/14px 1px no-repeat,linear-gradient(var(--ao-cyan),var(--ao-cyan)) left top/1px 14px no-repeat,linear-gradient(var(--ao-teal),var(--ao-teal)) right top/14px 1px no-repeat,linear-gradient(var(--ao-teal),var(--ao-teal)) right top/1px 14px no-repeat,linear-gradient(var(--ao-violet),var(--ao-violet)) left bottom/14px 1px no-repeat,linear-gradient(var(--ao-violet),var(--ao-violet)) left bottom/1px 14px no-repeat,linear-gradient(var(--ao-amber),var(--ao-amber)) right bottom/14px 1px no-repeat,linear-gradient(var(--ao-amber),var(--ao-amber)) right bottom/1px 14px no-repeat}
.ao-canvas{position:absolute;inset:0;z-index:0;display:block;width:100%;height:100%;background:#030a0c;pointer-events:auto;touch-action:none}
.ao-vignette{position:absolute;inset:0;z-index:1;pointer-events:none;background:radial-gradient(ellipse 80% 74% at 52% 46%,transparent 0%,transparent 50%,rgba(0,0,0,.32) 78%,rgba(0,0,0,.7) 100%)}
.ao-scanlines{position:absolute;inset:0;z-index:3;pointer-events:none;opacity:.1;mix-blend-mode:multiply;background:repeating-linear-gradient(0deg,rgba(0,0,0,.95) 0px,rgba(0,0,0,.95) 1px,transparent 1px,transparent 3px);animation:aoScanMove 7s linear infinite}
.ao-header,.ao-main,.ao-bottom{position:relative;z-index:2}
.ao-header{display:flex;align-items:center;gap:14px;min-height:44px;padding:6px 12px 7px;border:1px solid var(--ao-line);border-top-color:rgba(95,242,255,.38);background:linear-gradient(180deg,rgba(4,18,15,.85),rgba(3,10,12,.55));box-shadow:inset 0 1px 0 rgba(232,255,246,.06),0 6px 24px rgba(0,0,0,.4);pointer-events:auto}
.ao-header::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,rgba(95,242,255,.6),rgba(62,240,179,.4),transparent)}
.ao-brand{display:flex;flex-direction:column;gap:3px;min-width:0;flex:0 1 auto}
.ao-brand-line{display:flex;align-items:baseline;gap:8px;white-space:nowrap}
.ao-brand-title{font-size:14px;font-weight:600;letter-spacing:.22em;color:var(--ao-white);text-shadow:0 0 10px rgba(95,242,255,.45)}
.ao-brand-slash{font-size:10px;color:var(--ao-dim);letter-spacing:.08em}
.ao-brand-sub{font-size:8px;color:var(--ao-dim);letter-spacing:.17em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-head-pills{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;flex:1 1 auto}
.ao-chip{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border:1px solid var(--ao-line-soft);background:rgba(4,18,15,.55);color:var(--ao-dim);font-size:8px;letter-spacing:.15em;white-space:nowrap}
.ao-chip b{color:var(--ao-white);font-weight:500;letter-spacing:.12em}
.ao-chip-dot{width:4px;height:4px;background:currentColor;box-shadow:0 0 6px currentColor;animation:aoSoftPulse 2.6s ease-in-out infinite}
.ao-chip.teal{color:var(--ao-teal);border-color:rgba(62,240,179,.34)}.ao-chip.teal b{color:var(--ao-teal)}
.ao-chip.cyan{color:var(--ao-cyan);border-color:rgba(95,242,255,.34)}.ao-chip.cyan b{color:var(--ao-cyan)}
.ao-chip.blue{color:var(--ao-blue);border-color:rgba(122,162,255,.34)}.ao-chip.blue b{color:var(--ao-blue)}
.ao-chip.violet{color:var(--ao-violet);border-color:rgba(176,124,255,.34)}.ao-chip.violet b{color:var(--ao-violet)}
.ao-chip.amber{color:var(--ao-amber);border-color:rgba(255,200,87,.34)}.ao-chip.amber b{color:var(--ao-amber)}
.ao-chip.lime{color:var(--ao-lime);border-color:rgba(182,255,122,.34)}.ao-chip.lime b{color:var(--ao-lime)}
.ao-chip.rose{color:var(--ao-alert);border-color:rgba(255,95,109,.38)}.ao-chip.rose b{color:var(--ao-alert)}
.ao-head-right{margin-left:auto;display:flex;align-items:center;gap:14px;flex:0 0 auto;min-width:0}
.ao-kicker{font-size:7px;color:var(--ao-dim);letter-spacing:.22em}
.ao-uptime,.ao-clock{display:flex;flex-direction:column;align-items:flex-end;gap:1px;white-space:nowrap}
.ao-uptime-val{font-size:11px;color:var(--ao-white);letter-spacing:.14em}
.ao-clock-val{font-size:16px;font-weight:600;color:var(--ao-white);letter-spacing:.06em;text-shadow:0 0 12px rgba(95,242,255,.3)}
.ao-mode{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border:1px solid rgba(182,255,122,.5);background:rgba(182,255,122,.07);color:var(--ao-lime);font-size:9px;letter-spacing:.16em;white-space:nowrap;text-shadow:0 0 8px rgba(182,255,122,.4)}
.ao-mode.sim{border-color:rgba(255,200,87,.45);background:rgba(255,200,87,.06);color:var(--ao-amber);text-shadow:0 0 8px rgba(255,200,87,.35)}
.ao-mode-dot{width:5px;height:5px;border-radius:50%;background:currentColor;box-shadow:0 0 7px currentColor;animation:aoSoftPulse 1.7s ease-in-out infinite}
.ao-close{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 7px;border:1px solid var(--ao-line-soft);background:rgba(4,18,15,.5);color:var(--ao-dim);cursor:pointer;font:inherit;letter-spacing:.14em;pointer-events:auto}
.ao-close:hover,.ao-close:focus-visible{border-color:rgba(255,95,109,.6);color:var(--ao-alert);outline:none;background:rgba(255,95,109,.08)}
.ao-close-k{font-size:6.5px;letter-spacing:.18em}
.ao-close-x{font-size:14px;line-height:1;color:var(--ao-white)}
.ao-close:hover .ao-close-x{color:var(--ao-alert)}
.ao-main{display:grid;grid-template-columns:var(--ao-rail-l) minmax(0,1fr) var(--ao-rail-r);gap:9px;min-height:0;pointer-events:none}
.ao-left,.ao-right{display:flex;flex-direction:column;gap:9px;min-height:0;min-width:0;pointer-events:auto}
.ao-left{grid-column:1}
.ao-right{grid-column:3}
.ao-center{position:relative;grid-column:2;min-width:0;min-height:0;pointer-events:none}
.ao-ctag{position:absolute;display:flex;align-items:center;gap:5px;font-size:7.5px;letter-spacing:.24em;color:rgba(232,255,246,.42);text-shadow:0 0 8px rgba(95,242,255,.18);white-space:nowrap}
.ao-ctag b{font-weight:500;font-size:8px;color:var(--ao-cyan)}
.ao-ctag.tl{top:2px;left:4px}
.ao-ctag.br{bottom:2px;right:4px;text-align:right}
.ao-edge{position:absolute;right:3px;top:50%;transform:translateY(-50%) rotate(90deg);transform-origin:center;font-size:7px;letter-spacing:.42em;color:rgba(63,127,116,.75);white-space:nowrap}
.ao-panel{position:relative;display:flex;flex-direction:column;min-height:0;min-width:0;border:1px solid var(--ao-line-soft);background:linear-gradient(180deg,var(--ao-panel),rgba(3,10,12,.62));box-shadow:inset 0 1px 0 rgba(95,242,255,.05),0 8px 22px rgba(0,0,0,.32);pointer-events:auto}
.ao-panel::before{content:"";position:absolute;inset:-1px;pointer-events:none;opacity:.55;background:linear-gradient(var(--ao-cyan),var(--ao-cyan)) left top/7px 1px no-repeat,linear-gradient(var(--ao-cyan),var(--ao-cyan)) left top/1px 7px no-repeat,linear-gradient(var(--ao-teal),var(--ao-teal)) right top/7px 1px no-repeat,linear-gradient(var(--ao-teal),var(--ao-teal)) right top/1px 7px no-repeat,linear-gradient(var(--ao-violet),var(--ao-violet)) left bottom/7px 1px no-repeat,linear-gradient(var(--ao-violet),var(--ao-violet)) left bottom/1px 7px no-repeat,linear-gradient(var(--ao-amber),var(--ao-amber)) right bottom/7px 1px no-repeat,linear-gradient(var(--ao-amber),var(--ao-amber)) right bottom/1px 7px no-repeat}
.ao-panel.ao-grow{flex:1 1 auto;min-height:0}
.ao-panel-head{display:flex;align-items:center;gap:8px;height:23px;padding:0 8px;flex:0 0 auto;border-bottom:1px solid var(--ao-line-soft);background:rgba(4,18,15,.5)}
.ao-panel-title{font-size:8.5px;letter-spacing:.22em;color:var(--ao-cyan);text-shadow:0 0 8px rgba(95,242,255,.3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-panel-meta{margin-left:auto;font-size:7.5px;color:var(--ao-dim);letter-spacing:.15em;white-space:nowrap}
.ao-panel-body{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;padding:6px 8px}
.ao-stats{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}
.ao-stat{padding:2px 0 3px;border-bottom:1px dashed rgba(95,242,255,.08)}
.ao-stat-lbl{font-size:7px;color:var(--ao-dim);letter-spacing:.2em}
.ao-stat-val{font-size:20px;line-height:1;color:var(--ao-white);font-weight:600;letter-spacing:.01em;text-shadow:0 0 12px rgba(95,242,255,.25)}
.ao-stat-val.small{font-size:15px;letter-spacing:.03em}
.ao-stat-sub{font-size:6.5px;color:var(--ao-dim2);letter-spacing:.15em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-stat.teal .ao-stat-val{color:var(--ao-teal);text-shadow:0 0 12px rgba(62,240,179,.3)}
.ao-stat.cyan .ao-stat-val{color:var(--ao-cyan);text-shadow:0 0 12px rgba(95,242,255,.3)}
.ao-stat.blue .ao-stat-val{color:var(--ao-blue);text-shadow:0 0 12px rgba(122,162,255,.3)}
.ao-stat.lime .ao-stat-val{color:var(--ao-lime);text-shadow:0 0 12px rgba(182,255,122,.28)}
.ao-stat.violet .ao-stat-val{color:var(--ao-violet);text-shadow:0 0 12px rgba(176,124,255,.3)}
.ao-stat.rose .ao-stat-val{color:var(--ao-alert);text-shadow:0 0 12px rgba(255,95,109,.35)}
.ao-load{display:flex;align-items:center;gap:6px;margin-top:6px}
.ao-load-lbl{font-size:7px;color:var(--ao-dim);letter-spacing:.18em;white-space:nowrap}
.ao-load-track{position:relative;flex:1 1 auto;height:4px;background:rgba(95,242,255,.08);box-shadow:inset 0 0 0 1px rgba(95,242,255,.1)}
.ao-load-fill{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,var(--ao-violet),var(--ao-blue),var(--ao-cyan));box-shadow:0 0 8px rgba(95,242,255,.5);transition:width .6s linear}
.ao-load-val{font-size:7.5px;color:var(--ao-cyan);letter-spacing:.1em}
.ao-roster{display:flex;flex-direction:column}
.ao-roster-row{display:grid;grid-template-columns:7px minmax(0,1fr) auto auto;grid-template-rows:12px 10px;column-gap:5px;padding:2px 3px;border-bottom:1px dashed rgba(95,242,255,.07);min-width:0;cursor:pointer}
.ao-roster-row:hover,.ao-roster-row.is-hovered{background:rgba(95,242,255,.06)}
.ao-roster-row.is-selected{background:rgba(95,242,255,.13);box-shadow:inset 2px 0 0 var(--ao-cyan)}
.ao-roster-row .ao-dot{grid-row:1/span 2;grid-column:1;align-self:center}
.ao-roster-name{grid-row:1;grid-column:2;font-size:8.5px;color:var(--ao-white);letter-spacing:.12em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-roster-role{grid-row:1;grid-column:3;font-size:6.5px;color:var(--ao-dim);letter-spacing:.14em;border:1px solid rgba(62,240,179,.28);padding:0 3px;white-space:nowrap}
.ao-roster-role.sub{color:var(--ao-blue);border-color:rgba(122,162,255,.3)}
.ao-roster-meta{grid-row:1;grid-column:4;font-size:7px;color:var(--ao-dim);letter-spacing:.08em;white-space:nowrap}
.ao-roster-act{grid-row:2;grid-column:2/span 3;font-size:7px;color:var(--ao-dim);letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-dot{width:5px;height:5px;border-radius:50%;display:inline-block;flex:0 0 auto;background:var(--ao-dim2)}
.ao-dot.running{background:var(--ao-teal);box-shadow:0 0 7px var(--ao-teal);animation:aoSoftPulse 1.6s ease-in-out infinite}
.ao-dot.standby{background:var(--ao-amber);box-shadow:0 0 6px rgba(255,200,87,.7)}
.ao-dot.ok{background:var(--ao-lime);box-shadow:0 0 5px rgba(182,255,122,.7)}
.ao-dot.error{background:var(--ao-alert);box-shadow:0 0 6px rgba(255,95,109,.8)}
.ao-dot.idle{background:var(--ao-dim2)}
.ao-empty{display:flex;align-items:center;justify-content:center;height:100%;min-height:30px;font-size:7.5px;color:var(--ao-dim2);letter-spacing:.2em;text-align:center;padding:4px}
.ao-buffer{display:flex;flex-direction:column}
.ao-buffer-row{display:grid;grid-template-columns:20px 56px minmax(0,1fr) 30px;gap:5px;align-items:center;height:17px;border-bottom:1px dashed rgba(95,242,255,.07);font-size:8px;min-width:0;cursor:pointer}
.ao-buffer-row:hover,.ao-buffer-row.is-hovered{background:rgba(95,242,255,.07)}
.ao-buffer-row.is-selected{background:rgba(95,242,255,.14);box-shadow:inset 2px 0 0 var(--ao-cyan)}
.ao-buffer-idx{font-size:6.5px;color:var(--ao-dim2);letter-spacing:.06em}
.ao-buffer-name{color:var(--ao-cyan);letter-spacing:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-buffer-target{color:var(--ao-amber);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:7.5px;opacity:.85}
.ao-tag{display:inline-block;font-size:6.5px;letter-spacing:.1em;line-height:1.35;padding:0 3px;border:1px solid currentColor;text-align:center;white-space:nowrap;color:var(--ao-cyan)}
.ao-tag.run{color:var(--ao-cyan);animation:aoSoftPulse 1.6s ease-in-out infinite}
.ao-tag.ok{color:var(--ao-teal)}
.ao-tag.err{color:var(--ao-alert)}
.ao-tag.wait{color:var(--ao-amber)}
.ao-tag.info{color:var(--ao-dim)}
.ao-reg{display:flex;flex-direction:column}
.ao-reg-row{display:grid;grid-template-columns:7px minmax(0,1fr) auto auto;gap:5px;align-items:center;height:17px;border-bottom:1px dashed rgba(95,242,255,.07);font-size:8px;min-width:0;cursor:pointer}
.ao-reg-row:hover,.ao-reg-row.is-hovered{background:rgba(62,240,179,.06)}
.ao-reg-row.is-selected{background:rgba(62,240,179,.13);box-shadow:inset 2px 0 0 var(--ao-teal)}
.ao-reg-name{color:var(--ao-white);letter-spacing:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-reg-role{font-size:6.5px;color:var(--ao-blue);letter-spacing:.12em}
.ao-reg-meta{font-size:6.5px;color:var(--ao-dim2);letter-spacing:.08em;white-space:nowrap}
.ao-reg-foot{display:flex;align-items:center;justify-content:space-between;margin-top:5px;font-size:6.5px;color:var(--ao-dim);letter-spacing:.14em}
.ao-bottom{display:grid;grid-template-columns:1.25fr 1.05fr 1.1fr .9fr;gap:9px;height:var(--ao-bottom-h);min-height:0;pointer-events:auto}
.ao-bottom>.ao-panel{height:100%}
.ao-feed{display:flex;flex-direction:column;justify-content:flex-end;height:100%;overflow:hidden;position:relative;margin:-6px -8px;padding:6px 8px 2px}
.ao-feed::before{content:"";position:absolute;left:0;right:0;top:0;height:18px;z-index:1;pointer-events:none;background:linear-gradient(180deg,rgba(3,10,12,.95),transparent)}
.ao-feed-row{display:grid;grid-template-columns:24px 34px 44px minmax(0,1.15fr) minmax(0,.85fr);gap:5px;align-items:center;height:14px;flex:0 0 auto;font-size:8px;white-space:nowrap;overflow:hidden;border-left:2px solid transparent;padding-left:2px;min-width:0}
.ao-feed-row.is-clickable{cursor:pointer}
.ao-feed-row.is-clickable:hover{background:rgba(95,242,255,.06)}
.ao-feed-seq{color:var(--ao-dim2);font-size:7px}
.ao-feed-time{color:var(--ao-dim2);font-size:7px}
.ao-feed-kind{color:var(--ao-dim);letter-spacing:.1em;font-size:7px}
.ao-feed-label{color:#c9efe3;overflow:hidden;text-overflow:ellipsis;letter-spacing:.06em}
.ao-feed-detail{color:var(--ao-dim);overflow:hidden;text-overflow:ellipsis;font-size:7.5px}
.ao-feed-row.newest{border-left-color:var(--ao-cyan);background:linear-gradient(90deg,rgba(95,242,255,.1),transparent)}
.ao-feed-row.newest .ao-feed-label{color:var(--ao-white)}
.ao-feed-row.is-hovered{background:rgba(176,124,255,.12);border-left-color:var(--ao-violet)}
.ao-feed-row.is-selected{background:rgba(95,242,255,.16);border-left-color:var(--ao-cyan)}
.ao-feed-row.run .ao-feed-kind{color:var(--ao-cyan)}
.ao-feed-row.ok .ao-feed-kind{color:var(--ao-teal)}
.ao-feed-row.error .ao-feed-kind,.ao-feed-row.error .ao-feed-label{color:var(--ao-alert)}
.ao-feed-row.warn .ao-feed-kind{color:var(--ao-amber)}
.ao-k-tool{color:var(--ao-cyan)}
.ao-k-step{color:var(--ao-blue)}
.ao-k-model{color:var(--ao-violet)}
.ao-k-turn{color:var(--ao-teal)}
.ao-k-system{color:var(--ao-dim)}
.ao-k-operator{color:var(--ao-magenta)}
.ao-k-agent{color:var(--ao-lime)}
.ao-k-default{color:var(--ao-blue)}
.ao-feed-cursor{display:flex;align-items:center;gap:5px;height:13px;flex:0 0 auto;font-size:7px;color:var(--ao-dim);letter-spacing:.14em;border-top:1px solid rgba(95,242,255,.1);padding-top:3px;margin-top:2px}
.ao-blink{animation:aoBlink 1.2s steps(1,end) infinite;color:var(--ao-cyan)}
.ao-profile{display:flex;flex-direction:column;height:100%;min-height:0}
.ao-trace-wrap{position:relative;flex:0 0 auto;height:52px;border:1px solid rgba(95,242,255,.1);background:rgba(4,18,15,.32);overflow:hidden;margin-bottom:4px}
.ao-trace{display:block;width:100%;height:100%}
.ao-trace-tag{position:absolute;left:4px;bottom:2px;font-size:6px;color:rgba(95,242,255,.6);letter-spacing:.2em}
.ao-file-row{display:grid;grid-template-columns:8px minmax(0,1fr) 54px 34px;gap:4px;align-items:center;height:13px;flex:0 0 auto;font-size:7.5px;min-width:0}
.ao-file-square{width:7px;height:7px;background:var(--ao-amber);box-shadow:0 0 5px rgba(255,200,87,.5);flex:0 0 auto}
.ao-file-path{color:var(--ao-white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.04em;opacity:.85}
.ao-file-count{color:var(--ao-dim2);font-size:6.5px;letter-spacing:.06em;white-space:nowrap}
.ao-file-bar{position:relative;height:3px;background:rgba(95,242,255,.08);overflow:hidden}
.ao-file-bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,var(--ao-teal),var(--ao-cyan));box-shadow:0 0 6px rgba(95,242,255,.5)}
.ao-tabs{display:flex;align-items:center;gap:4px;margin-top:auto;padding-top:4px;flex:0 0 auto}
.ao-tab{font-size:6.5px;letter-spacing:.18em;padding:1px 6px;border:1px solid var(--ao-line-soft);color:var(--ao-dim);white-space:nowrap}
.ao-tab.on{color:var(--ao-bg);background:var(--ao-cyan);border-color:var(--ao-cyan);font-weight:600;box-shadow:0 0 10px rgba(95,242,255,.45)}
.ao-tabs-meta{margin-left:auto;font-size:6.5px;color:var(--ao-dim2);letter-spacing:.12em;white-space:nowrap}
.ao-chan{display:flex;flex-direction:column;height:100%;min-height:0}
.ao-chan-row{display:grid;grid-template-columns:28px 52px minmax(0,1fr) 30px;gap:5px;align-items:center;height:15px;flex:0 0 auto;border-bottom:1px dashed rgba(95,242,255,.07);font-size:7.5px;min-width:0}
.ao-chan-ch{color:var(--ao-dim2);font-size:6.5px;letter-spacing:.1em}
.ao-chan-name{color:var(--ao-cyan);letter-spacing:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-chan-target{color:var(--ao-amber);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:7px;opacity:.85}
.ao-chan-prompt{display:flex;align-items:center;gap:4px;margin-top:auto;padding-top:3px;flex:0 0 auto;font-size:7px;color:var(--ao-dim);letter-spacing:.12em;border-top:1px solid rgba(95,242,255,.1);white-space:nowrap}
.ao-prompt-glyph{color:var(--ao-cyan);text-shadow:0 0 8px rgba(95,242,255,.6)}
.ao-telemetry{display:flex;flex-direction:column;height:100%;min-height:0}
.ao-spark-wrap{position:relative;flex:0 0 auto;height:34px;border:1px solid rgba(95,242,255,.1);background:rgba(4,18,15,.3);overflow:hidden;margin-bottom:5px}
.ao-spark{display:block;width:100%;height:100%}
.ao-spark-tag{position:absolute;right:4px;top:2px;font-size:5.5px;color:rgba(95,242,255,.55);letter-spacing:.16em}
.ao-tele-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px 8px;flex:0 0 auto}
.ao-tele-cell{display:flex;flex-direction:column;min-width:0}
.ao-tele-k{font-size:6px;color:var(--ao-dim2);letter-spacing:.16em;white-space:nowrap}
.ao-tele-v{font-size:9px;color:var(--ao-white);letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-tele-v.cyan{color:var(--ao-cyan)}
.ao-tele-v.violet{color:var(--ao-violet)}
.ao-tele-v.teal{color:var(--ao-teal)}
.ao-tele-v.amber{color:var(--ao-amber)}
.ao-tele-v.rose{color:var(--ao-alert)}
.ao-bars{display:flex;align-items:flex-end;gap:2px;height:16px;margin-top:auto;padding-top:4px;flex:0 0 auto}
.ao-bar{flex:1 1 0;min-height:1px;background:linear-gradient(180deg,var(--ao-cyan),rgba(176,124,255,.5));box-shadow:0 0 4px rgba(95,242,255,.3)}
.ao-inspector{flex:0 0 auto;max-height:46%;min-height:104px}
.ao-insp-body{display:flex;flex-direction:column;gap:3px;min-height:0;overflow:hidden;padding:4px 8px 5px}
.ao-insp-top{display:flex;align-items:center;gap:6px;min-width:0}
.ao-mk{display:inline-block;font-size:6.5px;letter-spacing:.12em;line-height:1.4;padding:0 4px;border:1px solid currentColor;white-space:nowrap;color:var(--ao-cyan)}
.ao-mk-tool{color:var(--ao-cyan)}
.ao-mk-file{color:var(--ao-amber)}
.ao-mk-thought{color:var(--ao-blue)}
.ao-mk-answer{color:var(--ao-violet)}
.ao-mk-agent{color:var(--ao-teal)}
.ao-mk-emitter{color:var(--ao-magenta)}
.ao-mk-card{color:var(--ao-lime)}
.ao-mk-default{color:var(--ao-dim)}
.ao-insp-time{margin-left:auto;font-size:6.5px;color:var(--ao-dim2);letter-spacing:.08em;white-space:nowrap}
.ao-insp-label{font-size:9px;color:var(--ao-white);letter-spacing:.07em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-insp-detail{font-size:7.5px;color:var(--ao-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-insp-weight{font-size:6.5px;color:var(--ao-dim2);letter-spacing:.12em;white-space:nowrap}
.ao-insp-card{font-size:6.5px;color:var(--ao-dim2);letter-spacing:.12em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;opacity:.85}
.ao-insp-rel{display:flex;flex-direction:column;gap:0;margin-top:2px;min-height:0;overflow:hidden}
.ao-insp-rel-head{font-size:6px;color:var(--ao-dim2);letter-spacing:.18em;margin-bottom:1px;white-space:nowrap}
.ao-insp-rel-row{display:grid;grid-template-columns:32px minmax(0,1fr) 28px;gap:4px;align-items:center;height:10px;font-size:6.5px;min-width:0;white-space:nowrap}
.ao-insp-rel-kind{letter-spacing:.08em;overflow:hidden;text-overflow:ellipsis}
.ao-insp-rel-label{color:#b9d9cf;overflow:hidden;text-overflow:ellipsis;letter-spacing:.04em}
.ao-insp-rel-time{color:var(--ao-dim2);text-align:right;font-size:6px}
.ao-insp-empty{font-size:7px;color:var(--ao-dim2);letter-spacing:.16em;text-align:center;margin-top:8px}
.ao-insp-empty2{font-size:6px;color:var(--ao-dim2);letter-spacing:.1em;text-align:center;opacity:.8}
.ao-insp-hint{margin-top:auto;padding-top:4px;border-top:1px solid rgba(95,242,255,.1);font-size:6px;color:rgba(95,242,255,.6);letter-spacing:.1em;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-hover{position:fixed;left:0;top:0;z-index:8;display:none;flex-direction:column;gap:1px;min-width:120px;max-width:330px;padding:5px 8px 5px 7px;background:rgba(3,10,12,.94);border:1px solid rgba(95,242,255,.28);border-left:2px solid var(--ao-cyan);box-shadow:0 6px 20px rgba(0,0,0,.6),0 0 18px rgba(95,242,255,.14);pointer-events:none;white-space:nowrap;text-transform:uppercase;letter-spacing:.1em}
.ao-hover-kind{font-size:6.5px;color:var(--ao-cyan);letter-spacing:.16em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-hover-label{font-size:9px;color:var(--ao-white);letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-hover-detail{font-size:7px;color:var(--ao-dim);letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ao-orb-trigger{position:fixed;right:18px;bottom:64px;z-index:2147482001;display:block;width:56px;height:56px;padding:0;margin:0;border:0;border-radius:50%;background:transparent;color:#e8fff6;cursor:pointer;pointer-events:auto;outline:none;-webkit-tap-highlight-color:transparent;font-family:ui-monospace,"Cascadia Mono","SFMono-Regular","JetBrains Mono",Menlo,Consolas,"Liberation Mono",monospace;transition:transform .3s ease;transform:scale(.94);--orb-cyan:#5ff2ff;--orb-teal:#3ef0b3;--orb-violet:#b07cff;--orb-amber:#ffc857;--orb-lime:#b6ff7a;--orb-white:#e8fff6;--orb-dim:#3f7f74}
.ao-orb-trigger:hover,.ao-orb-trigger:focus-visible{transform:scale(1.05)}
.ao-orb-trigger:focus-visible{outline:1px solid rgba(95,242,255,.75);outline-offset:4px;border-radius:50%}
.ao-orb-glow{position:absolute;inset:-11px;border-radius:50%;pointer-events:none;background:radial-gradient(circle at 50% 50%,rgba(95,242,255,.2) 0%,rgba(95,242,255,.07) 40%,rgba(176,124,255,.04) 58%,transparent 70%);filter:blur(3px);animation:aoOrbBreathe 5.2s ease-in-out infinite}
.ao-orb-trigger.is-live .ao-orb-glow{background:radial-gradient(circle at 50% 50%,rgba(182,255,122,.18) 0%,rgba(95,242,255,.06) 42%,transparent 70%)}
.ao-orb-trigger.is-sim .ao-orb-glow{background:radial-gradient(circle at 50% 50%,rgba(255,200,87,.16) 0%,rgba(95,242,255,.05) 42%,transparent 70%)}
.ao-orb-ring{position:absolute;inset:0;display:block;border-radius:50%;pointer-events:none;opacity:.82;transition:opacity .3s ease}
.ao-orb-trigger:hover .ao-orb-ring,.ao-orb-trigger:focus-visible .ao-orb-ring{opacity:1}
.ao-orb-svg{position:absolute;inset:0;display:block;width:100%;height:100%;overflow:visible}
.ao-orb-arc{fill:none;stroke-linecap:round}
.ao-orb-arc.a{stroke:var(--orb-cyan);stroke-width:1.2;stroke-dasharray:19 13 6 24;opacity:.92;filter:drop-shadow(0 0 2px rgba(95,242,255,.8));animation:aoOrbDashA 20s linear infinite}
.ao-orb-arc.b{stroke:var(--orb-teal);stroke-width:1;stroke-dasharray:5 9 15 9;opacity:.85;filter:drop-shadow(0 0 2px rgba(62,240,179,.7));animation:aoOrbDashB 13s linear infinite}
.ao-orb-arc.c{stroke:var(--orb-violet);stroke-width:.9;stroke-dasharray:23 11 7 19;opacity:.8;filter:drop-shadow(0 0 2px rgba(176,124,255,.65));animation:aoOrbDashC 26s linear infinite}
.ao-orb-core{fill:var(--orb-white);filter:drop-shadow(0 0 4px rgba(95,242,255,.95));animation:aoOrbCore 2.9s ease-in-out infinite}
.ao-orb-trigger.is-live .ao-orb-core{fill:var(--orb-lime);filter:drop-shadow(0 0 4px rgba(182,255,122,.95))}
.ao-orb-trigger.is-sim .ao-orb-core{fill:var(--orb-amber);filter:drop-shadow(0 0 4px rgba(255,200,87,.9))}
.ao-orb-scan{position:absolute;left:18%;right:18%;top:0;height:10px;border-radius:50%;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(232,255,246,.24),transparent);opacity:.4;animation:aoOrbScan 4.4s ease-in-out infinite}
.ao-orb-tag{position:absolute;right:calc(100% + 12px);bottom:9px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;padding:5px 9px 5px 11px;text-align:right;white-space:nowrap;pointer-events:none;opacity:0;transform:translateX(8px);transition:opacity .26s ease,transform .26s ease;background:linear-gradient(90deg,rgba(3,10,12,0),rgba(3,10,12,.82));border-top:1px solid rgba(95,242,255,.16);border-bottom:1px solid rgba(95,242,255,.16)}
.ao-orb-tag::before{content:"";position:absolute;left:0;top:-1px;width:7px;height:7px;border-left:1px solid rgba(95,242,255,.6);border-top:1px solid rgba(95,242,255,.6)}
.ao-orb-tag::after{content:"";position:absolute;left:0;bottom:-1px;width:7px;height:7px;border-left:1px solid rgba(95,242,255,.6);border-bottom:1px solid rgba(95,242,255,.6)}
.ao-orb-tag-main{font-size:9px;letter-spacing:.24em;color:var(--orb-white);text-transform:uppercase;text-shadow:0 0 8px rgba(95,242,255,.45)}
.ao-orb-tag-sub{font-size:6px;letter-spacing:.2em;color:var(--orb-dim);text-transform:uppercase}
.ao-orb-trigger:hover .ao-orb-tag,.ao-orb-trigger:focus-visible .ao-orb-tag{opacity:1;transform:translateX(0)}
@keyframes aoOrbDashA{from{stroke-dashoffset:0}to{stroke-dashoffset:-62}}
@keyframes aoOrbDashB{from{stroke-dashoffset:38}to{stroke-dashoffset:0}}
@keyframes aoOrbDashC{from{stroke-dashoffset:0}to{stroke-dashoffset:-60}}
@keyframes aoOrbBreathe{0%,100%{opacity:.6;transform:scale(.97)}50%{opacity:1;transform:scale(1.05)}}
@keyframes aoOrbCore{0%,100%{opacity:.7}50%{opacity:1}}
@keyframes aoOrbScan{0%{transform:translateY(6px);opacity:0}12%{opacity:.5}55%{transform:translateY(30px);opacity:.25}70%,100%{transform:translateY(38px);opacity:0}}
@keyframes aoSoftPulse{0%,100%{opacity:1}50%{opacity:.42}}
@keyframes aoBlink{0%,49%{opacity:1}50%,100%{opacity:.12}}
@keyframes aoScanMove{0%{background-position:0 0}100%{background-position:0 6px}}
@media (max-width:1560px){.ao-root{--ao-rail-l:188px;--ao-rail-r:202px}.ao-chip.hide-mid{display:none}.ao-brand-title{font-size:13px}.ao-uptime-val{font-size:10px}}
@media (max-width:1380px){.ao-root{gap:7px;padding:8px 10px 10px;--ao-rail-l:182px;--ao-rail-r:192px}.ao-uptime{display:none}.ao-clock-val{font-size:14px}.ao-chip.hide-sm{display:none}.ao-brand-title{font-size:12px}.ao-brand-sub{font-size:7px}.ao-head-right{gap:10px}}
@media (max-width:1180px){.ao-root{--ao-rail-l:178px;--ao-bottom-h:150px}.ao-main{grid-template-columns:var(--ao-rail-l) minmax(0,1fr)}.ao-right{display:none}.ao-bottom{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;height:calc(var(--ao-bottom-h) + 96px)}.ao-head-pills{gap:4px}}
@media (max-width:980px){.ao-left{display:none}.ao-main{grid-template-columns:minmax(0,1fr)}.ao-bottom{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;height:calc(var(--ao-bottom-h) + 130px)}.ao-bottom>.ao-panel:nth-child(3),.ao-bottom>.ao-panel:nth-child(4){display:none}}
@media (max-height:800px){.ao-root{gap:6px;padding:7px 9px 8px;--ao-bottom-h:136px}.ao-header{min-height:38px;padding:4px 10px 5px}.ao-brand-title{font-size:12px}.ao-stat-val{font-size:17px}.ao-stat-sub{font-size:6px}.ao-panel-head{height:20px}.ao-panel-title{font-size:8px}.ao-roster-row{grid-template-rows:11px 9px}.ao-trace-wrap{height:42px}.ao-inspector{max-height:44%;min-height:92px}.ao-insp-rel{display:none}}
@media (max-height:680px){.ao-root{--ao-bottom-h:124px}.ao-brand-sub{display:none}.ao-load{display:none}.ao-trace-wrap{display:none}.ao-spark-wrap{height:26px}.ao-clock-val{font-size:13px}.ao-inspector{min-height:78px}.ao-insp-empty2{display:none}}
@media (prefers-reduced-motion:reduce){.ao-root *,.ao-root *::before,.ao-root *::after,.ao-root::before,.ao-root::after,.ao-orb-trigger,.ao-orb-trigger *,.ao-orb-trigger *::before,.ao-orb-trigger *::after,.ao-orb-trigger::before,.ao-orb-trigger::after{animation:none !important;transition:none !important}}
`;

// ── typed sample runs used by the simulation (deterministic given the seed) ──

const AO_SIM_TOOLS = [
  { name: 'read', w: 5, targets: ['src/hud.js', 'agent-ops/CONTRACT.md', 'src/entry.js', 'ref/contact.jpg', 'agent-ops/index.js'] },
  { name: 'grep', w: 4, targets: ['createScene', 'AO_CSS', 'shell.overlay', 'task-6', 'tool/call'] },
  { name: 'glob', w: 2, targets: ['agent-ops/src/*.js', 'ref/frames/*.jpg', 'locale/*.json'] },
  { name: 'edit', w: 4, targets: ['src/hud.js', 'src/entry.js'] },
  { name: 'write', w: 2, targets: ['src/hud.js'] },
  { name: 'bash', w: 3, targets: ['node --check src/hud.js', 'node --check src/scene.js', 'git status --short'] },
  { name: 'pwsh', w: 2, targets: ['Get-ChildItem agent-ops', 'node --check src/hud.js'] },
  { name: 'web_search', w: 2, targets: ['hud console reference', 'canvas particle field'] },
  { name: 'send_message', w: 2, targets: ['lead', 'scene-engine', 'hud-wire'] },
  { name: 'skill', w: 1, targets: ['frontend-design', 'cordis-plugin-development'] },
  { name: 'read_image', w: 1, targets: ['ref/frames/f_05.jpg', 'ref/frames/f_10.jpg'] },
  { name: 'present', w: 1, targets: ['hud.js'] },
  { name: 'subagent', w: 1, targets: ['scene perf audit', 'state wire review'] },
];

const AO_SIM_FILES = [
  'src/hud.js',
  'src/scene.js',
  'src/entry.js',
  'agent-ops/CONTRACT.md',
  'agent-ops/index.js',
  'ref/contact.jpg',
  'ref/frames/f_10.jpg',
  'agent-ops/build.mjs',
];

const AO_SIM_AGENT_NAMES = ['SCOUT', 'TRACE', 'PATCH', 'RELAY', 'ORBIT', 'VECTOR', 'CIPHER', 'MONO'];

const AO_SIM_ACTIVITIES = [
  'TRACE RECON · REF FRAMES',
  'HUD DIFF MONITOR',
  'STATE WIRE PROBE',
  'SCENE PERF AUDIT',
  'LAYOUT DESK · RAILS',
  'TOOLCHAIN WATCH',
  'TELEMETRY SAMPLE',
];

const AO_SIM_DETAILS = [
  'hud chrome · panels wired',
  'scene model push accepted',
  'memory cloud sync nominal',
  'interaction callbacks armed',
  'poll budget held · 1100ms',
  'canvas ownership confirmed',
  'reduced motion path armed',
  'cleanup arms verified',
  'render budget within plan',
  'dispatch buffer flushed',
];

const AO_TRACE_PATHS = (function () {
  const out = [];
  let seed = 0x9e3779b9;
  const rnd = function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let p = 0; p < 4; p += 1) {
    let x = 4 + rnd() * 18;
    let y = 6 + rnd() * 26;
    let d = 'M' + x.toFixed(1) + ',' + y.toFixed(1);
    for (let i = 0; i < 8; i += 1) {
      x = Math.min(97, x + 6 + rnd() * 12);
      y = Math.max(4, Math.min(36, y + (rnd() - 0.5) * 14));
      d += ' L' + x.toFixed(1) + ',' + y.toFixed(1);
    }
    out.push(d);
  }
  return out;
})();

const AO_TRACE_DOTS = (function () {
  const out = [];
  let seed = 0x51ed270b;
  const rnd = function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 26; i += 1) {
    out.push({ x: Number((4 + rnd() * 92).toFixed(1)), y: Number((4 + rnd() * 32).toFixed(1)), r: Number((0.5 + rnd() * 0.8).toFixed(2)) });
  }
  return out;
})();

// ── small helpers ───────────────────────────────────────────────────────────

function aoNum(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return fallback == null ? 0 : fallback;
}

function aoPad(value, width) {
  const w = Math.max(1, aoNum(width, 2));
  const n = Math.max(0, Math.floor(aoNum(value)));
  const s = String(n);
  return s.length >= w ? s : '0'.repeat(w - s.length) + s;
}

function aoClamp(value, min, max) {
  const n = aoNum(value);
  return n < min ? min : n > max ? max : n;
}

function aoUpper(value) {
  return String(value == null ? '' : value).toUpperCase();
}

function aoClip(value, max) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const m = Math.max(1, aoNum(max, 32));
  return s.length > m ? s.slice(0, m - 1) + '…' : s;
}

function aoArr(value) {
  return Array.isArray(value) ? value : [];
}

function aoFmtK(value) {
  const v = Math.max(0, Math.round(aoNum(value)));
  if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'K';
  return String(v);
}

function aoClock(at) {
  try {
    const d = new Date(aoNum(at, Date.now()));
    return aoPad(d.getHours()) + ':' + aoPad(d.getMinutes()) + ':' + aoPad(d.getSeconds());
  } catch (err) {
    return '--:--:--';
  }
}

function aoClockShort(at) {
  try {
    const d = new Date(aoNum(at, Date.now()));
    return aoPad(d.getMinutes()) + ':' + aoPad(d.getSeconds());
  } catch (err) {
    return '--:--';
  }
}

function aoDur(ms) {
  const total = Math.max(0, Math.floor(aoNum(ms) / 1000));
  return aoPad(Math.floor(total / 3600)) + ':' + aoPad(Math.floor((total % 3600) / 60)) + ':' + aoPad(total % 60);
}

function aoAgo(at, now) {
  const d = Math.max(0, aoNum(now, Date.now()) - aoNum(at, Date.now()));
  if (d < 1500) return 'now';
  if (d < 60000) return Math.round(d / 1000) + 's ago';
  if (d < 3600000) return Math.round(d / 60000) + 'm ago';
  return Math.round(d / 3600000) + 'h ago';
}

function aoHash(text) {
  let h = 2166136261;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function aoBaseName(path) {
  const s = String(path || '').replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

function aoShortPath(path, max) {
  const s = String(path || '').replace(/^\.\//, '');
  return aoClip(s.replace(/\\/g, '/'), max);
}

// V2 normalization kept per V3: path-looking titles become a bare uppercased basename.
function aoDisplayTitle(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  const slashed = s.replace(/\\/g, '/');
  if (slashed.indexOf('/') >= 0) {
    const base = aoBaseName(slashed.replace(/\/+$/, ''));
    const clean = base.replace(/[\\/]/g, '').trim();
    return clean ? clean.toUpperCase() : '';
  }
  return s;
}

function aoWorkspaceName(value) {
  const t = aoDisplayTitle(value);
  if (!t) return 'DEFAULT-WORKSPACE';
  return /[\\/]/.test(String(value)) ? t : t.toUpperCase();
}

function aoDotTone(status) {
  const s = aoUpper(status);
  if (s === 'RUNNING' || s === 'RUN') return 'running';
  if (s === 'STANDBY' || s === 'WAIT') return 'standby';
  if (s === 'ERROR' || s === 'ERR') return 'error';
  if (s === 'OK') return 'ok';
  return 'idle';
}

function aoToolTone(status) {
  const s = aoUpper(status);
  if (s === 'RUNNING' || s === 'RUN') return 'run';
  if (s === 'OK') return 'ok';
  if (s === 'ERROR' || s === 'ERR') return 'err';
  return 'wait';
}

function aoToolLabel(status) {
  const s = aoUpper(status);
  if (s === 'RUNNING' || s === 'RUN') return 'RUN';
  if (s === 'OK') return 'OK';
  if (s === 'ERROR' || s === 'ERR') return 'ERR';
  return 'WAIT';
}

function aoEventTone(status) {
  const s = String(status == null ? '' : status).toLowerCase();
  if (s === 'error' || s === 'err') return 'error';
  if (s === 'warn') return 'warn';
  if (s === 'run') return 'run';
  if (s === 'ok') return 'ok';
  return 'info';
}

// feed token classes / memory kinds (V3 semantic hues)
function aoKindToken(kind) {
  const k = aoUpper(kind);
  if (k === 'TOOL') return 'tool';
  if (k === 'STEP') return 'step';
  if (k === 'MODEL') return 'model';
  if (k === 'TURN') return 'turn';
  if (k === 'SYSTEM') return 'system';
  if (k === 'OPERATOR') return 'operator';
  if (k === 'AGENT') return 'agent';
  return 'default';
}

function aoKindHue(kind) {
  const k = String(kind == null ? '' : kind).toLowerCase();
  if (k === 'tool') return '#5ff2ff';
  if (k === 'file') return '#ffc857';
  if (k === 'thought') return '#7aa2ff';
  if (k === 'answer') return '#b07cff';
  if (k === 'agent') return '#3ef0b3';
  if (k === 'emitter') return '#ff5ea8';
  if (k === 'card') return '#b6ff7a';
  return '#3f7f74';
}

function aoHitKind(hit) {
  if (!hit || typeof hit !== 'object') return 'memory';
  const id = String(hit.id || '');
  if (id.indexOf('mem:') === 0) {
    const rest = id.slice(4);
    const idx = rest.indexOf(':');
    if (idx > 0) return rest.slice(0, idx);
  }
  return String(hit.type || 'memory');
}

function aoFileHue(path) {
  const s = String(path || '');
  const dot = s.lastIndexOf('.');
  const ext = dot >= 0 ? s.slice(dot + 1).toLowerCase() : '';
  if (ext === 'js' || ext === 'mjs') return '#5ff2ff';
  if (ext === 'json') return '#b6ff7a';
  if (ext === 'md') return '#7aa2ff';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp') return '#ffc857';
  return '#3f7f74';
}

function aoPushLink(links, from, to, weight) {
  if (!from || !to || from === to) return;
  for (let i = 0; i < links.length; i += 1) {
    if (links[i].from === from && links[i].to === to) return;
  }
  links.push({ from: from, to: to, weight: aoClamp(weight, 0.05, 1) });
}

function aoMulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function aoSimPick(rng, list) {
  const items = aoArr(list);
  if (!items.length) return null;
  let total = 0;
  for (let i = 0; i < items.length; i += 1) total += aoNum(items[i] && items[i].w, 1);
  let roll = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= aoNum(items[i] && items[i].w, 1);
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function aoTextPick(rng, list) {
  const items = aoArr(list);
  if (!items.length) return '';
  const i = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return String(items[i] == null ? '' : items[i]);
}

// ── synthetic fallback run ──────────────────────────────────────────────────
// Deterministic state machine + seeded PRNG: the same page load replays the same
// run, but the seed differs per load so the show is never identical.

function aoCreateSim() {
  const sim = {
    seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
    rng: null,
    t0: Date.now() - 74000,
    lastTick: Date.now(),
    elapsedMs: 74000,
    tick: 0,
    seq: 0,
    turn: 2,
    turnOpen: true,
    steps: 7,
    toolCalls: 0,
    errors: 0,
    warnings: 0,
    tokensIn: 0,
    tokensOut: 0,
    toolSeq: 0,
    agentSeq: 2,
    sessionId: 'SESSION-SIM-9F2A',
    intensity: 0.58,
    agents: [],
    tools: [],
    files: [],
    events: [],
  };
  sim.rng = aoMulberry32(sim.seed);
  aoSimSeed(sim);
  return sim;
}

function aoSimSeed(sim) {
  const now = Date.now();
  const rng = sim.rng;
  sim.tokensIn = 7200 + Math.floor(rng() * 8200);
  sim.tokensOut = 1800 + Math.floor(rng() * 2600);

  for (let i = 0; i < AO_SIM_FILES.length; i += 1) {
    sim.files.push({
      path: AO_SIM_FILES[i],
      reads: 1 + ((i * 3 + 2) % 5),
      writes: i === 0 ? 2 : i % 3,
      tool: i === 0 ? 'edit' : 'read',
      lastT: now - i * 8500,
    });
  }

  const leadTokens = 5200 + Math.floor(rng() * 6200);
  const scoutTokens = 1800 + Math.floor(rng() * 2400);
  const patchTokens = 900 + Math.floor(rng() * 1400);
  sim.agents.push(
    { id: 'a1', name: 'LEAD-01', role: 'LEAD', status: 'RUNNING', activity: 'PRIMARY LOOP · SESSION CONTROL', sessionId: 'SIM-9F2A', tools: 14, tokens: leadTokens, lastEvent: 'STEP 07 · REASONING' },
    { id: 'a2', name: 'SCOUT-02', role: 'SUBAGENT', status: 'RUNNING', activity: 'TRACE RECON · REF FRAMES', sessionId: 'SIM-9F2A/2', tools: 6, tokens: scoutTokens, lastEvent: 'READ RETURNED' },
    { id: 'a3', name: 'PATCH-03', role: 'SUBAGENT', status: 'STANDBY', activity: 'HUD DIFF MONITOR', sessionId: 'SIM-9F2A/3', tools: 3, tokens: patchTokens, lastEvent: 'STANDBY HELD' },
  );

  const seedTools = [
    { name: 'read', target: 'agent-ops/CONTRACT.md', status: 'OK', age: 64000 },
    { name: 'grep', target: 'createScene', status: 'OK', age: 55000 },
    { name: 'read_image', target: 'ref/frames/f_05.jpg', status: 'OK', age: 47000 },
    { name: 'edit', target: 'src/hud.js', status: 'OK', age: 30000 },
    { name: 'send_message', target: 'lead', status: 'OK', age: 23000 },
    { name: 'read', target: 'src/entry.js', status: 'OK', age: 16000 },
    { name: 'write', target: 'src/hud.js', status: 'OK', age: 10000 },
    { name: 'bash', target: 'node --check src/hud.js', status: 'RUNNING', age: 5000 },
  ];
  for (let i = 0; i < seedTools.length; i += 1) {
    const t = seedTools[i];
    sim.toolSeq += 1;
    sim.toolCalls += 1;
    sim.tools.push({
      id: 't' + sim.toolSeq,
      name: t.name,
      target: t.target,
      status: t.status,
      turn: 2,
      step: 6 + (i % 2),
      t: now - t.age,
      startedAt: now - t.age,
      ticksLeft: t.status === 'RUNNING' ? 2 : 0,
      agentId: i < 4 ? 'a1' : 'a2',
    });
    if (t.status !== 'RUNNING') aoSimTouchFile(sim, t.name, t.target);
  }

  const seedEvents = [
    ['SYSTEM', 'SEED BOUNDARY', 'inherited history', 'info', 68],
    ['TURN', 'TURN 02 ENGAGED', 'inbox dispatch', 'run', 64],
    ['STEP', 'STEP 06 · REASONING', 'turn 02', 'run', 60],
    ['TOOL', 'GREP DISPATCHED', 'createScene', 'run', 55],
    ['TOOL', 'GREP RETURNED', 'nominal · 14 hits', 'ok', 53],
    ['MODEL', 'MODEL REPLY · 9.8K TOK', 'hud chrome · panels wired', 'ok', 48],
    ['TOOL', 'READ DISPATCHED', 'agent-ops/CONTRACT.md', 'run', 44],
    ['TOOL', 'READ RETURNED', 'nominal · 170 lines', 'ok', 42],
    ['STEP', 'STEP 07 · REASONING', 'turn 02', 'run', 36],
    ['TOOL', 'EDIT DISPATCHED', 'src/hud.js', 'run', 29],
    ['TOOL', 'EDIT RETURNED', 'nominal · hunk applied', 'ok', 27],
    ['SYSTEM', 'CHECKPOINT COMMITTED', 'hud draft', 'info', 19],
    ['MODEL', 'MODEL REPLY · 12.4K TOK', 'scene model push accepted', 'ok', 11],
    ['TOOL', 'BASH DISPATCHED', 'node --check src/hud.js', 'run', 5],
  ];
  for (let i = 0; i < seedEvents.length; i += 1) {
    const e = seedEvents[i];
    aoSimEvent(sim, e[0], e[1], e[2], e[3], now - e[4] * 1000);
  }
}

function aoSimTouchFile(sim, toolName, target) {
  const name = String(toolName || '').toLowerCase();
  const raw = String(target || '');
  if (!/^[\w.\-/\\]+\.\w{1,6}$/.test(raw)) return;
  const write = ['edit', 'write', 'apply_patch', 'write_text'].indexOf(name) >= 0;
  if (!write && ['read', 'grep', 'glob', 'read_image', 'ls', 'list_dir'].indexOf(name) < 0) return;
  let file = null;
  for (let i = 0; i < sim.files.length; i += 1) {
    if (sim.files[i] && sim.files[i].path === raw) {
      file = sim.files[i];
      break;
    }
  }
  if (!file) {
    file = { path: raw, reads: 0, writes: 0, tool: name, lastT: 0 };
    sim.files.push(file);
  }
  if (write) file.writes += 1;
  else file.reads += 1;
  file.tool = name;
  file.lastT = Date.now();
  if (sim.files.length > AO_SIM_MAX_FILES) sim.files.splice(0, sim.files.length - AO_SIM_MAX_FILES);
}

function aoSimEvent(sim, kind, label, detail, status, at) {
  sim.seq += 1;
  const statusText = String(status || 'info');
  if (statusText === 'warn') sim.warnings += 1;
  sim.events.push({
    seq: sim.seq,
    t: aoNum(at, Date.now()),
    kind: aoUpper(kind || 'SYSTEM'),
    label: aoClip(aoUpper(label), 64),
    detail: aoClip(detail, 80),
    status: statusText,
  });
  if (sim.events.length > AO_SIM_MAX_EVENTS) sim.events.splice(0, sim.events.length - AO_SIM_MAX_EVENTS);
  return sim.seq;
}

function aoSimDispatchTool(sim, now) {
  const spec = aoSimPick(sim.rng, AO_SIM_TOOLS);
  if (!spec) return;
  const target = aoTextPick(sim.rng, spec.targets);
  const agent = sim.agents.length ? sim.agents[Math.floor(sim.rng() * sim.agents.length)] : null;
  sim.toolSeq += 1;
  sim.toolCalls += 1;
  sim.tokensIn += 220 + Math.floor(sim.rng() * 680);
  sim.tools.push({
    id: 't' + sim.toolSeq,
    name: spec.name,
    target: target,
    status: 'RUNNING',
    turn: Math.max(1, sim.turn),
    step: Math.max(1, sim.steps),
    t: now,
    startedAt: now,
    ticksLeft: 1 + Math.floor(sim.rng() * 3),
    agentId: agent ? agent.id : '',
  });
  if (sim.tools.length > AO_SIM_MAX_TOOLS) sim.tools.splice(0, sim.tools.length - AO_SIM_MAX_TOOLS);
  if (agent) {
    agent.tools += 1;
    agent.status = 'RUNNING';
    agent.lastEvent = aoUpper(spec.name) + ' DISPATCHED';
    agent.activity = aoClip('TOOL ' + aoUpper(spec.name) + ' · ' + target, 36);
  }
  aoSimTouchFile(sim, spec.name, target);
  aoSimEvent(sim, 'TOOL', aoUpper(spec.name) + ' DISPATCHED', target || 'no target', 'run', now);
}

function aoSimResolveTools(sim, now) {
  for (let i = 0; i < sim.tools.length; i += 1) {
    const tool = sim.tools[i];
    if (!tool || tool.status !== 'RUNNING') continue;
    tool.ticksLeft -= 1;
    if (tool.ticksLeft > 0) continue;
    const bad = sim.rng() < 0.07;
    tool.status = bad ? 'ERROR' : 'OK';
    tool.doneAt = now;
    if (bad) sim.errors += 1;
    sim.tokensOut += bad ? 20 + Math.floor(sim.rng() * 90) : 40 + Math.floor(sim.rng() * 260);
    let owner = null;
    for (let j = 0; j < sim.agents.length; j += 1) {
      if (sim.agents[j] && sim.agents[j].id === tool.agentId) {
        owner = sim.agents[j];
        break;
      }
    }
    if (owner) {
      owner.tokens += 180 + Math.floor(sim.rng() * 900);
      owner.lastEvent = aoUpper(tool.name) + ' RETURNED';
    }
    aoSimEvent(sim, 'TOOL', aoUpper(tool.name) + ' RETURNED', bad ? 'error path · retry queued' : 'nominal · result folded', bad ? 'error' : 'ok', now);
  }
}

function aoSimModelReply(sim, now) {
  const ii = 900 + Math.floor(sim.rng() * 3600);
  const oo = 60 + Math.floor(sim.rng() * 340);
  sim.tokensIn += ii;
  sim.tokensOut += oo;
  const label = 'MODEL REPLY · ' + aoFmtK(Math.round((ii + oo) / 100)) + '00 TOK';
  aoSimEvent(sim, 'MODEL', label, aoTextPick(sim.rng, AO_SIM_DETAILS), 'ok', now);
  const lead = sim.agents[0];
  if (lead) {
    lead.tokens += ii + oo;
    lead.activity = 'MODEL REPLY · ' + aoFmtK(ii + oo) + ' TOK';
    lead.lastEvent = 'MODEL REPLY';
  }
}

function aoSimStep(sim, now) {
  sim.steps += 1;
  aoSimEvent(sim, 'STEP', 'STEP ' + aoPad(sim.steps) + ' · REASONING', 'turn ' + aoPad(sim.turn), 'run', now);
  const lead = sim.agents[0];
  if (lead) lead.lastEvent = 'STEP ' + aoPad(sim.steps) + ' · REASONING';
}

function aoSimTurn(sim, now) {
  sim.turnOpen = !sim.turnOpen;
  if (sim.turnOpen) {
    sim.turn += 1;
    sim.steps = 0;
    aoSimEvent(sim, 'TURN', 'TURN ' + aoPad(sim.turn) + ' ENGAGED', 'inbox dispatch', 'run', now);
  } else {
    aoSimEvent(sim, 'TURN', 'TURN ' + aoPad(sim.turn) + ' CLOSED', 'stop · context stable', 'ok', now);
  }
}

function aoSimSubagent(sim, now) {
  if (sim.agents.length >= AO_SIM_MAX_AGENTS) {
    aoSimEvent(sim, 'SYSTEM', 'DISPATCH QUEUE SATURATED', 'desk limit reached', 'warn', now);
    return;
  }
  sim.agentSeq += 1;
  const name = AO_SIM_AGENT_NAMES[sim.agentSeq % AO_SIM_AGENT_NAMES.length] + '-' + aoPad(2 + sim.agentSeq, 2);
  const activity = aoTextPick(sim.rng, AO_SIM_ACTIVITIES);
  const tokens = 600 + Math.floor(sim.rng() * 3400);
  sim.agents.push({
    id: 'a' + (100 + sim.agentSeq),
    name: name,
    role: 'SUBAGENT',
    status: 'RUNNING',
    activity: activity,
    sessionId: 'SIM-9F2A/' + aoPad(sim.agentSeq, 2),
    tools: 0,
    tokens: tokens,
    lastEvent: 'SUBAGENT SPAWNED',
  });
  aoSimEvent(sim, 'SYSTEM', 'SUBAGENT SPAWNED', name + ' · ' + activity, 'run', now);
  const lead = sim.agents[0];
  if (lead) {
    lead.activity = 'DECK SYNC · ' + name + ' ONLINE';
    lead.lastEvent = 'SUBAGENT SPAWNED';
  }
}

function aoSimSystem(sim, now) {
  const roll = sim.rng();
  if (roll < 0.34) {
    sim.tokensIn += 120 + Math.floor(sim.rng() * 420);
    aoSimEvent(sim, 'SYSTEM', 'HEARTBEAT ACK', 'runtime nominal', 'info', now);
  } else if (roll < 0.62) {
    aoSimEvent(sim, 'SYSTEM', 'QUEUE REBALANCED', 'channels merged', 'info', now);
  } else if (roll < 0.82) {
    aoSimEvent(sim, 'OPERATOR', 'OPERATOR INPUT RECEIVED', 'keep the dashboard alive', 'info', now);
  } else if (sim.agents.length > 4) {
    let release = null;
    for (let i = sim.agents.length - 1; i >= 1; i -= 1) {
      const candidate = sim.agents[i];
      if (candidate && candidate.status !== 'RUNNING') {
        release = candidate;
        break;
      }
    }
    if (!release) {
      for (let i = sim.agents.length - 1; i >= 1; i -= 1) {
        if (sim.agents[i]) {
          release = sim.agents[i];
          break;
        }
      }
    }
    if (release) {
      sim.agents.splice(sim.agents.indexOf(release), 1);
      aoSimEvent(sim, 'SYSTEM', 'AGENT RELEASED', release.name + ' · desk reclaimed', 'warn', now);
    }
  } else {
    aoSimEvent(sim, 'SYSTEM', 'CHECKPOINT COMMITTED', 'context stable', 'info', now);
  }
}

function aoSimTick(sim, now) {
  if (!sim || typeof sim !== 'object') return;
  const stamp = aoNum(now, Date.now());
  const dt = Math.max(0, Math.min(5000, stamp - aoNum(sim.lastTick, stamp)));
  sim.lastTick = stamp;
  sim.elapsedMs += dt;
  sim.tick += 1;
  const rng = sim.rng;
  aoSimResolveTools(sim, stamp);
  const roll = rng();
  if (roll < 0.54) {
    aoSimDispatchTool(sim, stamp);
    if (rng() < 0.18) aoSimDispatchTool(sim, stamp);
  } else if (roll < 0.72) {
    aoSimModelReply(sim, stamp);
  } else if (roll < 0.82) {
    aoSimStep(sim, stamp);
  } else if (roll < 0.9) {
    aoSimTurn(sim, stamp);
  } else if (roll < 0.95) {
    aoSimSubagent(sim, stamp);
  } else {
    aoSimSystem(sim, stamp);
  }
  let running = 0;
  for (let i = 0; i < sim.tools.length; i += 1) {
    if (sim.tools[i] && sim.tools[i].status === 'RUNNING') running += 1;
  }
  let recent = 0;
  for (let i = sim.events.length - 1; i >= 0; i -= 1) {
    const e = sim.events[i];
    if (!e) continue;
    if (stamp - aoNum(e.t, 0) > 15000) break;
    recent += 1;
  }
  sim.intensity = aoClamp(0.2 + Math.min(0.45, running * 0.12) + Math.min(0.3, recent * 0.04) + rng() * 0.05, 0.14, 0.98);
}

// ── state normalization + derivation ───────────────────────────────────────

function aoEmptyStats() {
  return { agents: 0, tools: 0, turns: 0, steps: 0, tokens: 0, errors: 0, events: 0, files: 0 };
}

function aoEmptyData(now) {
  return {
    mode: 'SIMULATION',
    sessionId: 'SESSION-LOCAL',
    sessionShort: 'LOCAL',
    workspaceName: 'DEFAULT-WORKSPACE',
    uptimeMs: 0,
    intensity: 0.3,
    clock: aoClock(now),
    stats: aoEmptyStats(),
    agents: [],
    tools: [],
    files: [],
    events: [],
    runningTools: 0,
    runningAgents: 0,
    tokensIn: 0,
    tokensOut: 0,
    rate: 0,
    warnings: 0,
  };
}

function aoIsLiveSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (snapshot.ok === false) return false;
  if (String(snapshot.mode || '') !== 'live') return false;
  return aoArr(snapshot.sessions).length > 0 || aoArr(snapshot.agents).length > 0 || aoArr(snapshot.events).length > 0;
}

function aoDeriveDataSafe(snapshot, sim, now) {
  try {
    if (aoIsLiveSnapshot(snapshot)) return aoLiveData(snapshot, now);
    return aoSimData(sim, now);
  } catch (err) {
    return aoEmptyData(now);
  }
}

function aoSimData(sim, now) {
  if (!sim || typeof sim !== 'object') return aoEmptyData(now);
  const agents = aoArr(sim.agents);
  const tools = aoArr(sim.tools);
  const files = aoArr(sim.files);
  const events = aoArr(sim.events);
  let runningTools = 0;
  for (let i = 0; i < tools.length; i += 1) {
    if (tools[i] && tools[i].status === 'RUNNING') runningTools += 1;
  }
  let runningAgents = 0;
  for (let i = 0; i < agents.length; i += 1) {
    if (agents[i] && agents[i].status === 'RUNNING') runningAgents += 1;
  }
  let recent = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (!e) continue;
    if (aoNum(now) - aoNum(e.t, 0) > 60000) break;
    recent += 1;
  }
  return {
    mode: 'SIMULATION',
    sessionId: sim.sessionId || 'SESSION-SIM',
    sessionShort: 'SIM-9F2A',
    workspaceName: 'DEFAULT-WORKSPACE',
    uptimeMs: aoNum(sim.elapsedMs),
    intensity: aoClamp(sim.intensity, 0.05, 1),
    clock: aoClock(now),
    stats: {
      agents: agents.length,
      tools: aoNum(sim.toolCalls),
      turns: aoNum(sim.turn),
      steps: aoNum(sim.steps),
      tokens: aoNum(sim.tokensIn) + aoNum(sim.tokensOut),
      errors: aoNum(sim.errors),
      events: aoNum(sim.seq),
      files: files.length,
    },
    agents: agents,
    tools: tools,
    files: files,
    events: events,
    runningTools: runningTools,
    runningAgents: runningAgents,
    tokensIn: aoNum(sim.tokensIn),
    tokensOut: aoNum(sim.tokensOut),
    rate: recent,
    warnings: aoNum(sim.warnings),
  };
}

function aoLiveData(snapshot, now) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const rawAgents = aoArr(snap.agents).filter(function (a) { return a && typeof a === 'object'; }).slice(0, 8);
  const agents = rawAgents.map(function (a, i) {
    const displayName = aoDisplayTitle(a.name || a.id || 'AGENT') || 'AGENT';
    return {
      id: String(a.id || a.sessionId || 'agent' + i),
      name: aoClip(displayName, 18),
      role: aoUpper(a.role || 'AGENT'),
      status: aoUpper(a.status || 'IDLE'),
      activity: aoClip(aoUpper(a.activity || a.lastEvent || 'NO SIGNAL'), 36),
      sessionId: String(a.sessionId || ''),
      tools: aoNum(a.tools),
      tokens: aoNum(a.tokens),
      lastEvent: aoUpper(a.lastEvent || ''),
    };
  });
  const rawTools = aoArr(snap.tools).filter(function (t) { return t && typeof t === 'object'; }).slice(-40);
  const tools = rawTools.map(function (t, i) {
    return {
      id: String(t.id || 'tool' + i + ':' + i),
      name: aoUpper(t.name || 'TOOL'),
      target: String(t.target || ''),
      status: aoUpper(t.status || 'RUNNING'),
      turn: aoNum(t.turn),
      step: aoNum(t.step),
      t: aoNum(t.t),
    };
  });
  const rawFiles = aoArr(snap.files).filter(function (f) { return f && typeof f === 'object'; });
  const files = rawFiles.map(function (f, i) {
    return {
      path: String(f.path || '').trim() || 'file-' + i,
      reads: aoNum(f.reads),
      writes: aoNum(f.writes),
      tool: String(f.tool || ''),
      lastT: aoNum(f.lastT),
    };
  }).slice(0, AO_SIM_MAX_FILES);
  const rawEvents = aoArr(snap.events).filter(function (e) { return e && typeof e === 'object'; });
  const events = rawEvents.map(function (e, i) {
    return {
      seq: aoNum(e.seq, i + 1),
      t: aoNum(e.t),
      kind: aoUpper(e.kind || 'EVT'),
      label: aoUpper(e.label || ''),
      detail: String(e.detail || ''),
      status: String(e.status || 'info'),
    };
  }).slice(-AO_SIM_MAX_EVENTS);
  const st = snap.stats && typeof snap.stats === 'object' ? snap.stats : {};
  const sessions = aoArr(snap.sessions);
  let tokensIn = aoNum(st.tokensIn);
  let tokensOut = aoNum(st.tokensOut);
  if (!tokensIn && !tokensOut) {
    for (let i = 0; i < sessions.length; i += 1) {
      const s = sessions[i];
      if (!s) continue;
      tokensIn += aoNum(s.tokensIn);
      tokensOut += aoNum(s.tokensOut);
    }
  }
  const generated = aoNum(snap.generatedAt, now);
  const focus = String(snap.focus || (sessions[0] && sessions[0].id) || '');
  const focusKey = aoUpper(focus).replace(/[^A-Z0-9]/g, '');
  let latestT = 0;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i]) latestT = Math.max(latestT, aoNum(events[i].t));
  }
  const receiving = latestT > 0 && generated - latestT <= 45000;
  // V3 keeps the V2 normalization: focused session receiving events shows RUNNING
  // even when the host collapsed its status to STANDBY / IDLE between turns.
  if (receiving) {
    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i];
      if (!agent) continue;
      if (agent.status !== 'STANDBY' && agent.status !== 'IDLE') continue;
      const sid = String(agent.sessionId || '');
      const isFocused = focus ? sid === focus || (!sid && agents.length === 1) : true;
      if (isFocused) agent.status = 'RUNNING';
    }
  }
  let runningTools = 0;
  for (let i = 0; i < tools.length; i += 1) {
    if (tools[i] && tools[i].status === 'RUNNING') runningTools += 1;
  }
  let runningAgents = 0;
  for (let i = 0; i < agents.length; i += 1) {
    if (agents[i] && agents[i].status === 'RUNNING') runningAgents += 1;
  }
  let recent = 0;
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (!e) continue;
    if (e.t && generated - e.t <= 60000 && e.t <= generated + 5000) recent += 1;
  }
  const intensity = aoClamp(0.2 + Math.min(0.5, recent / 24) + Math.min(0.2, runningTools * 0.05) + Math.min(0.1, runningAgents * 0.03), 0.1, 1);
  let workspaceRaw = '';
  for (let i = 0; i < sessions.length; i += 1) {
    const s = sessions[i];
    if (s && String(s.id) === focus) {
      workspaceRaw = String(s.title || s.cwd || '');
      break;
    }
  }
  if (!workspaceRaw && sessions.length) {
    const first = sessions[0];
    workspaceRaw = first ? String(first.title || first.cwd || '') : '';
  }
  let warnings = 0;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i] && events[i].status === 'warn') warnings += 1;
  }
  return {
    mode: 'LIVE',
    sessionId: focusKey ? 'SESSION-' + focusKey.slice(-10) : 'SESSION-LOCAL',
    sessionShort: focusKey ? focusKey.slice(-8) : 'LOCAL',
    workspaceName: aoWorkspaceName(workspaceRaw),
    uptimeMs: aoNum(snap.uptimeMs) + (aoNum(snap.uptimeMs) > 0 ? Math.max(0, now - generated) : 0),
    intensity: intensity,
    clock: aoClock(now),
    stats: {
      agents: st.agents != null ? aoNum(st.agents) : agents.length,
      tools: st.toolCalls != null ? aoNum(st.toolCalls) : tools.length,
      turns: aoNum(st.turns),
      steps: aoNum(st.steps),
      tokens: tokensIn + tokensOut,
      errors: aoNum(st.errors),
      events: st.events != null ? aoNum(st.events) : events.length,
      files: st.files != null ? aoNum(st.files) : files.length,
    },
    agents: agents,
    tools: tools,
    files: files,
    events: events,
    runningTools: runningTools,
    runningAgents: runningAgents,
    tokensIn: tokensIn,
    tokensOut: tokensOut,
    rate: recent,
    warnings: warnings,
  };
}

// ── scene model (V1 fields + V3 memories / activeId) ───────────────────────

function aoBuildModel(data, seenSet, now) {
  const d = data && typeof data === 'object' ? data : {};
  const agents = aoArr(d.agents);
  const tools = aoArr(d.tools);
  const files = aoArr(d.files);
  const events = aoArr(d.events);
  const nodes = [];
  const links = [];
  const nodeIds = new Set();
  const uniqueId = function (base) {
    let id = base;
    let n = 1;
    while (nodeIds.has(id)) {
      id = base + '#' + n;
      n += 1;
    }
    nodeIds.add(id);
    return id;
  };

  let maxAgentTools = 1;
  for (let i = 0; i < agents.length; i += 1) maxAgentTools = Math.max(maxAgentTools, aoNum(agents[i] && agents[i].tools, 1));

  const agentIds = [];
  for (let i = 0; i < agents.length; i += 1) {
    const a = agents[i] || {};
    const id = uniqueId('a:' + String(a.id || i));
    agentIds.push(id);
    nodes.push({
      id: id,
      label: aoClip(a.name || 'AGENT', 12),
      sublabel: aoClip(aoUpper(a.role || '') + ' · ' + aoUpper(a.status || ''), 22),
      kind: 'agent',
      weight: aoClamp(aoNum(a.tools, 1) / maxAgentTools, 0.25, 1),
    });
  }

  const toolSlice = tools.slice(-10);
  const toolIds = [];
  for (let i = 0; i < toolSlice.length; i += 1) {
    const t = toolSlice[i] || {};
    const id = uniqueId('t:' + String(t.id || i));
    toolIds.push(id);
    nodes.push({
      id: id,
      label: aoClip(aoUpper(t.name || 'TOOL'), 12),
      sublabel: aoClip(t.target || '', 22),
      kind: 'tool',
      weight: t.status === 'RUNNING' ? 0.85 : 0.45,
    });
  }

  const fileSlice = files.slice(0, 8);
  const fileIds = [];
  for (let i = 0; i < fileSlice.length; i += 1) {
    const f = fileSlice[i] || {};
    const id = uniqueId('f:' + String(f.path || i));
    fileIds.push(id);
    nodes.push({
      id: id,
      label: aoClip(aoBaseName(f.path), 12),
      sublabel: 'r' + aoPad(f.reads, 2) + '·w' + aoPad(f.writes, 2),
      kind: 'file',
      weight: aoClamp((aoNum(f.reads) + aoNum(f.writes)) / 6, 0.2, 1),
    });
  }

  let msgId = '';
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e && aoUpper(e.kind) === 'MODEL') {
      msgId = uniqueId('m:last');
      nodes.push({ id: msgId, label: 'MODEL', sublabel: aoClip(aoUpper(e.label || 'REPLY'), 20), kind: 'msg', weight: 0.7 });
      break;
    }
  }

  if (agentIds.length > 0) {
    for (let i = 0; i < toolIds.length; i += 1) {
      aoPushLink(links, agentIds[i % agentIds.length], toolIds[i], toolSlice[i] && toolSlice[i].status === 'RUNNING' ? 0.9 : 0.5);
    }
    for (let i = 0; i < fileIds.length; i += 1) {
      aoPushLink(links, agentIds[aoHash(fileSlice[i] && fileSlice[i].path) % agentIds.length], fileIds[i], 0.5);
    }
    for (let i = 1; i < agentIds.length; i += 1) aoPushLink(links, agentIds[0], agentIds[i], 0.35);
    if (msgId) aoPushLink(links, agentIds[0], msgId, 0.6);
  } else {
    for (let i = 1; i < toolIds.length; i += 1) aoPushLink(links, toolIds[i - 1], toolIds[i], 0.4);
    for (let i = 0; i < toolIds.length && fileIds.length > 0; i += 1) aoPushLink(links, toolIds[i], fileIds[i % fileIds.length], 0.3);
  }

  if (nodes.length < 3) {
    const fill = ['CORE', 'MESH', 'DECK'];
    for (let i = nodes.length; i < 3; i += 1) {
      nodes.push({
        id: uniqueId('s:' + i),
        label: fill[i] || 'SYS',
        sublabel: 'SYSTEM',
        kind: i === 1 ? 'msg' : 'tool',
        weight: 0.4,
      });
    }
    for (let i = 1; i < nodes.length; i += 1) aoPushLink(links, nodes[i - 1].id, nodes[i].id, 0.35);
  }

  const cards = tools.slice(-14).reverse().map(function (t, i) {
    const tool = t || {};
    return {
      id: 'c:' + String(tool.id || i),
      title: aoClip(aoUpper(tool.name || 'TOOL'), 12),
      line1: aoClip(tool.target || 'no target', 26),
      line2: 'T' + aoPad(tool.turn, 2) + '·S' + aoPad(tool.step, 2),
      status: tool.status === 'RUNNING' ? 'run' : tool.status === 'ERROR' ? 'error' : 'ok',
      tone: (aoHash(String(tool.id || tool.name || i)) % 100) / 100,
    };
  });

  const seen = seenSet instanceof Set ? seenSet : new Set();
  const wasEmpty = seen.size === 0;
  const fresh = [];
  const sample = events.slice(-36);
  for (let i = 0; i < sample.length; i += 1) {
    const e = sample[i];
    if (!e) continue;
    const seq = String(e.seq == null ? '' : e.seq);
    if (!seq) continue;
    const pid = String(d.mode || 'X') + ':' + seq;
    if (seen.has(pid)) continue;
    seen.add(pid);
    fresh.push(pid);
  }
  if (seen.size > 500) {
    let drop = seen.size - 260;
    const keys = Array.from(seen);
    for (let i = 0; i < keys.length && drop > 0; i += 1) {
      seen.delete(keys[i]);
      drop -= 1;
    }
  }
  const limit = wasEmpty ? 5 : 12;
  const chosen = fresh.slice(-limit);
  const pulses = chosen.map(function (id, i) {
    return { id: id, at: now - (chosen.length - i) * 150 };
  });

  return {
    seen: seen,
    model: {
      mode: d.mode === 'LIVE' ? 'LIVE' : 'SIMULATION',
      nodes: nodes,
      links: links,
      cards: cards,
      pulses: pulses,
      intensity: aoClamp(aoNum(d.intensity, 0.5), 0, 1),
      clock: d.clock || aoClock(now),
      memories: [],
      activeId: null,
    },
  };
}

// ── V3 memories: up to ~48 interactive nodes for the scene cloud ───────────

function aoBuildMemories(data) {
  const memories = [];
  const seen = new Set();
  const push = function (memory) {
    if (!memory || !memory.id || seen.has(memory.id)) return;
    seen.add(memory.id);
    memories.push(memory);
  };
  const tools = aoArr(data && data.tools);
  const files = aoArr(data && data.files);
  const events = aoArr(data && data.events);
  const agents = aoArr(data && data.agents);
  const now = Date.now();
  // V4.3: memories carry an optional cardId so the scene can rotate the matching
  // ring card into view. Only ids that this frame's card list actually contains
  // are emitted (cards are the last 14 tools, ids `c:<toolId>`).
  const cardToolSlice = tools.slice(-14);
  const cardIds = new Set();
  for (let i = 0; i < cardToolSlice.length; i += 1) {
    const cardTool = cardToolSlice[i];
    if (cardTool && cardTool.id != null) cardIds.add('c:' + String(cardTool.id));
  }
  const cardIdForTool = function (tool) {
    if (!tool || tool.id == null) return '';
    const id = 'c:' + String(tool.id);
    return cardIds.has(id) ? id : '';
  };
  const newestCardForPath = function (path) {
    const full = String(path || '');
    const base = aoBaseName(full);
    const needles = [];
    if (full) needles.push(full);
    if (base && base !== full) needles.push(base);
    if (!needles.length) return '';
    for (let i = tools.length - 1; i >= 0; i -= 1) {
      const tool = tools[i];
      if (!tool) continue;
      const id = cardIdForTool(tool);
      if (!id) continue;
      const target = String(tool.target || '');
      for (let n = 0; n < needles.length; n += 1) {
        const needle = needles[n];
        if (needle && (target.indexOf(needle) >= 0 || needle.indexOf(target) >= 0)) return id;
      }
    }
    return '';
  };
  const toolSlice = tools.slice(-16);
  for (let i = toolSlice.length - 1; i >= 0; i -= 1) {
    const tool = toolSlice[i];
    if (!tool) continue;
    const rank = toolSlice.length - i;
    const recency = 1 - (rank - 1) / Math.max(1, toolSlice.length);
    const memory = {
      id: 'mem:tool:' + String(tool.id),
      kind: 'tool',
      label: aoClip(aoUpper(tool.name || 'TOOL'), 14),
      detail: aoClip(tool.target || 'no target', 34),
      weight: aoClamp(0.45 + recency * 0.55, 0.05, 1),
      t: aoNum(tool.t, now),
    };
    const cardId = cardIdForTool(tool);
    if (cardId) memory.cardId = cardId;
    push(memory);
  }
  for (let i = 0; i < files.length && i < 8; i += 1) {
    const file = files[i];
    if (!file) continue;
    const usage = aoNum(file.reads) + aoNum(file.writes) * 2;
    const memory = {
      id: 'mem:file:' + String(file.path),
      kind: 'file',
      label: aoBaseName(file.path) || 'file',
      detail: 'r' + aoPad(file.reads, 2) + ' · w' + aoPad(file.writes, 2) + ' · ' + aoShortPath(file.path, 24),
      weight: aoClamp(usage / 12, 0.15, 0.95),
      t: aoNum(file.lastT, now),
    };
    const cardId = newestCardForPath(file.path);
    if (cardId) memory.cardId = cardId;
    push(memory);
  }
  const answers = [];
  const thoughts = [];
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (!e) continue;
    const kind = aoUpper(e.kind);
    if (kind === 'MODEL') answers.push(e);
    else if (kind === 'STEP') thoughts.push(e);
  }
  for (let i = answers.length - 1; i >= 0 && answers.length - i <= 8; i -= 1) {
    const e = answers[i];
    push({
      id: 'mem:answer:' + String(e.seq),
      kind: 'answer',
      label: 'MODEL REPLY',
      detail: aoClip((e.label || '') + ' · ' + (e.detail || ''), 46),
      weight: aoClamp(0.62 + ((answers.length - i) / 8) * 0.3, 0.2, 0.98),
      t: aoNum(e.t, now),
    });
  }
  for (let i = thoughts.length - 1; i >= 0 && thoughts.length - i <= 8; i -= 1) {
    const e = thoughts[i];
    push({
      id: 'mem:thought:' + String(e.seq),
      kind: 'thought',
      label: aoClip(e.label || 'STEP', 22),
      detail: aoClip(e.detail || 'reasoning', 34),
      weight: aoClamp(0.4 + ((thoughts.length - i) / 8) * 0.35, 0.15, 0.9),
      t: aoNum(e.t, now),
    });
  }
  for (let i = 0; i < agents.length && i < 6; i += 1) {
    const agent = agents[i];
    if (!agent) continue;
    push({
      id: 'mem:agent:' + String(agent.id),
      kind: 'agent',
      label: aoClip(agent.name || 'AGENT', 16),
      detail: aoClip(aoUpper(agent.role || '') + ' · ' + aoUpper(agent.status || '') + ' · ' + (agent.activity || ''), 44),
      weight: aoClamp(0.35 + aoNum(agent.tools) / 30, 0.2, 0.95),
      t: now - i * 5000,
    });
  }
  return memories.slice(0, AO_MAX_MEMORIES);
}

function aoFindMemory(memories, id) {
  const list = aoArr(memories);
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && String(list[i].id) === String(id)) return list[i];
  }
  return null;
}

// map a TASK FEED event back to a memory id (two-way selection)
function aoEventMemId(event, memories) {
  if (!event) return '';
  const kind = aoUpper(event.kind);
  const seq = String(event.seq);
  if (kind === 'MODEL') {
    const answerId = 'mem:answer:' + seq;
    return aoFindMemory(memories, answerId) ? answerId : '';
  }
  if (kind === 'STEP') {
    const thoughtId = 'mem:thought:' + seq;
    return aoFindMemory(memories, thoughtId) ? thoughtId : '';
  }
  if (kind === 'TOOL') {
    const detail = String(event.detail || '');
    const list = aoArr(memories);
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const memory = list[i];
      if (memory && memory.kind === 'tool' && detail && String(memory.detail)) {
        const memoryTarget = String(memory.detail);
        if (memoryTarget.indexOf(detail) === 0 || detail.indexOf(memoryTarget) === 0) return memory.id;
      }
    }
    const first = aoUpper(event.label || '').split(' ')[0];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const memory = list[i];
      if (memory && memory.kind === 'tool' && first && aoUpper(memory.label).indexOf(first) === 0) return memory.id;
    }
  }
  return '';
}

function aoRelatedEvents(memory, events) {
  const out = [];
  if (!memory) return out;
  const list = aoArr(events);
  const id = String(memory.id || '');
  if (id.indexOf('mem:answer:') === 0 || id.indexOf('mem:thought:') === 0) {
    const seq = Number(id.split(':')[2]);
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i] && aoNum(list[i].seq) === seq) {
        out.push(list[i]);
        break;
      }
    }
    return out;
  }
  if (memory.kind === 'tool') {
    const target = String(memory.detail || '');
    const name = aoUpper(memory.label || '');
    for (let i = list.length - 1; i >= 0 && out.length < 3; i -= 1) {
      const e = list[i];
      if (!e) continue;
      const hay = aoUpper(e.label) + ' ' + e.detail;
      if ((target && hay.indexOf(aoUpper(target)) >= 0) || (name && hay.indexOf(name) >= 0)) out.push(e);
    }
    return out.reverse();
  }
  if (memory.kind === 'file') {
    const base = String(memory.label || '');
    for (let i = list.length - 1; i >= 0 && out.length < 3; i -= 1) {
      const e = list[i];
      if (!e) continue;
      if (base && aoUpper(e.detail).indexOf(aoUpper(base)) >= 0) out.push(e);
    }
    return out.reverse();
  }
  if (memory.kind === 'agent') {
    return list.slice(-3);
  }
  return out;
}

// ── presentation helpers ────────────────────────────────────────────────────

function aoHistorySeed() {
  const out = [];
  for (let i = 0; i < 36; i += 1) {
    const wave = Math.sin(i / 4.2) * 0.24;
    const jitter = ((i * 37) % 11) / 90;
    out.push(aoClamp(0.34 + wave + jitter, 0.06, 0.94));
  }
  return out;
}

function aoInitialOpen() {
  try {
    if (typeof window !== 'undefined' && window.__agentOpsAutoOpened) return false;
    if (typeof window !== 'undefined') window.__agentOpsAutoOpened = true;
  } catch (err) {
    /* ignore */
  }
  return true;
}

function aoUseReducedMotion() {
  const [reduced, setReduced] = React.useState(function () {
    try {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) {
      return false;
    }
  });
  React.useEffect(function () {
    let media = null;
    const onChange = function (event) {
      try {
        setReduced(Boolean(event && event.matches));
      } catch (err) {
        /* ignore */
      }
    };
    try {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
      media = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
      else if (typeof media.addListener === 'function') media.addListener(onChange);
    } catch (err) {
      media = null;
    }
    return function () {
      try {
        if (!media) return;
        if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onChange);
        else if (typeof media.removeListener === 'function') media.removeListener(onChange);
      } catch (err) {
        /* ignore */
      }
    };
  }, []);
  return reduced;
}

// ── presentational components (memoized where rows repeat) ─────────────────

function AOPanel(props) {
  const className = 'ao-panel' + (props && props.className ? ' ' + props.className : '');
  return h(
    'section',
    { className: className },
    h(
      'div',
      { className: 'ao-panel-head' },
      h('span', { className: 'ao-panel-title' }, props && props.title ? props.title : ''),
      props && props.meta != null ? h('span', { className: 'ao-panel-meta' }, props.meta) : null,
    ),
    h('div', { className: 'ao-panel-body' }, props ? props.children : null),
  );
}

function AOChip(props) {
  const tone = props && props.tone ? ' ' + props.tone : '';
  const cls = props && props.cls ? ' ' + props.cls : '';
  return h(
    'span',
    { className: 'ao-chip' + tone + cls },
    props && props.dot ? h('span', { className: 'ao-chip-dot' }) : null,
    props && props.label ? h('span', null, props.label) : null,
    props && props.value != null ? h('b', null, String(props.value)) : null,
  );
}

function AOStat(props) {
  const tone = props && props.tone ? ' ' + props.tone : '';
  return h(
    'div',
    { className: 'ao-stat' + tone },
    h('div', { className: 'ao-stat-lbl' }, props.label || ''),
    h('div', { className: 'ao-stat-val' + (props.small ? ' small' : '') }, String(props.value == null ? '--' : props.value)),
    h('div', { className: 'ao-stat-sub' }, props.sub || ''),
  );
}

function AOTele(props) {
  return h(
    'div',
    { className: 'ao-tele-cell' },
    h('span', { className: 'ao-tele-k' }, props.label || ''),
    h('span', { className: 'ao-tele-v' + (props.tone ? ' ' + props.tone : '') }, String(props.value == null ? '--' : props.value)),
  );
}

function AOSparkline(props) {
  const samples = aoArr(props.samples);
  const points = samples.map(function (s, i) {
    const x = samples.length > 1 ? (i / (samples.length - 1)) * 100 : 0;
    const y = 30 - aoClamp(s, 0, 1) * 26;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const area = points ? '0,32 ' + points + ' 100,32' : '0,32 100,32';
  return h(
    'svg',
    { className: 'ao-spark', viewBox: '0 0 100 32', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    h(
      'defs',
      null,
      h(
        'linearGradient',
        { id: 'aoSparkFill', x1: 0, y1: 0, x2: 0, y2: 1 },
        h('stop', { offset: '0', stopColor: '#5ff2ff', stopOpacity: '0.34' }),
        h('stop', { offset: '1', stopColor: '#b07cff', stopOpacity: '0' }),
      ),
    ),
    h('polygon', { points: area, fill: 'url(#aoSparkFill)', stroke: 'none' }),
    h('polyline', { points: points || '0,30 100,30', fill: 'none', stroke: '#5ff2ff', strokeWidth: '0.9', strokeOpacity: '0.95' }),
  );
}

function AOTraceMap() {
  const colors = ['#5ff2ff', '#3ef0b3', '#b07cff', '#ffc857'];
  const children = [
    h('path', { key: 'ao-cross-h', d: 'M0,20 H100', stroke: 'rgba(95,242,255,0.12)', strokeWidth: '0.35', fill: 'none' }),
    h('path', { key: 'ao-cross-v', d: 'M50,0 V40', stroke: 'rgba(95,242,255,0.12)', strokeWidth: '0.35', fill: 'none' }),
  ];
  for (let i = 0; i < AO_TRACE_PATHS.length; i += 1) {
    children.push(h('path', { key: 'ao-tp-' + i, d: AO_TRACE_PATHS[i], fill: 'none', stroke: colors[i % colors.length], strokeOpacity: '0.72', strokeWidth: '0.5' }));
  }
  for (let i = 0; i < AO_TRACE_DOTS.length; i += 1) {
    const p = AO_TRACE_DOTS[i];
    children.push(h('circle', { key: 'ao-td-' + i, cx: p.x, cy: p.y, r: p.r, fill: 'rgba(232,255,246,0.66)' }));
  }
  children.push(h('circle', { key: 'ao-reticle-1', cx: 50, cy: 20, r: 3.2, fill: 'none', stroke: 'rgba(95,242,255,0.7)', strokeWidth: '0.4' }));
  children.push(h('circle', { key: 'ao-reticle-2', cx: 50, cy: 20, r: 5.6, fill: 'none', stroke: 'rgba(176,124,255,0.3)', strokeWidth: '0.3' }));
  return h(
    'svg',
    { className: 'ao-trace', viewBox: '0 0 100 40', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    h('rect', { x: 0, y: 0, width: 100, height: 40, fill: 'rgba(4,18,15,0.4)' }),
    children,
  );
}

function AOInspector(props) {
  const memory = props && props.memory ? props.memory : null;
  const related = aoArr(props && props.related);
  const now = aoNum(props && props.now, Date.now());
  const kind = memory ? String(memory.kind || 'memory') : '';
  return h(
    'section',
    { className: 'ao-panel ao-inspector' },
    h(
      'div',
      { className: 'ao-panel-head' },
      h('span', { className: 'ao-panel-title' }, 'MEMORY INSPECTOR'),
      h('span', { className: 'ao-panel-meta' }, memory ? 'PINNED' : 'IDLE'),
    ),
    h(
      'div',
      { className: 'ao-panel-body ao-insp-body' },
      memory
        ? h(
          'div',
          { className: 'ao-insp-main' },
          h(
            'div',
            { className: 'ao-insp-top' },
            h('span', { className: 'ao-mk ao-mk-' + kind }, kind.toUpperCase()),
            h('span', { className: 'ao-insp-time' }, aoClock(memory.t) + ' · ' + aoAgo(memory.t, now)),
          ),
          h('div', { className: 'ao-insp-label' }, memory.label || ''),
          h('div', { className: 'ao-insp-detail' }, memory.detail || ''),
          h('div', { className: 'ao-insp-weight' }, 'WEIGHT ' + aoPad(Math.round(aoNum(memory.weight) * 100), 2)),
          memory.cardId
            ? h('div', { className: 'ao-insp-card' }, 'CARD LINK · ' + String(memory.cardId))
            : null,
          related.length
            ? h(
              'div',
              { className: 'ao-insp-rel' },
              h('div', { className: 'ao-insp-rel-head' }, 'RELATED EVENTS'),
              related.map(function (event, i) {
                return h(
                  'div',
                  { className: 'ao-insp-rel-row', key: 'ao-rel-' + i },
                  h('span', { className: 'ao-insp-rel-kind ao-k-' + aoKindToken(event.kind) }, aoClip(event.kind, 6)),
                  h('span', { className: 'ao-insp-rel-label' }, aoClip(event.label, 26)),
                  h('span', { className: 'ao-insp-rel-time' }, aoClockShort(event.t)),
                );
              }),
            )
            : null,
        )
        : h(
          'div',
          { className: 'ao-insp-main' },
          h('div', { className: 'ao-insp-empty' }, 'NO MEMORY PINNED'),
          h('div', { className: 'ao-insp-empty2' }, 'HOVER THE ARC CLOUD · CLICK A NODE'),
        ),
      h('div', { className: 'ao-insp-hint' }, 'CLICK NODE · DRAG TO ROTATE · WHEEL TO ZOOM'),
    ),
  );
}

const AORosterRow = React.memo(function AORosterRow(props) {
  const cls = 'ao-roster-row' + (props.hovered ? ' is-hovered' : '') + (props.selected ? ' is-selected' : '');
  return h(
    'div',
    {
      className: cls,
      onClick: props.memId && props.onPick ? function () { props.onPick(props.memId); } : undefined,
      role: props.memId ? 'button' : undefined,
      tabIndex: props.memId ? 0 : undefined,
      onKeyDown: props.memId && props.onPick ? function (event) {
        if (event && (event.key === 'Enter' || event.key === ' ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          props.onPick(props.memId);
        }
      } : undefined,
    },
    h('span', { className: 'ao-dot ' + (props.tone || 'idle') }),
    h('span', { className: 'ao-roster-name' }, props.name || ''),
    h('span', { className: 'ao-roster-role' + (props.role === 'SUBAGENT' ? ' sub' : '') }, props.role || ''),
    h('span', { className: 'ao-roster-meta' }, props.meta || ''),
    h('span', { className: 'ao-roster-act' }, props.activity || ''),
  );
});

const AOFeedRow = React.memo(function AOFeedRow(props) {
  const cls = 'ao-feed-row'
    + (props.tone ? ' ' + props.tone : '')
    + (props.newest ? ' newest' : '')
    + (props.memId ? ' is-clickable' : '')
    + (props.hovered ? ' is-hovered' : '')
    + (props.selected ? ' is-selected' : '');
  const pick = props.memId && props.onPick
    ? function () { props.onPick(props.memId); }
    : undefined;
  return h(
    'div',
    {
      className: cls,
      onClick: pick,
      role: pick ? 'button' : undefined,
      tabIndex: pick ? 0 : undefined,
      onKeyDown: pick ? function (event) {
        if (event && (event.key === 'Enter' || event.key === ' ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          props.onPick(props.memId);
        }
      } : undefined,
    },
    h('span', { className: 'ao-feed-seq' }, props.seq || '---'),
    h('span', { className: 'ao-feed-time' }, props.time || '--:--'),
    h('span', { className: 'ao-feed-kind ao-k-' + (props.kindClass || 'default') }, props.kind || ''),
    h('span', { className: 'ao-feed-label' }, props.label || ''),
    h('span', { className: 'ao-feed-detail' }, props.detail || ''),
  );
});

const AOBufferRow = React.memo(function AOBufferRow(props) {
  const cls = 'ao-buffer-row' + (props.hovered ? ' is-hovered' : '') + (props.selected ? ' is-selected' : '');
  const pick = props.memId && props.onPick ? function () { props.onPick(props.memId); } : undefined;
  return h(
    'div',
    {
      className: cls,
      onClick: pick,
      role: pick ? 'button' : undefined,
      tabIndex: pick ? 0 : undefined,
      onKeyDown: pick ? function (event) {
        if (event && (event.key === 'Enter' || event.key === ' ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          props.onPick(props.memId);
        }
      } : undefined,
    },
    h('span', { className: 'ao-buffer-idx' }, props.idx || ''),
    h('span', { className: 'ao-buffer-name' }, props.name || ''),
    h('span', { className: 'ao-buffer-target' }, props.target || ''),
    h('span', { className: 'ao-tag ' + (props.tone || 'wait') }, props.status || ''),
  );
});

const AORegRow = React.memo(function AORegRow(props) {
  const cls = 'ao-reg-row' + (props.hovered ? ' is-hovered' : '') + (props.selected ? ' is-selected' : '');
  const pick = props.memId && props.onPick ? function () { props.onPick(props.memId); } : undefined;
  return h(
    'div',
    {
      className: cls,
      onClick: pick,
      role: pick ? 'button' : undefined,
      tabIndex: pick ? 0 : undefined,
      onKeyDown: pick ? function (event) {
        if (event && (event.key === 'Enter' || event.key === ' ')) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          props.onPick(props.memId);
        }
      } : undefined,
    },
    h('span', { className: 'ao-dot ' + (props.tone || 'idle') }),
    h('span', { className: 'ao-reg-name' }, props.name || ''),
    h('span', { className: 'ao-reg-role' }, props.role || ''),
    h('span', { className: 'ao-reg-meta' }, props.meta || ''),
  );
});

const AOChanRow = React.memo(function AOChanRow(props) {
  return h(
    'div',
    { className: 'ao-chan-row' },
    h('span', { className: 'ao-chan-ch' }, props.ch || ''),
    h('span', { className: 'ao-chan-name' }, props.name || ''),
    h('span', { className: 'ao-chan-target' }, props.target || ''),
    h('span', { className: 'ao-tag ' + (props.tone || 'info') }, props.status || ''),
  );
});

// ── the overlay ────────────────────────────────────────────────────────────

function AgentOpsOverlay(props) {
  const [open, setOpen] = React.useState(aoInitialOpen);
  const [snapshot, setSnapshot] = React.useState(null);
  const [now, setNow] = React.useState(function () { return Date.now(); });
  const [hoverId, setHoverId] = React.useState('');
  const [selectedId, setSelectedId] = React.useState('');
  const reduced = aoUseReducedMotion();

  const simRef = React.useRef(null);
  if (!simRef.current) simRef.current = aoCreateSim();
  const canvasRef = React.useRef(null);
  const sceneRef = React.useRef(null);
  const modelRef = React.useRef(null);
  const seenRef = React.useRef(new Set());
  const historyRef = React.useRef(null);
  if (!historyRef.current) historyRef.current = aoHistorySeed();
  const lastGoodRef = React.useRef(null);
  const abortRef = React.useRef(null);
  const snapshotRef = React.useRef(null);
  const openRef = React.useRef(open);
  openRef.current = open;
  const dataRef = React.useRef(null);
  const memoriesRef = React.useRef([]);
  const hoverLabelRef = React.useRef(null);
  const hoverKindRef = React.useRef(null);
  const hoverTitleRef = React.useRef(null);
  const hoverDetailRef = React.useRef(null);
  const hoverIdRef = React.useRef('');
  const selectedIdRef = React.useRef('');
  const lastSelectedRef = React.useRef(null);
  selectedIdRef.current = selectedId;

  // Poll the host snapshot and advance the fallback simulation on idle/error.
  React.useEffect(function () {
    let alive = true;
    let timer = null;
    const loop = async function () {
      let json = null;
      try {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        abortRef.current = controller;
        const response = await fetch(AO_ROUTE, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          signal: controller ? controller.signal : undefined,
        });
        if (response && response.ok) json = await response.json();
      } catch (err) {
        json = null;
      } finally {
        abortRef.current = null;
      }
      if (!alive) return;
      let live = false;
      try {
        live = aoIsLiveSnapshot(json);
      } catch (err) {
        live = false;
      }
      if (live) {
        lastGoodRef.current = json;
        snapshotRef.current = json;
        setSnapshot(json);
      } else {
        snapshotRef.current = null;
        setSnapshot(null);
      }
      try {
        if (!live) aoSimTick(simRef.current, Date.now());
      } catch (err) {
        /* simulation is optional; never break the poll loop */
      }
      setNow(Date.now());
      try {
        if (typeof window !== 'undefined') {
          window.__agentOpsHud = {
            version: AO_HUD_VERSION,
            route: AO_ROUTE,
            mode: live ? 'LIVE' : 'SIMULATION',
            memories: memoriesRef.current.length,
            selectedId: selectedIdRef.current || null,
            lastPollAt: Date.now(),
            ok: Boolean(json),
          };
        }
      } catch (err) {
        /* debug handle is best-effort only */
      }
      if (alive) timer = setTimeout(loop, AO_POLL_MS);
    };
    loop();
    return function () {
      alive = false;
      if (timer) clearTimeout(timer);
      const controller = abortRef.current;
      abortRef.current = null;
      if (controller && typeof controller.abort === 'function') {
        try {
          controller.abort();
        } catch (err) {
          /* ignore */
        }
      }
    };
  }, []);

  // Derive data + memories once per render tick (poll frequency, ≤ 2 Hz).
  let data;
  try {
    data = aoDeriveDataSafe(snapshot, simRef.current, now);
  } catch (err) {
    data = aoEmptyData(now);
  }
  dataRef.current = data;
  let memories;
  try {
    memories = aoBuildMemories(data);
  } catch (err) {
    memories = [];
  }
  memoriesRef.current = memories;

  // Build + push the scene model (V1 fields + V3 memories/activeId) on every tick.
  React.useEffect(function () {
    if (!open) return;
    const source = dataRef.current || aoEmptyData(Date.now());
    let built = null;
    try {
      built = aoBuildModel(source, seenRef.current, Date.now());
    } catch (err) {
      built = null;
    }
    if (!built) return;
    seenRef.current = built.seen;
    built.model.memories = aoArr(memoriesRef.current);
    built.model.activeId = selectedIdRef.current || null;
    modelRef.current = built.model;
    const scene = sceneRef.current;
    if (scene && typeof scene.setModel === 'function') {
      try {
        scene.setModel(built.model);
      } catch (err) {
        /* canvas must never break React render */
      }
    }
  }, [open, now, snapshot, selectedId]);

  // Scene callbacks: hover label + selection (stable identities for createScene).
  const onSceneHover = React.useCallback(function (hit, x, y) {
    try {
      const labelEl = hoverLabelRef.current;
      if (!hit) {
        if (labelEl) labelEl.style.display = 'none';
        if (hoverIdRef.current) {
          hoverIdRef.current = '';
          setHoverId('');
        }
        return;
      }
      const kind = aoHitKind(hit);
      const hitId = String(hit.id || hit.type || 'hit');
      if (labelEl) {
        labelEl.style.display = 'flex';
        if (hoverKindRef.current) {
          hoverKindRef.current.textContent = aoUpper(kind) + ' · ' + aoUpper(hit.type || 'memory');
          hoverKindRef.current.style.color = aoKindHue(kind);
        }
        if (hoverTitleRef.current) hoverTitleRef.current.textContent = aoClip(hit.label || '', 46);
        if (hoverDetailRef.current) hoverDetailRef.current.textContent = aoClip(hit.detail || '', 56);
        const winW = (typeof window !== 'undefined' && window.innerWidth) || 1280;
        const winH = (typeof window !== 'undefined' && window.innerHeight) || 800;
        const px = aoClamp(aoNum(x, 0) + 14, 8, Math.max(8, winW - 338));
        const py = aoClamp(aoNum(y, 0) + 16, 8, Math.max(8, winH - 86));
        labelEl.style.transform = 'translate3d(' + Math.round(px) + 'px,' + Math.round(py) + 'px,0)';
      }
      if (hoverIdRef.current !== hitId) {
        hoverIdRef.current = hitId;
        setHoverId(hitId);
      }
    } catch (err) {
      /* never break pointer handling */
    }
  }, []);

  const onSceneSelect = React.useCallback(function (hit) {
    try {
      if (!hit || !hit.id) {
        lastSelectedRef.current = null;
        setSelectedId('');
        const scene = sceneRef.current;
        if (scene && typeof scene.setActive === 'function') {
          try { scene.setActive(null); } catch (err) { /* ignore */ }
        }
        return;
      }
      const id = String(hit.id);
      lastSelectedRef.current = {
        id: id,
        kind: aoHitKind(hit),
        label: hit.label || '',
        detail: hit.detail || '',
        weight: 0.6,
        t: Date.now(),
      };
      setSelectedId(id);
      const scene = sceneRef.current;
      if (scene && typeof scene.setActive === 'function') {
        try { scene.setActive(id); } catch (err) { /* ignore */ }
      }
    } catch (err) {
      /* ignore */
    }
  }, []);

  // HUD-side selection (TASK FEED / DISPATCH BUFFER rows etc.) → scene.setActive.
  const selectMemory = React.useCallback(function (id) {
    try {
      if (!id) {
        lastSelectedRef.current = null;
        setSelectedId('');
        const scene = sceneRef.current;
        if (scene && typeof scene.setActive === 'function') {
          try { scene.setActive(null); } catch (err) { /* ignore */ }
        }
        return;
      }
      const memory = aoFindMemory(memoriesRef.current, id);
      if (memory) lastSelectedRef.current = memory;
      setSelectedId(String(id));
      const scene = sceneRef.current;
      if (scene && typeof scene.setActive === 'function') {
        try { scene.setActive(String(id)); } catch (err) { /* ignore */ }
      }
    } catch (err) {
      /* ignore */
    }
  }, []);

  // Own the scene lifecycle (create on open, dispose on close/unmount).
  React.useEffect(function () {
    if (!open) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let scene = null;
    try {
      if (typeof createScene === 'function') {
        scene = createScene(canvas, {
          reducedMotion: Boolean(reduced),
          hoverLabels: false,
          onHover: onSceneHover,
          onSelect: onSceneSelect,
        });
        sceneRef.current = scene;
        if (scene && typeof scene.resize === 'function') {
          try { scene.resize(); } catch (err) { /* ignore */ }
        }
        if (scene && typeof scene.setModel === 'function' && modelRef.current) {
          try { scene.setModel(modelRef.current); } catch (err) { /* ignore */ }
        }
        if (scene && typeof scene.setActive === 'function') {
          try { scene.setActive(selectedIdRef.current || null); } catch (err) { /* ignore */ }
        }
        if (scene && typeof scene.setRunning === 'function') {
          try { scene.setRunning(true); } catch (err) { /* ignore */ }
        }
      }
    } catch (err) {
      scene = null;
      sceneRef.current = null;
    }
    const onResize = function () {
      const current = sceneRef.current;
      if (current && typeof current.resize === 'function') {
        try { current.resize(); } catch (err) { /* ignore */ }
      }
    };
    let observer = null;
    try {
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(onResize);
        observer.observe(canvas.parentElement || canvas);
      }
    } catch (err) {
      observer = null;
    }
    window.addEventListener('resize', onResize);
    return function () {
      window.removeEventListener('resize', onResize);
      if (observer) {
        try { observer.disconnect(); } catch (err) { /* ignore */ }
      }
      const current = sceneRef.current;
      sceneRef.current = null;
      if (current && typeof current.dispose === 'function') {
        try { current.dispose(); } catch (err) { /* ignore */ }
      }
    };
  }, [open, reduced, onSceneHover, onSceneSelect]);

  // Two-way selection: keep the canvas pin in sync with HUD-side selection.
  React.useEffect(function () {
    const scene = sceneRef.current;
    if (scene && typeof scene.setActive === 'function') {
      try { scene.setActive(selectedId || null); } catch (err) { /* ignore */ }
    }
  }, [selectedId, open]);

  // ESC closes; document visibility pauses the scene loop.
  React.useEffect(function () {
    const onKey = function (event) {
      try {
        if (event && event.key === 'Escape' && openRef.current) {
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
          setOpen(false);
        }
      } catch (err) {
        /* ignore */
      }
    };
    window.addEventListener('keydown', onKey, true);
    return function () {
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  React.useEffect(function () {
    const onVisibility = function () {
      const scene = sceneRef.current;
      if (scene && typeof scene.setRunning === 'function') {
        try { scene.setRunning(!document.hidden); } catch (err) { /* ignore */ }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return function () {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Keep the telemetry sparkline history (React only, no per-frame work).
  React.useEffect(function () {
    const list = historyRef.current;
    if (!list) return;
    const source = dataRef.current;
    list.push(aoClamp(source && source.intensity, 0.02, 1));
    if (list.length > 48) list.splice(0, list.length - 48);
  }, [now, snapshot]);

  const onClose = React.useCallback(function () {
    setOpen(false);
  }, []);
  const onOpen = React.useCallback(function () {
    setOpen(true);
  }, []);

  if (!open) {
    const live = data && data.mode === 'LIVE';
    return h(
      React.Fragment,
      null,
      h('style', { key: 'agent-ops-css' }, AO_CSS),
      h(
        'button',
        {
          key: 'ao-launcher',
          type: 'button',
          className: 'ao-orb-trigger' + (live ? ' is-live' : ' is-sim'),
          onClick: onOpen,
          'aria-label': 'Open Agent Ops dispatch center',
          title: 'Agent Ops · Dispatch Center',
        },
        h('span', { className: 'ao-orb-glow', 'aria-hidden': 'true' }),
        h(
          'span',
          { className: 'ao-orb-ring', 'aria-hidden': 'true' },
          h(
            'svg',
            { className: 'ao-orb-svg', viewBox: '0 0 56 56', 'aria-hidden': 'true' },
            h('circle', { className: 'ao-orb-arc a', cx: 28, cy: 28, r: 25 }),
            h('circle', { className: 'ao-orb-arc b', cx: 28, cy: 28, r: 19.5 }),
            h('circle', { className: 'ao-orb-arc c', cx: 28, cy: 28, r: 14 }),
            h('circle', { className: 'ao-orb-core', cx: 28, cy: 28, r: 2.4 }),
          ),
          h('span', { className: 'ao-orb-scan', 'aria-hidden': 'true' }),
        ),
        h(
          'span',
          { className: 'ao-orb-tag', 'aria-hidden': 'true' },
          h('span', { className: 'ao-orb-tag-main' }, 'AGENT OPS'),
          h('span', { className: 'ao-orb-tag-sub' }, 'DISPATCH CENTER'),
        ),
      ),
    );
  }

  const stats = data.stats || aoEmptyStats();
  const agents = aoArr(data.agents);
  const tools = aoArr(data.tools);
  const files = aoArr(data.files);
  const events = aoArr(data.events);
  const live = data.mode === 'LIVE';
  const intensity = aoClamp(data.intensity, 0, 1);
  const samples = aoArr(historyRef.current);
  const lastEvent = events.length ? events[events.length - 1] : null;
  const lastGood = lastGoodRef.current;

  // Selection resolution (keep the last inspector object if the memory scrolled out).
  let selectedMemory = null;
  if (selectedId) {
    selectedMemory = aoFindMemory(memories, selectedId);
    if (!selectedMemory) {
      const remembered = lastSelectedRef.current;
      if (remembered && String(remembered.id) === String(selectedId)) selectedMemory = remembered;
    }
  }
  const relatedEvents = selectedMemory ? aoRelatedEvents(selectedMemory, events) : [];

  // Header chips (V1).
  const headerChips = [
    h(AOChip, { key: 'ao-chip-core', dot: true, label: 'CORE', value: live ? 'NOMINAL' : 'SYNTH', tone: live ? 'lime' : 'amber' }),
    h(AOChip, { key: 'ao-chip-agents', label: 'AGENTS', value: aoPad(stats.agents, 2), tone: 'teal' }),
    h(AOChip, { key: 'ao-chip-tools', label: 'TOOLS', value: aoPad(stats.tools, 3), tone: 'cyan', cls: 'hide-mid' }),
    h(AOChip, { key: 'ao-chip-mem', label: 'MEM', value: aoPad(memories.length, 2), tone: 'violet', cls: 'hide-mid' }),
    h(AOChip, { key: 'ao-chip-faults', label: 'FAULTS', value: aoPad(stats.errors, 2), tone: stats.errors > 0 ? 'rose' : 'teal', cls: 'hide-sm' }),
  ];

  // Left rail: GLOBAL STATUS.
  const statCells = [
    h(AOStat, { key: 'st-agents', label: 'AGENTS', value: aoPad(stats.agents, 2), sub: aoPad(data.runningAgents, 2) + ' RUNNING', tone: 'teal' }),
    h(AOStat, { key: 'st-tools', label: 'TOOLS', value: aoPad(stats.tools, 3), sub: aoPad(data.runningTools, 2) + ' ACTIVE', tone: 'cyan' }),
    h(AOStat, { key: 'st-turns', label: 'TURNS', value: aoPad(stats.turns, 2), sub: 'LOOP CYCLE', tone: 'blue' }),
    h(AOStat, { key: 'st-steps', label: 'STEPS', value: aoPad(stats.steps, 2), sub: 'REASONING', tone: 'lime' }),
    h(AOStat, { key: 'st-tokens', label: 'TOKENS', value: aoFmtK(stats.tokens), sub: aoFmtK(data.tokensIn) + ' IN / ' + aoFmtK(data.tokensOut) + ' OUT', small: String(stats.tokens).length > 5, tone: 'violet' }),
    h(AOStat, { key: 'st-errors', label: 'ERRORS', value: aoPad(stats.errors, 2), sub: stats.errors > 0 ? 'FAULT TRACK' : 'NOMINAL', tone: stats.errors > 0 ? 'rose' : '' }),
  ];
  const statusPanel = h(
    AOPanel,
    { key: 'ao-status', title: 'GLOBAL STATUS', meta: live ? 'LIVE PARAMS' : 'SYNTH PARAMS' },
    h('div', { className: 'ao-stats' }, statCells),
    h(
      'div',
      { className: 'ao-load' },
      h('span', { className: 'ao-load-lbl' }, 'FIELD LOAD'),
      h('div', { className: 'ao-load-track' }, h('div', { className: 'ao-load-fill', style: { width: (intensity * 100).toFixed(1) + '%' } })),
      h('span', { className: 'ao-load-val' }, aoPad(Math.round(intensity * 100), 2) + '%'),
    ),
  );

  // Left rail: AGENT ROSTER (rows select the agent memory).
  const rosterRows = agents.slice(0, 6).map(function (agent) {
    const memId = 'mem:agent:' + String(agent.id);
    return h(AORosterRow, {
      key: 'ao-roster-' + agent.id,
      memId: memId,
      onPick: selectMemory,
      hovered: hoverId === memId,
      selected: selectedId === memId,
      tone: aoDotTone(agent.status),
      name: agent.name,
      role: agent.role,
      meta: 'T' + aoPad(agent.tools, 2) + '·' + aoFmtK(agent.tokens),
      activity: agent.activity,
    });
  });
  const rosterPanel = h(
    AOPanel,
    { key: 'ao-roster', title: 'AGENT ROSTER', meta: 'NS ' + aoPad(agents.length, 2), className: 'ao-grow' },
    rosterRows.length
      ? h('div', { className: 'ao-roster' }, rosterRows)
      : h('div', { className: 'ao-empty' }, 'NO AGENTS REGISTERED'),
  );

  // Right rail: DISPATCH BUFFER (rows select the tool memory).
  const bufferRows = tools.slice(-6).reverse().map(function (tool) {
    const memId = 'mem:tool:' + String(tool.id);
    return h(AOBufferRow, {
      key: 'ao-buffer-' + tool.id,
      memId: memId,
      onPick: selectMemory,
      hovered: hoverId === memId,
      selected: selectedId === memId,
      idx: '#' + aoPad(aoHash(tool.id) % 100, 2),
      name: aoClip(tool.name, 11),
      target: aoShortPath(tool.target, 24),
      status: aoToolLabel(tool.status),
      tone: aoToolTone(tool.status),
    });
  });
  const bufferPanel = h(
    AOPanel,
    {
      key: 'ao-buffer',
      title: 'DISPATCH BUFFER',
      meta: 'Q ' + aoPad(data.runningTools, 2) + ' · ' + aoPad(tools.length, 2) + ' BUF',
      className: 'ao-grow',
    },
    bufferRows.length
      ? h('div', { className: 'ao-buffer' }, bufferRows)
      : h('div', { className: 'ao-empty' }, 'BUFFER CLEAR'),
  );

  // Right rail: AGENT REGISTRATION (rows select the agent memory).
  const regRows = agents.slice(0, 6).map(function (agent) {
    const memId = 'mem:agent:' + String(agent.id);
    return h(AORegRow, {
      key: 'ao-reg-' + agent.id,
      memId: memId,
      onPick: selectMemory,
      hovered: hoverId === memId,
      selected: selectedId === memId,
      tone: aoDotTone(agent.status),
      name: aoClip(agent.name, 12),
      role: agent.role,
      meta: aoClip(String(agent.sessionId || '').split('/').slice(-1)[0], 8),
    });
  });
  const regPanel = h(
    AOPanel,
    { key: 'ao-reg', title: 'AGENT REGISTRATION', meta: 'NS AGENTS' },
    regRows.length ? h('div', { className: 'ao-reg' }, regRows) : h('div', { className: 'ao-empty' }, 'REGISTRY EMPTY'),
    h(
      'div',
      { className: 'ao-reg-foot' },
      h('span', null, 'REGISTERED ' + aoPad(agents.length, 2) + '/' + aoPad(AO_SIM_MAX_AGENTS, 2)),
      h('span', null, live ? 'MESH SYNC OK' : 'LOCAL MESH'),
    ),
  );

  // Right rail: MEMORY INSPECTOR.
  const inspectorPanel = h(AOInspector, {
    key: 'ao-inspector',
    memory: selectedMemory,
    related: relatedEvents,
    now: now,
  });

  // Bottom: TASK FEED (rows select the matching memory).
  const feedSlice = events.slice(-16);
  const feedRows = feedSlice.map(function (event, i) {
    const memId = aoEventMemId(event, memories);
    return h(AOFeedRow, {
      key: 'ao-feed-' + event.seq + '-' + event.t,
      memId: memId,
      onPick: selectMemory,
      hovered: Boolean(memId) && hoverId === memId,
      selected: Boolean(memId) && selectedId === memId,
      seq: aoPad(event.seq, 3),
      time: aoClockShort(event.t),
      kind: aoClip(event.kind, 8),
      kindClass: aoKindToken(event.kind),
      label: aoClip(event.label, 22),
      detail: aoClip(event.detail, 26),
      tone: aoEventTone(event.status),
      newest: i === feedSlice.length - 1,
    });
  });
  const feedPanel = h(
    AOPanel,
    {
      key: 'ao-feed',
      title: 'TASK FEED',
      meta: 'SEQ ' + aoPad(lastEvent ? lastEvent.seq : 0, 4) + ' · ' + aoPad(stats.events, 4),
    },
    h(
      'div',
      { className: 'ao-feed' },
      feedRows.length ? feedRows : h('div', { className: 'ao-empty' }, 'AWAITING TELEMETRY'),
      h(
        'div',
        { className: 'ao-feed-cursor' },
        h('span', { className: 'ao-blink' }, '█'),
        h('span', null, 'STREAMING ' + (live ? 'LIVE' : 'SIM') + ' · EVT ' + aoPad(stats.events, 4)),
      ),
    ),
  );

  // Bottom: WORKER / AGENT PROFILE.
  const fileRows = files.slice(0, 3).map(function (file) {
    const weight = aoClamp(((aoNum(file.reads) + aoNum(file.writes) * 2) / 10) * 100, 8, 100);
    return h(
      'div',
      { className: 'ao-file-row', key: 'ao-file-' + file.path },
      h('span', { className: 'ao-file-square', style: { background: aoFileHue(file.path) } }),
      h('span', { className: 'ao-file-path' }, aoBaseName(file.path)),
      h('span', { className: 'ao-file-count' }, 'r' + aoPad(file.reads, 2) + '·w' + aoPad(file.writes, 2)),
      h('span', { className: 'ao-file-bar' }, h('i', { style: { width: weight.toFixed(0) + '%' } })),
    );
  });
  const profilePanel = h(
    AOPanel,
    { key: 'ao-profile', title: 'WORKER / AGENT PROFILE', meta: 'TRACE MAP' },
    h(
      'div',
      { className: 'ao-profile' },
      h('div', { className: 'ao-trace-wrap' }, h(AOTraceMap), h('span', { className: 'ao-trace-tag' }, 'SECTOR 7G · PROFILE')),
      fileRows.length ? fileRows : h('div', { className: 'ao-empty' }, 'NO FILE TRACE'),
      h(
        'div',
        { className: 'ao-tabs' },
        h('span', { className: 'ao-tab on' }, 'PROJECT'),
        h('span', { className: 'ao-tab' }, 'RUNS'),
        h('span', { className: 'ao-tabs-meta' }, 'FILES ' + aoPad(files.length, 2)),
      ),
    ),
  );

  // Bottom: TOOL CHANNEL / MESSAGE QUEUE.
  const chanTools = tools.slice(-4).reverse();
  const chanRows = chanTools.map(function (tool, i) {
    return h(AOChanRow, {
      key: 'ao-chan-' + tool.id,
      ch: 'CH-' + aoPad(i + 1, 2),
      name: aoClip(tool.name, 11),
      target: aoShortPath(tool.target, 22),
      status: aoToolLabel(tool.status),
      tone: aoToolTone(tool.status),
    });
  });
  let message = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event && (event.kind === 'MODEL' || event.kind === 'OPERATOR')) {
      message = event;
      break;
    }
  }
  const msgRows = message
    ? [h(AOChanRow, {
      key: 'ao-msg-last',
      ch: 'MSG',
      name: message.kind === 'MODEL' ? 'MODEL' : 'OPR',
      target: aoClip(message.label, 22),
      status: 'ACK',
      tone: 'info',
    })]
    : [];
  const channelPanel = h(
    AOPanel,
    { key: 'ao-channel', title: 'TOOL CHANNEL / QUEUE', meta: 'Q ' + aoPad(data.runningTools, 2) },
    h(
      'div',
      { className: 'ao-chan' },
      chanRows.length || msgRows.length
        ? chanRows.concat(msgRows)
        : h('div', { className: 'ao-empty' }, 'CHANNEL IDLE'),
      h(
        'div',
        { className: 'ao-chan-prompt' },
        h('span', { className: 'ao-prompt-glyph' }, '>'),
        h('span', null, ' dispatch --next '),
        h('span', { className: 'ao-blink' }, '▌'),
      ),
    ),
  );

  // Bottom: TELEMETRY.
  const barSamples = samples.slice(-14);
  const bars = barSamples.map(function (sample, i) {
    return h('span', {
      key: 'ao-bar-' + i,
      className: 'ao-bar',
      style: { height: Math.max(8, Math.round(aoClamp(sample, 0, 1) * 100)) + '%' },
    });
  });
  const syncLabel = live ? 'LIVE' : lastGood && lastGood.generatedAt ? 'MEM ' + aoClock(lastGood.generatedAt) : '--';
  const telemetryPanel = h(
    AOPanel,
    { key: 'ao-telemetry', title: 'TELEMETRY', meta: 'SCAN 8 HZ' },
    h(
      'div',
      { className: 'ao-telemetry' },
      h('div', { className: 'ao-spark-wrap' }, h(AOSparkline, { samples: samples }), h('span', { className: 'ao-spark-tag' }, 'ACT · 60S · ' + syncLabel)),
      h(
        'div',
        { className: 'ao-tele-grid' },
        h(AOTele, { key: 'tel-in', label: 'IN', value: aoFmtK(data.tokensIn), tone: 'violet' }),
        h(AOTele, { key: 'tel-out', label: 'OUT', value: aoFmtK(data.tokensOut), tone: 'teal' }),
        h(AOTele, { key: 'tel-rate', label: 'RATE', value: aoPad(data.rate, 2) + '/M', tone: 'cyan' }),
        h(AOTele, { key: 'tel-act', label: 'ACT', value: aoPad(Math.round(intensity * 100), 2) + '%', tone: 'cyan' }),
        h(AOTele, { key: 'tel-fault', label: 'FAULT', value: aoPad(stats.errors, 2), tone: stats.errors > 0 ? 'rose' : '' }),
        h(AOTele, { key: 'tel-events', label: 'EVENTS', value: aoPad(stats.events, 4), tone: 'teal' }),
      ),
      h('div', { className: 'ao-bars' }, bars.length ? bars : h('span', { className: 'ao-bar', style: { height: '10%' } })),
    ),
  );

  return h(
    'div',
    {
      className: 'ao-root',
      'data-mode': live ? 'LIVE' : 'SIMULATION',
      role: 'dialog',
      'aria-label': 'Agent Ops dispatch center',
    },
    h('style', { key: 'agent-ops-css' }, AO_CSS),
    h('canvas', { key: 'ao-scene', ref: canvasRef, className: 'ao-canvas', 'aria-hidden': 'true' }),
    h('div', { key: 'ao-vignette', className: 'ao-vignette', 'aria-hidden': 'true' }),
    h('div', { key: 'ao-scanlines', className: 'ao-scanlines', 'aria-hidden': 'true' }),
    h(
      'header',
      { key: 'ao-header', className: 'ao-header' },
      h(
        'div',
        { className: 'ao-brand' },
        h(
          'div',
          { className: 'ao-brand-line' },
          h('span', { className: 'ao-brand-title' }, 'AGENT OPS'),
          h('span', { className: 'ao-brand-slash' }, '/'),
          h('span', { className: 'ao-brand-title' }, 'DISPATCH CENTER'),
        ),
        h('div', { className: 'ao-brand-sub' }, 'REAL-TIME AGENT ORCHESTRATION DASHBOARD // ' + data.sessionId),
      ),
      h('div', { className: 'ao-head-pills' }, headerChips),
      h(
        'div',
        { className: 'ao-head-right' },
        h(
          'div',
          { className: 'ao-uptime' },
          h('div', { className: 'ao-kicker' }, 'UPTIME'),
          h('div', { className: 'ao-uptime-val' }, aoDur(data.uptimeMs)),
        ),
        h(
          'div',
          { className: 'ao-clock' },
          h('div', { className: 'ao-kicker' }, 'LOCAL'),
          h('div', { className: 'ao-clock-val' }, data.clock),
        ),
        h(
          'div',
          { className: 'ao-mode ' + (live ? 'live' : 'sim') },
          h('span', { className: 'ao-mode-dot' }),
          h('span', null, live ? 'LIVE FEED' : 'SIMULATION'),
        ),
        h(
          'button',
          { type: 'button', className: 'ao-close', onClick: onClose, 'aria-label': 'Close Agent Ops', title: 'Close (ESC)' },
          h('span', { className: 'ao-close-k' }, 'ESC'),
          h('span', { className: 'ao-close-x' }, '×'),
        ),
      ),
    ),
    h(
      'main',
      { key: 'ao-main', className: 'ao-main' },
      h('aside', { className: 'ao-left' }, statusPanel, rosterPanel),
      h(
        'div',
        { className: 'ao-center' },
        h('div', { className: 'ao-ctag tl' }, h('b', null, '◉'), h('span', null, 'ORCHESTRATION FIELD · 03')),
        h('div', { className: 'ao-ctag br' }, h('b', null, '▚'), h('span', null, 'SECTOR 7G // LINK NOMINAL')),
        h('div', { className: 'ao-edge' }, 'DISPATCH GRID · 03/12'),
      ),
      h('aside', { className: 'ao-right' }, bufferPanel, regPanel, inspectorPanel),
    ),
    h('section', { key: 'ao-bottom', className: 'ao-bottom' }, feedPanel, profilePanel, channelPanel, telemetryPanel),
    h(
      'div',
      {
        key: 'ao-hover',
        className: 'ao-hover',
        ref: hoverLabelRef,
        'aria-hidden': 'true',
        style: { display: 'none' },
      },
      h('span', { className: 'ao-hover-kind', ref: hoverKindRef }, 'MEMORY'),
      h('span', { className: 'ao-hover-label', ref: hoverTitleRef }, ''),
      h('span', { className: 'ao-hover-detail', ref: hoverDetailRef }, ''),
    ),
  );
}


