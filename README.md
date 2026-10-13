# DevSpace + Tips MCP (self-hosted)

这是一个**完整、独立、可部署**的 DevSpace MCP + Tips + Codex App Server 多 Agent 控制台。
它基于 DevSpace **v1.0.8** 的 MIT 授权发布包，包含原本的 MCP 服务端、工具、静态资源、CLI 和第三方许可文件，同时集成我们新增的 Tips、留言板和 `subagent` MCP 工具。

> 注意：这里版本控制的是 DevSpace 官方发布包的编译产物（`vendor/devspace/dist/`），不是官方的 TypeScript 开发源码。上游更新需手动合并，并重新验证自定义工具。仓库不含 `node_modules`、认证密钥、Agent 会话、训练模型或研究实验数据。

## 项目结构

```text
devspace-tips-mcp/
├── vendor/devspace/          # 完整 DevSpace 1.0.8 发布包（dist、页面、CLI、文档、许可）
│   └── dist/
│       ├── server.js         # 已注册 tips、tips_messages、subagent
│       ├── tips.js           # MCP 工具和 REST API
│       ├── tips-core.js      # 私有状态、消息队列、可信来源与心跳
│       ├── tips-dashboard.html
│       └── subagent-tool.js
├── tips/                     # Main Sol、Sub Luna、App Server、测试和通讯协议
├── scripts/                  # 初始化、启动、检查、systemd 和状态迁移
├── docs/Caddyfile.example
├── var/                      # 本机密钥、配置和状态，仅运行时生成，Git 忽略
├── package.json
└── .gitignore
```

## 新机器安装

要求 Linux、Node.js **>=22.19 且 <27**、npm、Git。运行 Codex Agent 时另需预先安装并登录 Codex CLI，模型账号必须能够访问所选 `gpt-6-luna` / `gpt-6.1-sol`。可以独立使用 MCP/Tips；但未安装 Codex 时 Agent 不能执行。

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd devspace-tips-mcp

npm install
npm run setup -- \
  --allowed-root /absolute/path/to/research-workspace \
  --public-url https://mcp.example.com \
  --host 127.0.0.1 \
  --port 7676

npm run doctor
npm start
```

`npm start` 同时启动三个进程：原始 DevSpace MCP、轻量 Main Sol 自动唤醒器和轻量 Subagent App Server 调度器。模型进程仅在有工作时运行。`Ctrl+C` 停止本次前台服务。

### Agents 总览页

在 `https://你的域名/tips` 导航到 **Agents**，或直接打开 `/tips/agents`（需相同的私有查看密钥）。页面每 5 秒更新，提供 Server Main / App Server Sub / Web Chat 身份 / 旧 tmux Worker 四种来源，以及另外分开的运行中研究任务列表。**Web 身份“已认领”不代表窗口在线，tmux 会话也不保证里面正在运行模型。**

每张卡显示状态、模型（如果有）、简略最新进度、待确认消息数及最近消息的**主题**，可以通过「查看通信」跳转到针对该 Agent 的 Tips 留言筛选。数据直接来自 Subagent Registry、Web Identity Registry、Tips 任务/消息和服务器只读服务/进程检查，不重复调用 Luna/Sol，也不另造一份可能过期的状态。`GET /tips/agents/api` 与原 Tips API 使用相同的只读 Bearer 鉴权，绝不会将邀请码、claimKey、任务内部文件路径等敏感数据返回给看板。

**消息方向可视化：** Tips 留言板使用固定身份配色：Web 蓝/青、服务器 Main 紫、App Server Sub 绿、监控组件橙；发送方决定卡片左侧强调色。每条消息同时展示明确的「发 → 收」身份标签（不只靠颜色判断），点击任一标签可筛选该方向的消息。ACK / 已解决 / 高优先级沿用独立状态标记，桌面和窄屏均可阅读。

**无需 GitHub 即可本地运行。** 该仓库可先在服务器本地提交，后续再自行设置 GitHub remote。

