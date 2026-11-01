// ==== entry ====
// Mounts the Agent Ops HUD into the frame-wide overlay slot. `inject` and `apply`
// are consumed by the module loader factory wrapper that build.mjs writes.
const inject = ['slots'];

function apply(ctx) {
  const mount = (ready) => {
    const slots = ready.slots || ctx.slots;
    if (!slots) return;
    const render = () => {
      slots.inject('shell.overlay', () =>
        slots.register(
          {
            name: 'shell.overlay',
            id: 'dsh-agent-ops',
            order: 950,
            label: 'Agent Ops v4.4',
          },
          (props) => h(AgentOpsOverlay, Object.assign({}, props, { ready: ready })),
        ),
      );
    };
    if (typeof ready.effect === 'function') ready.effect(render, 'dsh-agent-ops: mounts');
    else render();
  };

  if (typeof ctx.inject === 'function') {
    ctx.inject(['slots'], mount);
    return;
  }
  if (ctx.slots) mount(ctx);
}






