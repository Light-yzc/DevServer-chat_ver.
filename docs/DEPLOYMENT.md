# DevSpace + Tips 部署与更新手册

本文区分 **全新独立安装** 与 **现有 AIR 生产服务器原位更新**。**不要把新机器的 `npm run setup`、`npm start` 直接用于正在运行的生产实例**：仓库与线上运行目录是分开的，覆盖运行时配置可能丢失 OAuth、Tips 任务、Codex Thread 和 Web Wake 绑定。

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [`../README.md`](../README.md) | 架构、功能、快速开始、配置与安全 |
| [`../tips/README.md`](../tips/README.md) | Tips 面板、Agent 服务、任务和消息 |
| [`../tips/WEB_HANDOFF.md`](../tips/WEB_HANDOFF.md) | Local Sol ↔ Web Chat 的追踪交接与后备调度 |
| [`../web-wake/README.md`](../web-wake/README.md) | Web Wake 服务端与本地浏览器扩展安装、更新 |
| [`../web-wake/TODO.md`](../web-wake/TODO.md) | 待本地代理浏览器核验的“Web 忙碌时不注入”改进；**尚未部署** |
| [`Caddyfile.example`](Caddyfile.example) | 基础 Caddy HTTPS 反代示例 |

## A. 全新 Linux 服务器（独立安装）

准备 Linux、Node.js `>=22.19 <27`、npm、Git；运行 Local Agent 还需已安装、可登录并支持指定模型的 Codex CLI。

```bash
git clone https://github.com/Light-yzc/DevServer-chat_ver..git devspace-tips-mcp
cd devspace-tips-mcp
npm install
npm run setup -- \
  --allowed-root /absolute/path/to/research-workspace \
  --public-url https://mcp.example.com \
  --host 127.0.0.1 --port 7676
npm run doctor
npm test
node --test web-wake/*.test.mjs
npm start
```

> 这里显式指定克隆目录为 `devspace-tips-mcp`，避免仓库远端名称中的标点影响工作目录。

`npm start` 启动 MCP、轻量 Local Main 和 Subagent Manager；首次初始化产生的 `var/config/` 与 `var/state/` **只能存放在服务器私有目录**，不提交 Git。正式对外访问请将 MCP 绑定在 `127.0.0.1`，通过可信的 Caddy/Nginx 配置 HTTPS 并完成 DevSpace 原生 OAuth；参考 [`Caddyfile.example`](Caddyfile.example)。公网地址 `/mcp` 是插件入口，`/tips` 是任务看板。

经核对后可以改用 user systemd：

```bash
npm run install:user-service
systemctl --user cat devspace-tips-mcp.service   # 先核对服务路径、用户和环境
systemctl --user enable --now devspace-tips-mcp.service
systemctl --user status devspace-tips-mcp.service
```

**不要同时运行** `npm start` 和同一端口的 systemd 服务。Codex CLI、代理、模型权限和允许的工作根目录须单独验证；安装服务不代表能运行实验。

## B. 现有 AIR 服务器（原位更新，**不要运行 setup**）

截至 2026-10-13，当前服务器实际采用下述分离布局：

| 作用 | 路径 |
| --- | --- |
| Git 源代码仓库 | `/mnt/disk1/yangzhongcheng/devspace-tips-mcp` |
| Tips 生产脚本 | `/mnt/disk1/yangzhongcheng/tips` |
| DevSpace 生产配置 | `/mnt/disk1/yangzhongcheng/devspace-config` |
| 全局 DevSpace 编译产物 | `/mnt/disk1/yangzhongcheng/tools/nvm/versions/node/v22.23.3/lib/node_modules/@waishnav/devspace/dist` |
| 私有 Tips/Agent 状态 | `/home/yangzhongcheng/.local/share/devspace` |
| MCP 进程 | `tmux` 的 `dev:0.0`，经原有反向隧道与 Caddy 提供服务 |
| Local Main / Sub Manager | 用户级 `tips-server-controller.service` / `tips-subagent-manager.service` |

上述为**这台服务器当前布局**，不是通用安装目录。生产仓库的 `vendor/devspace/dist` 和生产脚本/模块**不是同一份文件**，`git push`、`git pull` 均不会自动完成线上部署。

### B1. 升级前核对（只读）

```bash
cd /mnt/disk1/yangzhongcheng/devspace-tips-mcp
git status --short          # 有未提交修改就先保留并查清来源；禁止 reset --hard
git log -1 --oneline
git diff --check
systemctl --user is-active tips-server-controller.service tips-subagent-manager.service
tmux list-panes -t dev:0.0 -F '#{pane_pid} #{pane_current_command}'
```

另外读取 **Tips Agent 当前 running/queued 状态、实际 OS 子进程、GPU/CPU 实验、STOP、`dispatch_hold` 和 GPU NO-GO**。用户/Owner 尚未允许重启或任务还在运行时，**仅准备变更，不重启、不强杀**。即使服务 active，也不代表 Agent 空闲。不能为了部署重新派工、解除科研门禁或重复跑实验。

### B2. 在仓库先验证更新

```bash
NODE=/mnt/disk1/yangzhongcheng/tools/nvm/versions/node/v22.23.3/bin/node
"$NODE" --test tips/*.test.mjs
"$NODE" --test web-wake/*.test.mjs
git diff --check
```

