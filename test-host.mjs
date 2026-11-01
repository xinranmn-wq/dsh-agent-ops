// Host-half dry run: builds a fake Cordis context and feeds synthetic SessionEvents
// through apply(), then calls the registered HTTP handler directly. Not shipped.
import assert from 'node:assert';
import { apply } from './index.js';

function makeSession(id, header) {
  return { id, header: header || {}, snapshotEvents: () => [] };
}

const live = [makeSession('session-3', { cwd: 'C:\\w', createdAt: Date.now() - 60000 })];
const listeners = new Map();
const routes = new Map();
const effects = [];

const ctx = {
  sessions: { list: () => live },
  webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path); } },
  on: (name, fn) => { listeners.set(name, (listeners.get(name) || []).concat(fn)); return () => {}; },
  effect: (fn) => { const d = fn(); effects.push(d); return d; },
};

apply(ctx);

const fire = (name, ...args) => (listeners.get(name) || []).forEach((fn) => fn(...args));
const session = live[0];
const base = { time: Date.now() };
const ev = (type, data, seq) => ({ type, seq, time: Date.now(), data });

fire('session/event', session, ev('session/title', { title: 'Visualize agent ops' }, 1));
fire('session/event', session, ev('turn/start', { turn: 1 }, 2));
fire('session/event', session, ev('step/start', { turn: 1, step: 1 }, 3));
fire(
  'session/event',
  session,
  ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"src/hud.js"}' }, 4),
);
fire(
  'session/event',
  session,
  ev('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1' } }, 5),
);
fire(
  'session/event',
  session,
  ev('tool/call', { turn: 1, step: 2, callId: 'c2', name: 'bash', arguments: '{"command":"pnpm build"}' }, 6),
);
fire(
  'session/event',
  session,
  ev('tool/result', { turn: 1, step: 2, message: { toolCallId: 'c2' }, error: { name: 'ToolError' } }, 7),
);
fire(
  'session/event',
  session,
  ev(
    'assistant/message',
    {
      turn: 1,
      step: 2,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Built the HUD and wired the feed.' }] },
      usage: { inputTokens: 12000, outputTokens: 3400 },
    },
    8,
  ),
);
fire('session/event', session, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 9));

assert.ok(routes.has('/dsh-agent-ops/state'), 'state route registered');

const req = { method: 'GET' };
let status = 0;
let body = '';
const res = {
  writeHead(code) { status = code; return res; },
  end(chunk) { body += chunk == null ? '' : String(chunk); },
};
await routes.get('/dsh-agent-ops/state').handler(req, res);

assert.equal(status, 200, 'HTTP 200');
const state = JSON.parse(body);
assert.equal(state.ok, true);
assert.equal(state.mode, 'live');
assert.equal(state.focus, 'session-3');
assert.equal(state.sessions[0].title, 'Visualize agent ops');
assert.equal(state.stats.toolCalls, 2, 'two tool calls counted');
assert.equal(state.stats.errors, 1, 'one tool error counted');
assert.equal(state.stats.tokensIn, 12000);
assert.equal(state.stats.tokensOut, 3400);
assert.deepEqual(
  state.tools.map((t) => [t.name, t.status]),
  [['read', 'OK'], ['bash', 'ERROR']],
);
assert.ok(state.events.length >= 8, 'event feed populated');
assert.ok(state.files.some((f) => f.path === 'src/hud.js' && f.reads === 1), 'file read tracked');
assert.equal(state.sessions[0].running, false);

// HEAD + method rejection behavior
const headReq = { method: 'HEAD' };
status = 0; body = '';
await routes.get('/dsh-agent-ops/state').handler(headReq, res);
assert.equal(status, 200);

// Malformed event must never throw through the listener.
fire('session/event', session, { type: 'weird/type', seq: 10, data: null });
fire('session/event', null, null);
fire('session/disposed', session);
const after = JSON.parse((() => { body = ''; return routes.get('/dsh-agent-ops/state').handler({ method: 'GET' }, res), body; })());
assert.equal(after.ok, true);

console.log('host dry run OK');
console.log(JSON.stringify({ stats: after.stats, tools: after.tools.length, events: after.events.length, mode: after.mode }, null, 2));