## 配置与安全

`npm run setup` 生成如下私有文件：

- `var/config/config.json`：监听地址、端口、公开 URL、允许的工作根目录
- `var/config/auth.json`：DevSpace 原生自动生成并管理的 OAuth Owner Token，权限 0600。**用户无需自行填写 Token**，仍通过原有 OAuth 登录/验证页面授权。
- `var/state/`：OAuth 状态、Tips 消息、Agent Thread ID 等运行数据

**以上全部被 `.gitignore` 排除。** 不要提交 `auth.json`、`credentials.json`、`runtime.env`、SSH 私钥或任何运行目录。需要自定义代理或 Codex 可执行文件路径时：

**DevSpace OAuth 无需重复配置：** 原生 OAuth 登录/授权页面及其 `auth.json` 完全由 DevSpace 管理，用户通过页面完成验证即可，不需要向 `security.json` 填写 OAuth Token。

**Tips 配置（明文，私有文件）：** `var/config/security.json` 保存 Tips 的 `viewToken`、`writeToken`、`dispatchToken` 和 Web Wake 密钥。**`viewToken` 同时授予 Tips 查看与管理员操作权限，不再设置第二把 `webAdminKey`。** `npm run setup`/`security:unify` 会沿用原有 Tips Token，并从旧配置移除冗余管理员密钥。私有文件权限为 `0600`、被 Git 忽略；只提交 [`security.example.json`](security.example.json)。OAuth 仍由 DevSpace 原生流程管理。

**Web Wake 配对密钥也统一在这里：** `security.json.webWakeToken` 保存明文（由你自行设定，非空即可）；旧 `tips/web-wake-token.json` 仅是 SHA-256 哈希，无法反推出原值。迁移脚本遇到旧配置会生成一次新的随机 `webWakeToken`，需重新配对浏览器扩展；此后修改 `security.json` 或 `npm run web-wake:key` 即可。**DevSpace OAuth 仍不在此文件**。见 [`web-wake/README.md`](web-wake/README.md)。

**按需 Skills（Web MCP + Local Codex）：** `tips/skills/` 提供 Agent 协作、紧急 Sol 批量收信、AIR 科研门禁及 Tips 故障排查四类精简 Skill。Web MCP 调用 `tips_skills(list|read)`，无需整篇文档塞 Prompt；Local Codex 运行 `node scripts/install-skills.mjs` 将同一 Skill 链接到 `$CODEX_HOME/skills/`。安装脚本绝不覆盖已有 Skill 或系统内置内容。完整索引见 [`tips/skills/README.md`](tips/skills/README.md)。

要修改统一 Tips 查看/管理密钥，请修改服务器私有 `security.json` 的 `tips.viewToken` 字段（可用任意非空值），并同步更新旧 CLI 的私有凭证副本；重新加载 DevSpace MCP 后旧查看链接会失效。**持有此密钥可以删除任务、消息和身份，请只在自己控制的设备上使用。**

要修改 Web Wake 配对密钥，在服务器运行 `read -rs WAKE_KEY; printf '%s' "$WAKE_KEY" | npm run web-wake:key; unset WAKE_KEY`。浏览器插件选项里填写相同值，点击保存并连接。此密钥不再强制 32 位或固定字符规则；但短密钥更容易被猜中，应仅用于你完全控制的环境。

管理员撤销废弃 Web 身份无需二次审批、无需先认领身份，直接调用：

```text
web_identity({"action":"revoke","id":"web-old-reviewer","viewToken":"<私有 Tips 查看密钥>","reason":"会话废弃"})
```

每次 MCP 撤销都必须提供查看密钥。撤销只解除 `web-*` 身份及其会话凭证，不删除过去的 Tips 消息和研究历史。可重新 `prepare` 同名角色。管理事件记录在私有 `web-identities.json` 中。不要把查看密钥放进 Tips 消息或 Git。

### Tips 管理控制台（Agent 生命周期和清理）