对**计划部署的所有 `.js/.mjs`** 额外运行 `"$NODE" --check <文件>`。检查 Git diff/暂存文件是否含任何凭证、秘钥、私有配置、实验输出。**失败停止部署**。如 Git 有他人的未提交变更，不覆盖也不擅自提交。

### B3. 文件备份、差异适配和同步

1. 列出提交实际改动的文件；只处理**需要上线的运行文件**。从生产目录逐文件备份到权限受限的备份目录，并保留时间戳。不要覆盖生产 `security.json`、`auth.json`、`config.json`、Tips 状态、Agent Thread、GPU 实验数据。
2. `vendor/devspace/dist/*.js` 中受影响的 MCP 模块需要同步到上表的全局 DevSpace `dist/`；**不能**只更新仓库就认为线上生效。对于 Tips 运行脚本，同步到 `/mnt/disk1/yangzhongcheng/tips/`。
3. **核对生产 import 差异**：仓库 Tips 脚本引用 `../vendor/devspace/dist/...`；生产脚本则引用 `../tools/nvm/versions/node/v22.23.3/lib/node_modules/@waishnav/devspace/dist/...`。全局 `tips-admin.js` 的 `subagents.mjs` 相对 import 深度也不同。同步这些文件必须**只适配对应导入路径并核查完整 diff**，不可盲目 `cp -r` 覆盖生产、也不可保留错误路径。某些生产文件与仓库不完全相同正是正常的环境适配。
4. **文档或浏览器扩展单独更新不要求重启 MCP**。如果修改 MCP 服务编译代码，需在没有正在处理中断风险时安排 MCP 重启；修改 Local Controller/Manager 行为分别核查并安全重启相应的 systemd 用户服务。不要在 Sol/Luna 正执行 Turn 时强制重启，且不要以重启作为解除失败熔断的方法。

`web-wake/deploy-existing-devspace.sh` 是早期**特定单端口 CLI/WebSocket 集成**脚本，并非本仓库通用更新命令；它会替换入口并重启 MCP，**不要直接拿它执行所有版本升级**。生产变更应先有精确文件清单、备份与回滚方案。

### B4. 灰度与生产验收

- 比较上线文件与仓库的内容；生产导入路径差异必须能被单独解释。对生产 `.js/.mjs` 运行 `node --check`。
- 核对需要更新的进程确实加载了新文件（PID / 启动时间），而不是只有文件时间戳变化；按顺序检查 user systemd、tmux MCP 与反向代理。
- 检查本地 `http://127.0.0.1:7676/tips` HTTP 200、通过 OAuth 访问的公网 `/mcp`、以及公网 `/tips`；如修改 Web Wake Relay，再独立验证 WebSocket `/web-wake/ws` 的升级、鉴权与未读/ACK 流程。HTTP 200 **不能**代表 Agent 实际完成了研究或浏览器注入测试。
- 读现有任务卡和 Agent 状态，只做无破坏性功能检查；10240 字符、熔断和 10 分钟聚合应先用隔离测试与只读生产检查验证，不人为让真实科研 Agent 失败或注入危险邮件。
- 若健康检查不通过，先恢复已备份的**对应生产文件**，再在安全窗口重启受影响服务；保留失败日志并记录实际恢复版本。不要覆盖活跃任务记录、私有 OAuth 或模型状态。

### B5. 当前 Web Wake 扩展（本地 Edge/Chrome）

1. 若**仅修改** `web-wake/extension/`，将最新扩展文件复制到原来的**本地**加载目录，而不是服务器仓库目录；不要卸载重装以免丢失持久绑定。
2. Edge 打开 `edge://extensions`（Chrome 为 `chrome://extensions`），点击已加载扩展的 **Reload**；刷新对应 ChatGPT 标签页，使新的 content script 生效。
3. 检查角色绑定、WebSocket 连接和 `pending → submitted → done`；`submitted` 表示浏览器提交，只有真实 MCP ACK 才是 `done`。
4. v0.1.7 已将“Web 当前任务完成后再检查一次 `web_mail(inbox)`”写入注入 Prompt；只有更新并 Reload 本地扩展、刷新 ChatGPT 页面后才使用新版文字，MCP Server Instructions 另需在安全窗口重启 MCP 才生效。`web-wake/TODO.md` 的**浏览器忙碌检测 / 工作中禁止打断**仍是待办，不能宣称已修复，需本地代理浏览器实测真实 UI 后再修改。

## 安全检查清单

- [ ] 确认当前仓库 HEAD、目标提交和 Git 未提交改动归属
- [ ] 核对正在运行的 Sol/Luna/实验、服务状态及科研门禁
- [ ] 代码回归与语法检查通过、变更中无凭证
- [ ] **逐文件备份**生产运行文件并记录可回滚版本
- [ ] 仓库 / 生产不同 import 路径已显式适配、核对
- [ ] 只在安全窗口重启确实需要的服务，不清理任何私有状态
- [ ] 生产 HTTP、MCP、WebSocket（如涉及）和 Agent 真实状态验收
- [ ] 浏览器扩展如有变更，用户本地手动 Reload + 刷新页面

**此手册只记录操作方法，不会自动变更或部署现有生产环境。**
