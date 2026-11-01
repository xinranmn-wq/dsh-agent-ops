// Host half of Agent Ops: folds the live Session append feed into one compact
// telemetry snapshot served at GET /dsh-agent-ops/state.
//
// The browser half polls this route. Nothing here renders; nothing here is
// authoritative — a missing session simply yields an empty snapshot and the
// browser half switches to its own simulation.

export const name = 'dsh-agent-ops';
export const inject = ['webServer', 'sessions'];

const ROUTE = '/dsh-agent-ops/state';
const MAX_EVENTS = 160;
const MAX_TOOLS = 40;
const MAX_FILES = 18;
const MAX_SESSIONS = 8;
const IDLE_MS = 150000;

function pad(n, w = 2) {
  const s = String(Math.max(0, Math.floor(Number(n) || 0)));
  return s.length >= w ? s : '0'.repeat(w - s.length) + s;
}

function clip(text, max) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function targetOf(name, args) {
  const pick = (keys) => {
    for (const k of keys) {
      const v = args[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return '';
  };
  const n = String(name || '').toLowerCase();
  if (n === 'bash' || n === 'pwsh' || n === 'terminal_open' || n === 'terminal_send') {
    return clip(pick(['command', 'cmd', 'line']), 46);
  }
  if (n === 'grep' || n === 'glob' || n === 'grep_search') return clip(pick(['pattern', 'query']), 40);
  if (n === 'web_search' || n === 'web_fetch') return clip(pick(['query', 'url']), 46);
  if (n === 'skill') return clip(pick(['name']), 32);
  if (n === 'present' || n === 'spawn_teammate' || n === 'send_message') return clip(pick(['name', 'target']), 32);
  if (n === 'subagent' || n === 'subagent_fork' || n === 'workflow') return clip(pick(['prompt', 'script']), 42);
  return clip(
    pick(['path', 'file_path', 'filePath', 'target', 'name', 'input', 'text', 'prompt']),
    46,
  );
}

function fileOf(name, args) {
  const n = String(name || '').toLowerCase();
  const p = args.path || args.file_path || args.filePath || '';
  if (typeof p !== 'string' || !p.trim()) return null;
  const write = ['edit', 'write', 'edit_text', 'apply_patch', 'write_text', 'writeText'].includes(n);
  const read = ['read', 'grep', 'glob', 'read_image', 'list_dir', 'ls', 'search'].includes(n);
  if (!write && !read) return null;
  return { path: p, write };
}

function snippet(text, max) {
  const s = String(text || '').replace(/[`*#>\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clip(s, max);
}

function contentText(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : [];
  const out = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && typeof b.text === 'string') out.push(b.text);
    if (b.type === 'tool-call' && typeof b.name === 'string') out.push(`[${b.name}]`);
    if (b.type === 'tool-result') out.push('[result]');
  }
  return snippet(out.join(' '), 120);
}

function fallbackTitle(cwd, id) {
  const raw = String(cwd || '').replace(/[\\/]+$/, '');
  const base = raw ? raw.split(/[\\/]/).filter(Boolean).pop() : '';
  if (base) return base;
  return 'SESSION ' + String(id || '').slice(-8).toUpperCase();
}

export function apply(ctx) {
  /** @type {Map<string, any>} */
  const models = new Map();
  let lastActivity = 0;
  let focus = null;
  let totalToolCalls = 0;
  let totalErrors = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  function ensure(sessionId, cwd, parent) {
    let m = models.get(sessionId);
    if (!m) {
      m = {
        id: sessionId,
        title: fallbackTitle(cwd, sessionId),
        cwd: cwd || '',
        parent: parent || null,
        model: '',
        provider: '',
        running: false,
        updatedAt: 0,
        startedAt: 0,
        turns: 0,
        steps: 0,
        toolCalls: 0,
        tokensIn: 0,
        tokensOut: 0,
        events: [],
        tools: [],
        files: new Map(),
        seq: -1,
      };
      models.set(sessionId, m);
    }
    return m;
  }

  function pushEvent(m, kind, label, detail, status, t) {
    m.events.push({ seq: m.seq, t: t || Date.now(), kind, label: clip(label, 64), detail: clip(detail, 80), status: status || 'info', sessionId: m.id });
    if (m.events.length > MAX_EVENTS) m.events.splice(0, m.events.length - MAX_EVENTS);
  }

  function addTool(m, tool) {
    m.tools.push(tool);
    if (m.tools.length > MAX_TOOLS) m.tools.splice(0, m.tools.length - MAX_TOOLS);
  }

  function addFile(m, path, write, tool) {
    let f = m.files.get(path);
    if (!f) {
      f = { path, reads: 0, writes: 0, lastT: 0, tool };
      m.files.set(path, f);
    }
    if (write) f.writes += 1;
    else f.reads += 1;
    f.lastT = Date.now();
    f.tool = tool;
    if (m.files.size > MAX_FILES) {
      let oldest = null;
      for (const [k, v] of m.files) if (!oldest || v.lastT < m.files.get(oldest).lastT) oldest = k;
      if (oldest) m.files.delete(oldest);
    }
  }

  function record(session, event) {
    if (!session || !event || typeof event.type !== 'string') return;
    const sid = String(session.id || '');
    if (!sid) return;
    const header = session.header || {};
    const m = ensure(sid, header.cwd, header.parentSession ? String(header.parentSession) : null);
    if (event.origin === 'subagent' || header.origin === 'subagent') m.parent = m.parent || 'subagent';
    const idx = Number(event.seq);
    if (Number.isFinite(idx) && idx <= m.seq && idx > -1) return; // duplicate
    m.seq = Number.isFinite(idx) ? Math.max(m.seq, idx) : m.seq + 1;
    if (!m.startedAt) m.startedAt = Number(event.time) || Date.now();
    m.updatedAt = Date.now();
    lastActivity = m.updatedAt;
    focus = sid;

    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const t = Number(event.time) || Date.now();

    switch (event.type) {
      case 'session/title': {
        const title = clip(data.title, 80);
        if (title) m.title = title;
        return;
      }
      case 'turn/start': {
        m.running = true;
        m.turns = Math.max(m.turns, Number(data.turn) || m.turns);
        pushEvent(m, 'TURN', `TURN ${pad(data.turn)} ENGAGED`, 'inbox dispatch', 'run', t);
        return;
      }
      case 'turn/end': {
        m.running = false;
        if (Number(data.turn)) m.turns = Math.max(m.turns, Number(data.turn));
        const reason = data.reason && data.reason.kind ? data.reason.kind : 'stop';
        pushEvent(m, 'TURN', `TURN ${pad(data.turn)} CLOSED`, `reason: ${reason}`, reason === 'error' ? 'error' : 'ok', t);
        return;
      }
      case 'step/start': {
        m.steps += 1;
        m.running = true;
        if (Number(data.turn)) m.turns = Math.max(m.turns, Number(data.turn));
        pushEvent(m, 'STEP', `STEP ${pad(data.step)} · REASONING`, `turn ${pad(data.turn)}`, 'run', t);
        return;
      }
      case 'tool/call': {
        const name = String(data.name || 'tool');
        const args = parseArgs(data.arguments);
        const target = targetOf(name, args);
        m.toolCalls += 1;
        m.running = true;
        if (Number(data.turn)) m.turns = Math.max(m.turns, Number(data.turn));
        totalToolCalls += 1;
        addTool(m, {
          id: String(data.callId || `${sid}:${m.seq}`),
          name,
          target,
          turn: Number(data.turn) || 0,
          step: Number(data.step) || 0,
          status: 'RUNNING',
          t,
          sessionId: sid,
        });
        const f = fileOf(name, args);
        if (f) addFile(m, f.path, f.write, name);
        pushEvent(m, 'TOOL', `${String(name).toUpperCase()} DISPATCHED`, target || 'no target', 'run', t);
        return;
      }
      case 'tool/result': {
        const result = data.message || {};
        const callId = String(result.toolCallId || '');
        const isError = Boolean(data.error) || Boolean(result.isError);
        let tool = null;
        for (let i = m.tools.length - 1; i >= 0; i -= 1) {
          if (m.tools[i].status === 'RUNNING') {
            tool = m.tools[i];
            break;
          }
        }
        if (tool) {
          tool.status = isError ? 'ERROR' : 'OK';
          if (!tool.id && callId) tool.id = callId;
        }
        if (isError) totalErrors += 1;
        pushEvent(m, 'TOOL', `${tool ? String(tool.name).toUpperCase() : 'TOOL'} RETURNED`, isError ? 'error path' : 'nominal', isError ? 'error' : 'ok', t);
        return;
      }
      case 'assistant/message': {
        const usage = data.usage || {};
        const i = Number(usage.inputTokens) || 0;
        const o = Number(usage.outputTokens) || 0;
        m.tokensIn += i;
        m.tokensOut += o;
        tokensIn += i;
        tokensOut += o;
        const text = contentText(data.message);
        pushEvent(m, 'MODEL', `MODEL REPLY · ${pad(Math.round((i + o) / 100))}00 TOK`, text || 'assistant message', 'ok', t);
        return;
      }
      case 'assistant/attempt': {
        pushEvent(m, 'MODEL', 'MODEL ATTEMPT STREAM', 'retry / first pass', 'run', t);
        return;
      }
      case 'user/message': {
        pushEvent(m, 'OPERATOR', 'OPERATOR INPUT RECEIVED', contentText(data) || 'prompt', 'info', t);
        return;
      }
      case 'request/header': {
        const cfg = data.header && data.header.config ? data.header.config : {};
        if (cfg.model) m.model = String(cfg.model);
        if (cfg.provider) m.provider = String(cfg.provider);
        return;
      }
      case 'compaction/summary': {
        pushEvent(m, 'SYSTEM', 'CONTEXT COMPACTION', 'summary committed', 'warn', t);
        return;
      }
      case 'session/end-seed': {
        pushEvent(m, 'SYSTEM', 'SEED BOUNDARY', 'inherited history', 'info', t);
        return;
      }
      default:
        return;
    }
  }

  function seed(session) {
    try {
      const all = session.snapshotEvents ? session.snapshotEvents() : [];
      const slice = all.length > 400 ? all.slice(all.length - 400) : all;
      const header = session.header || {};
      const m = ensure(String(session.id || ''), header.cwd, header.parentSession ? String(header.parentSession) : null);
      m.startedAt = Number(header.createdAt) || m.startedAt;
      try {
        const hdr = typeof session.requestHeader === 'function' ? session.requestHeader() : undefined;
        const cfg = hdr && hdr.config ? hdr.config : null;
        if (cfg && cfg.model) m.model = String(cfg.model);
        if (cfg && cfg.provider) m.provider = String(cfg.provider);
      } catch {}
      for (const ev of slice) {
        try {
          record(session, ev);
        } catch {}
      }
    } catch {}
  }

  try {
    for (const s of ctx.sessions.list()) seed(s);
  } catch {}

  const offEvent = ctx.on('session/event', (session, event) => {
    try {
      record(session, event);
    } catch {}
  });
  const offDisposed = ctx.on('session/disposed', (session) => {
    try {
      const sid = session && session.id ? String(session.id) : '';
      const m = models.get(sid);
      if (m) {
        m.running = false;
        m.updatedAt = Date.now();
        pushEvent(m, 'SYSTEM', 'SESSION DETACHED', 'agent released', 'warn', Date.now());
      }
    } catch {}
  });

  ctx.effect(
    () => () => {
      try {
        offEvent();
        offDisposed();
      } catch {}
    },
    'dsh-agent-ops: session feed',
  );

  function snapshot() {
    const now = Date.now();
    const live = [...models.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS)
      .reverse();

    const focusModel = (focus && models.get(focus)) || live[live.length - 1] || null;
    const idle = !focusModel || now - lastActivity > IDLE_MS;

    const sessions = live.map((m) => ({
      id: m.id,
      title: m.title || m.cwd || m.id,
      cwd: m.cwd,
      model: m.model,
      provider: m.provider,
      running: m.running,
      updatedAt: m.updatedAt,
      startedAt: m.startedAt,
      parent: m.parent,
      turns: m.turns,
      steps: m.steps,
      toolCalls: m.toolCalls,
      tokensIn: m.tokensIn,
      tokensOut: m.tokensOut,
      events: m.events.length,
    }));

    const agents = sessions.map((s, i) => {
      const last = (focusModel && focusModel.events.slice(-1)[0]) || null;
      const age = now - (s.updatedAt || 0);
      const status = s.running || age < 45000 ? 'RUNNING' : age < 300000 ? 'STANDBY' : 'IDLE';
      return {
        id: s.id,
        name: s.title ? clip(s.title, 26) : `AGENT ${pad(i + 1)}`,
        role: s.parent ? 'SUBAGENT' : 'LEAD',
        status,
        activity: s.parent ? `CHILD · ${clip(s.id, 12)}` : 'PRIMARY LOOP',
        sessionId: s.id,
        tools: s.toolCalls,
        tokens: s.tokensIn + s.tokensOut,
        lastEvent: last ? last.label : '',
      };
    });

    const tools = (focusModel ? focusModel.tools.slice(-MAX_TOOLS) : []).map((x) => ({
      id: x.id,
      name: x.name,
      target: x.target,
      status: x.status,
      turn: x.turn,
      step: x.step,
      t: x.t,
    }));

    const files = (focusModel ? [...focusModel.files.values()].sort((a, b) => b.lastT - a.lastT).slice(0, MAX_FILES) : []).map((f) => ({
      path: f.path,
      reads: f.reads,
      writes: f.writes,
      tool: f.tool,
      lastT: f.lastT,
    }));

    const events = (focusModel ? focusModel.events.slice(-MAX_EVENTS) : []).map((e) => ({
      seq: e.seq,
      t: e.t,
      kind: e.kind,
      label: e.label,
      detail: e.detail,
      status: e.status,
    }));

    return {
      ok: true,
      source: 'dsh-agent-ops',
      mode: idle ? 'idle' : 'live',
      generatedAt: now,
      uptimeMs: focusModel && focusModel.startedAt ? now - focusModel.startedAt : 0,
      focus: focusModel ? focusModel.id : null,
      sessions,
      agents,
      stats: {
        turns: sessions.reduce((n, s) => n + s.turns, 0),
        steps: sessions.reduce((n, s) => n + s.steps, 0),
        toolCalls: totalToolCalls,
        errors: totalErrors,
        tokensIn,
        tokensOut,
        agents: sessions.length,
        files: models.size ? [...models.values()].reduce((n, m) => n + m.files.size, 0) : 0,
        events: sessions.reduce((n, s) => n + s.events, 0),
      },
      tools,
      files,
      events,
    };
  }

  function handler(req, res) {
    try {
      if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }));
        return;
      }
      const body = JSON.stringify(snapshot());
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'content-length': Buffer.byteLength(body),
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      try {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
      } catch {}
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }),
    'dsh-agent-ops: state route',
  );
}