打开私有 `/tips/agents`，用原来的 Tips **查看密钥**解锁后，页面自动显示「管理员操作」和 Web/Sub/任务/消息管理按钮，无需第二次输入任何密钥。删除前仍必须手动输入完整目标 ID 确认。查看密钥作为私有链接 fragment 使用，不能公开分享。

MCP `tips_admin` 每次传 `viewToken` 即可执行相同操作；`web_identity(action=revoke)` 也用这个密钥。网页 `/tips/admin/api` 只校验已有查看 Bearer Token。详情见 [`tips/TIPS_ADMIN.md`](tips/TIPS_ADMIN.md)。操作审计仍保存在私有 `tips/admin-audit.json`，不包含密钥。

请注意：Main (`server-controller`) 和旧 tmux 是实际服务/进程快照，不是可删除的注册槽。`sub-*` 要先停止并确认进入终止状态才能移除，移除仅清除注册表并归档旧 Codex Thread 的指针，不会删除实验、消息及日志。归档/删除运行中的任务、删除处理中消息会被拒绝。Tips 任务删除将同时删除对应 Tips 任务历史；消息只有明确执行 `delete_message` 才会从 Tips 状态中移除。

```bash
cp .env.example var/config/runtime.env
# 修改其中 TIPS_CODEX_BIN=...，以及可选的 HTTP_PROXY/HTTPS_PROXY
```

自带 DevSpace OAuth，不要将端口直接公开到互联网；生产环境通过 Caddy/Nginx 反向代理提供 HTTPS，参考 `docs/Caddyfile.example`。ChatGPT 插件连接 `https://mcp.example.com/mcp`，进度面板为 `https://mcp.example.com/tips`。

如需生成 Tips 面板链接，在服务器运行 `node tips/tips-cli.mjs url`。**此链接现在同时具有读取和管理能力**，不要公开分享。

## systemd 持续运行

```bash
npm run install:user-service
# 先检查生成的 ~/.config/systemd/user/devspace-tips-mcp.service
systemctl --user enable --now devspace-tips-mcp.service
systemctl --user status devspace-tips-mcp.service
journalctl --user -u devspace-tips-mcp.service -f
```

登录用户退出后也需要持续服务时，在有权限的系统上使用 `loginctl enable-linger "$USER"`。`npm start` 和 systemd 单元不要同时运行；同一端口只能有一个 MCP 实例。

## Tips 和 Subagent

**长期科研 Agent Prompt 协议：** [`tips/RESEARCH_LOOP.md`](tips/RESEARCH_LOOP.md) 规定 Web Main（总调度/高难度路线）、Web Sub（独立审查）、Local Sol Main（事件驱动调度）和 Local Luna Sub（有检查点的持久执行）的任务闭环。生产的 Local Main/Local Sub 每次实际模型 Turn 都附带短版研究契约；Web Chat 通过 MCP server instructions 接收职责说明，详细指导只在需要时读取 Skill。`ACK`/发送消息不等于科研任务已验证完成；下次 Owner、动作、验收与触发事件必须明确。仅修改 Prompt 不能让无新事件的模型无限后台运行。

Local Subagent 的**持久身份注册上限是 128 个**；并发执行由 `TIPS_SUBAGENT_MAX` 单独控制，默认 2、硬上限 4。已完成身份可用相同名称和运行配置继续持久 Thread，不必删除研究历史来腾名额。增加注册容量不会解除科研 `dispatch_hold`、STOP、GPU/Owner 等门禁。

六个主要协作 MCP 工具：`tips`（任务/心跳/历史）、`tips_messages`（常规留言/ACK）、`tips_exchange`（可验收事务）、`subagent`（管理 App Server Agent）、`web_identity`（多个 Web Chat 独立认领身份）、`web_mail`（Web↔Web / Web↔Agent 通信）。所有工具都附有 action 级说明和关键参数的 MCP schema `.describe()`。**给新 Agent 的推荐使用指南：[`tips/AGENT_TOOL_USE.md`](tips/AGENT_TOOL_USE.md)**；其工具元数据来源在 `vendor/devspace/dist/tips-tool-descriptions.js`，使用手册与元数据由测试检查一致性。

