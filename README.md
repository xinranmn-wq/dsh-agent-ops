<div align="center">

<img src="docs/banner.svg" alt="Agent Ops / Dispatch Center" width="820" />

# Agent Ops / Dispatch Center

**DeepSeek Harness（DSH）的 AI Agent 运行可视化插件。**

它直接挂在 DSH Web UI 里：把当前会话中 Agent 的工具调用、Token 消耗、子代理和事件日志，展开成一块可交互的实时可视化面板 —— 会转动的卡片环、可点选的记忆云、完整的运行状态 HUD。

`DSH 插件` · `AI Agent 运行可视化` · `Agent 可观测性` · `Canvas 2D + React` · `零运行时依赖` · `全本地运行`

</div>

---

## 这是什么

Agent Ops 是一个 **DeepSeek Harness（DSH）插件**。安装后 DSH 页面右下角会出现一个发光圆环，点开是一整屏的 **Agent 运行可视化面板**：

- **可交互记忆云**：当前会话里的每一次工具调用、每一次文件读写、每一条模型回复和思考，都会变成记忆云里的一颗节点。悬停显示标签，点击钉住并在右侧 `MEMORY INSPECTOR` 里查看详情，按住拖动可以旋转，滚轮可以缩放。
- **旋转卡片环**：42 张状态卡围绕圆心缓慢旋转。每张卡片同时是一个「粒子喷嘴」：粒子从卡片的一端中点进入，穿过卡片，从另一端中点扇出并射向远方。
- **记忆与卡片联动**：选中记忆云里的节点时，与它关联的那张卡片会自动旋转到明显可见的位置并亮起，整个环随之平滑减速；取消选中后恢复旋转。
- **完整运行 HUD**：`GLOBAL STATUS`、`AGENT ROSTER`、`DISPATCH BUFFER`、`AGENT REGISTRATION`、`MEMORY INSPECTOR`，以及底部的 `TASK FEED`、`WORKER PROFILE`、`TOOL CHANNEL / QUEUE`、`TELEMETRY` 四条信息流。
- **真实数据 / 演示数据**：顶栏的 `LIVE FEED` 徽标表示正在展示当前 DSH 会话的真实事件流；会话空闲或数据不可达时，面板自动切换到 `SIMULATION` 演示模式，画面不会静止。

## 用它能看到什么

- 当前 Agent 在第几轮、第几步，正在调用哪个工具、目标是什么、成功还是失败；
- 每个会话/子代理（Lead / Worker / Subagent）的运行状态与活动；
- Token 的输入/输出消耗与最近一次回复的用量；
- 最近的文件读写、工具调用队列和完整事件日志；
- 一次运行从开始到结束的轨迹，以及每个工具调用与文件、记忆之间的关联。

## 环境要求

- 一个带插件系统的 DeepSeek Harness（DSH Desktop 或 DSH Web），需要提供：
  - `shell.overlay` 插槽（用于全屏 HUD 覆盖层）；
  - 客户端插件模块加载（`dsh.client`）；
  - Host 端 `webServer`、`sessions` 服务与 `session/event` 事件。
- 仓库已包含构建好的 `client.js`，**安装不需要 Node.js 或任何构建步骤**；
- 只有修改源码（`src/*.js`）时需要 Node.js 22+ 重新 `node build.mjs`。

## 安装

### 方式 A（推荐）：让 DSH 里的 Agent 安装本地 bundle

1. 把仓库克隆或下载解压到本机任意目录，例如：
   ```powershell
   git clone https://github.com/xinranmn-wq/dsh-agent-ops.git
   ```
2. 在 DSH 的对话里直接说（路径换成你本机的绝对路径）：
   > 帮我把 `C:\path\to\dsh-agent-ops` 这个目录作为本地插件 bundle 安装到当前 profile。
   DSH 里的 Agent 会调用插件管理能力（`plugin_manager` → `install_bundle`），把插件写进当前 profile。
3. 安装完成后**强制刷新**页面（`Ctrl+Shift+R`）。右下角会出现发光圆环，点它打开面板；每次页面加载也会自动打开一次。

