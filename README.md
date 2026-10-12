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

**无需 GitHub 即可本地运行。** 该仓库可先在服务器本地提交，后续再自行设置 GitHub remote。

## 配置与安全

`npm run setup` 生成如下私有文件：

- `var/config/config.json`：监听地址、端口、公开 URL、允许的工作根目录
- `var/config/auth.json`：随机生成的 OAuth Owner Token，权限 0600
- `var/state/`：OAuth 状态、Tips 消息、Agent Thread ID 等运行数据

**以上全部被 `.gitignore` 排除。** 不要提交 `auth.json`、`credentials.json`、`runtime.env`、SSH 私钥或任何运行目录。需要自定义代理或 Codex 可执行文件路径时：

```bash
cp .env.example var/config/runtime.env
# 修改其中 TIPS_CODEX_BIN=...，以及可选的 HTTP_PROXY/HTTPS_PROXY
```

自带 DevSpace OAuth，不要将端口直接公开到互联网；生产环境通过 Caddy/Nginx 反向代理提供 HTTPS，参考 `docs/Caddyfile.example`。ChatGPT 插件连接 `https://mcp.example.com/mcp`，进度面板为 `https://mcp.example.com/tips`。

如需显示仅有读取权限的面板链接，在服务器运行 `node tips/tips-cli.mjs url`。链接含私有查看凭据，不要公开分享。

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

六个主要协作 MCP 工具：`tips`（任务/心跳/历史）、`tips_messages`（常规留言/ACK）、`tips_exchange`（可验收事务）、`subagent`（管理 App Server Agent）、`web_identity`（多个 Web Chat 独立认领身份）、`web_mail`（Web↔Web / Web↔Agent 通信）。

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