### 多 Web Chat 身份注册

所有窗口仍然通过 DevSpace OAuth 认证，但不同 ChatGPT 对话应分别拥有 `web-*` 身份。主 Web 可调用 `web_identity(action="prepare",id="web-reviewer-01",label="Reviewer")` 生成私有的一次性邀请码，有效期 **10 分钟**。另一 Web Chat 调用 `web_identity(action="claim",id="web-reviewer-01",invite="...")` **立即认领，无需任何审批**，获得 7 天身份租约。

之后调用 `web_identity(action="whoami")`。如 MCP Host 提供稳定的 `openai/session` 会话元数据，服务器可自动识别；如未提供，则需要在后续调用中传入 claim 返回的私有 `claimKey`。不要将 invite / claimKey 写入 Tips 消息、公开日志或代码仓库。`renew` 可以续租，`release` 释放自己的身份。

每个 Chat 使用 `web_mail` 的 `send`、`inbox`、`sent`、`get`、`ack`、`reply`、`resolve`、`verify` 操作。发送者身份由服务器从认领信息确定，不能靠自行填写 `from` 冒充。目标 Web Chat 下次调用 `inbox` 即可读取消息；**Tips 无法自动唤醒已经关闭或闲置的 ChatGPT 聊天**。双方消息及回执保存到 Tips Board；这是服务器身份系统，并非 ChatGPT 平台内建的窗口级隔离功能。

每个新 App Server Sub Agent 有稳定的 Thread ID。完整通讯协议只在该 Thread 的第一个真实 Turn 注入一次；后续只传新消息并尝试 `turn/steer`，不重复占用大量 Prompt Token。未 ACK 的消息有受限重投递，防止无穷唤醒。Main Agent 仅对有可信来源、未满 6 小时的新技术阻塞做有限次自动诊断，不能恢复用户显式停止的实验。具体规则见 `tips/SUBAGENTS.md`、`tips/MCP_INSTRUCTIONS.md` 和 `tips/SERVER_CONTROLLER.md`。

## 从已有服务器迁移

**不要在现有正式 MCP 运行中切换端口或目录。** 建议先用另一个端口启动本仓库验证，然后安排停机/切换窗口。`npm run setup` 创建的是新环境，不会读取、覆盖原来的全局 DevSpace 安装和旧 Tips 数据。

需要保留旧消息、任务状态、Owner Token、Sol/Sub Thread ID 时，可在新仓库尚未启动且 `var/config/auth.json`、`var/config/config.json` 目标不存在的情况下手动使用：

```bash
node scripts/migrate-state.mjs \
  --from-config /old/devspace-config \
  --from-state "$HOME/.local/share/devspace"
```

迁移后检查 `var/config/config.json` 的端口、公开域名和 `allowedRoots`，使用 `npm run setup -- --port <新端口>` 调整，然后 `npm run doctor`。对于**同一 Linux 用户**，已保存在其 `~/.codex` 的 Thread 可尝试恢复；跨机器迁移时，还需要独立处理 Codex 登录/历史会话存储。该迁移脚本**只复制**私有数据，不停止旧服务、不迁移实验数据、不自动替换线上 MCP，也不会把凭据加入 Git。

## Git 操作

仓库初始化并完成第一次本地提交后，你可以自行执行：

```bash
git remote add origin git@github.com:YOUR_ACCOUNT/YOUR_REPO.git
git branch -M main
git push -u origin main
```

首次推送前可再次运行 `git ls-files` 确认无密钥、实验输出或私有运行文件。

**许可证**：上游 DevSpace 保留在 `vendor/devspace/LICENSE` 的 MIT 许可及原始 README。本站自定义集成代码在同一仓库中供你自行部署与修改。