### 方式 B：如果本机 DSH 提供命令行

```powershell
dsh plugin --profile <你的 profile 名> add link:C:\path\to\dsh-agent-ops
```

### 方式 C：图形界面

打开 DSH 的 **设置 → 插件**，按当前版本的入口添加本地插件目录 / 启用 `Agent Ops 调度中心`，然后强刷页面。

> 安装后可在 **设置 → 插件** 里确认条目「Agent Ops 调度中心 / Agent Ops Dispatch Center」已启用；
> 插件的显示名、描述与图标来自 `locale/{zh,en}.json` 和 `icon.svg`。

## 使用

| 操作 | 效果 |
| --- | --- |
| 点击右下角发光圆环 | 打开 / 关闭面板 |
| `ESC` 或右上角 `×` | 关闭面板 |
| 悬停记忆云节点 | 显示节点标签，右侧 `MEMORY INSPECTOR` 同步 |
| 点击记忆云节点 | 钉住该记忆；关联卡片自动转到可见位置并亮起；整环平滑减速 |
| 拖动记忆云 | 旋转记忆云（松开后带惯性） |
| 滚轮（指针在场景上） | 缩放记忆云 |
| 点击卡片 | 聚焦该卡片，整环减速便于阅读 |
| 点击空白处 | 取消选中，恢复旋转 |
| 点击 TASK FEED / DISPATCH BUFFER 行 | 选中对应记忆（与场景双向联动） |

`LIVE FEED` = 当前 DSH 会话的真实事件流；`SIMULATION` = 会话空闲或接口不可达时自动播放的演示数据。

## 数据与隐私

- Host 半只做一件事：监听本机 DSH 的 `session/event` 追加事件，折叠成一份紧凑快照，通过**同源、只读**的 `GET /dsh-agent-ops/state` 暴露给页面；
- 浏览器半每 1100 ms 轮询一次这个本地路由；**不向任何外部服务器发送数据**，没有遥测、没有第三方请求，也没有外部字体/图片资源（全部是 Canvas / SVG / 系统字体绘制）；
- 快照只包含运行所需的元数据：会话/代理状态、工具名与目标、事件日志、Token 计数等，不读取、不上传你的文件内容。

## 工作原理

```
DSH Host                                         DSH Web 页面
┌──────────────────────────┐                    ┌──────────────────────────────┐
│ session/event 事件流       │  GET /dsh-agent-   │ HUD（React）                   │
│   ↓ 折叠成 snapshot       │  ops/state  ←1100ms│  ├─ 轮询快照 / 空闲转演示        │
│ webServer 只读路由         │ ──────────────────▶ │  ├─ 构建场景模型                 │
└──────────────────────────┘                    │  └─ shell.overlay 全屏挂载      │
                                                │ Scene（Canvas 2D）              │
                                                │  ├─ 卡片环 / 旋转 / 粒子射线      │
                                                │  ├─ 记忆云（伪 3D，可交互）       │
                                                │  └─ 网络图 / 后期效果 / 相机漂移  │
                                                └──────────────────────────────┘
```

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：监听会话事件、维护快照、注册 `/dsh-agent-ops/state` |
| `client.js` | 浏览器半的**构建产物**（由 `build.mjs` 从 `src/*` 拼装，请勿手改） |
| `src/scene.js` | Canvas 场景：卡片环、记忆云、粒子射线、网络图、后期效果 |
| `src/hud.js` | React HUD：面板、轮询、演示模式、交互联动、启动圆环 |
| `src/entry.js` | 注册到 `shell.overlay` 插槽 |
| `cordis.patch.yml` | 插件包 patch：向 profile 插入 `dsh-agent-ops` 插件行 |
| `locale/*.json` / `icon.svg` | 插件管理器的显示元数据与图标 |
| `test-host.mjs` / `test-client.mjs` | 无需 DSH 的本地验证：Host 半假上下文试跑、浏览器半加载/渲染/交互冒烟测试 |

## 开发

```powershell
node build.mjs        # src/scene.js + src/hud.js + src/entry.js -> client.js
node --check client.js
node test-host.mjs    # Host 半冒烟测试（假 Cordis 上下文 + 假 HTTP）
node test-client.mjs  # 加载 bundle、渲染 HUD 树、跑场景帧与指针交互
```

修改浏览器半后：

1. `node build.mjs` 重新生成 `client.js`；
2. 在 DSH 页面 **Ctrl+Shift+R** 强制刷新（客户端模块会被浏览器缓存，普通刷新可能仍是旧版本）；
3. 修改 Host 半（`index.js`）后，需**重启 DSH** 才会重新加载该模块。

> CI：`docs/ci-example.yml` 是一份 GitHub Actions 配置示例。把它复制到 `.github/workflows/verify.yml` 即可在每次 push/PR 时自动做语法检查、构建一致性校验和两套冒烟测试。

## 自定义

想调手感，主要旋钮都在 `src/scene.js` 顶部/附近：

| 常量 | 含义 | 当前值 |
| --- | --- | --- |
| `CARD_N` | 卡片环上的卡片数量 | `42` |
| `CARD_F` | 卡片环的径向半径系数 | `0.79` |
| `ringSpeed` / idle 基础转速 | 环的角速度（rad/s） | `≈0.27` |
| `FAN_SPREAD` | 卡片出口粒子扇开的半角 | `≈19.5°` |
| `LINK_TARGET_ANGLE` | 选中记忆后卡片停靠的可见位置 | `RING_NEAR + 0.12` |
| `memC.r` | 记忆云半径系数 | `0.152 · min(W,H)` |

配色集中在 `src/scene.js` 的 `PALETTE` 表与 `src/hud.js` 的 CSS 变量里，可以按喜好替换成任意主题。

## 已知限制

- 依赖 DSH 的内部插件 API（插槽、客户端模块、Host 服务），DSH 大版本升级后可能需要适配；
- `client.js` 是构建产物：改完源码请重新 `build` 并提交产物；
- `SIMULATION` 模式下展示的是内置演示数据，不是真实运行记录；
- 性能目标 1920×1080 / 60fps；设备较弱时可以降低 `CARD_N` 或减少粒子池大小。

## 卸载

- **设置 → 插件** 里禁用或移除「Agent Ops 调度中心」；
- 或让 DSH Agent 执行 `plugin_manager` 的 `remove_bundle`（包名 `@local/dsh-agent-ops`）；
- 卸载后强刷页面即可。

## 关键词

DeepSeek Harness 插件、DSH 插件、AI Agent 运行可视化、Agent 可观测性、Agent 监控面板、工具调用可视化、Token 用量监控、子代理/多代理可视化、事件流看板、Canvas 可视化、React 仪表盘、本地优先、无需联网。

## License

[MIT](LICENSE)

---

## English

**Agent Ops / Dispatch Center** is a **DeepSeek Harness (DSH)** plugin for **live AI agent run visualization** and **agent observability**. It mounts as a full-screen, interactive panel inside the DSH Web UI:

- an interactive **memory cloud** built from the current session's tool calls, file touches, model replies and reasoning (hover / click / drag / wheel);
- a revolving **corona of 42 status cards**, each acting as a particle-ray nozzle;
- selecting a memory rotates its linked card into view, lights it up and eases the ring down;
- a complete run HUD (agents, status, dispatch buffer, registration, event feed, tool channel, telemetry);
- real data streamed from the local session event feed through a read-only `GET /dsh-agent-ops/state` route, with a built-in simulation fallback when the session is idle.

**Install**: clone/download the repo, ask the DSH agent to install this directory as a local bundle (`plugin_manager` → `install_bundle`), then reload with `Ctrl+Shift+R` and click the glowing ring at the bottom-right. No Node.js or build step is needed to install.

Everything runs locally; the plugin reads only session-run metadata and never uploads data anywhere.

Keywords: DeepSeek Harness plugin, DSH plugin, AI agent observability, agent run visualization, agent monitoring dashboard, tool-call visualization, token usage, subagent visualization, Canvas, React.

MIT licensed.

