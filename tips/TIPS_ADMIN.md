# Tips 管理员与 Agent 生命周期

## 两种身份 / 两把钥匙

DevSpace 原生 OAuth 仍由 DevSpace 的授权页面与 `auth.json` 处理。Tips 的私有明文 `security.json` 保存 `tips.viewToken`、`tips.writeToken`、`tips.dispatchToken`、`webAdminKey`，以及 Web Wake 专用 `webWakeToken`。文件权限为 `0600`、已排除 Git。代码库只保留 `security.example.json`；只有 `webAdminKey` 可以授予管理员操作权限。

- **只读用户**：`/tips` 的查看密钥可阅读任务、Agent 总览、消息，不可管理或注销 Agent。
- **管理员**：除读取看板外，在 `/tips/agents` 展开管理员面板输入 `webAdminKey`；或调用 `tips_admin({"action":"…","id":"…","adminKey":"<私钥>"})`。HTTP `/tips/admin/api` 必须同时提供私有 Tips 查看 Bearer Token 和 JSON 中的管理员密钥。单独的 OAuth 登录或 Tips write/dispatch token 不代表管理员身份。
- 管理密钥必须**每次调用**提供，无登录会话、无管理员租约。看板验证后将密钥保存在**本页面 JS 内存**直到刷新/锁定，绝不写入 URL、localStorage 或 Tips 留言。管理员 key 不得复制到 README、Git 或 Agent 任务正文。

## 操作对照（删除 ≠ 停止运行）

| `tips_admin.action` | 对象 | 动作与保留数据 | 限制 |
| --- | --- | --- | --- |
| `history` | 审计 | 读取最近 100 条管理操作 | 需要管理员密钥，不需要 `id` |
| `revoke_web` | `web-*` | 立即撤销会话绑定与 claimKey，但**保留角色登记和历史消息** | 角色必须存在 |
| `remove_web` | `web-*` | 从身份注册表完全移除该角色，旧 claimKey/session 立即失效 | 不删除发给该角色的历史消息；以后可重新 `prepare` 同名身份 |
| `stop_sub` | `sub-*` | 对队列中 Agent 标为 stopped；运行中请求正常终止 | 不是同步 kill，也不等于已退出；不影响其他 Sub |
| `remove_sub` | `sub-*` | 移除注册表条目，把旧 Codex Thread 指针移动到私有 `app-agents/retired/` | **queued/running/stopping 拒绝**；有活着的 PID 也拒绝；实验和日志不删除 |
| `archive_task` | Tips task ID | 隐藏任务卡，保留其状态和历史 | 正在 `running` 拒绝 |
| `delete_task` | Tips task ID | 删除任务和**对应的 Tips 任务状态历史** | 正在 `running` 拒绝，不删除研究磁盘文件 |
| `delete_message` | 消息 UUID | 仅删除指定 Tips 留言 | 正在 `processing` 拒绝；请注意会永久丢失该消息的 Tips 审计链 |

Main (`server-controller`) 与 `air-*` 等 tmux 旧 Worker 由 systemd/tmux 状态**实时发现**，并不是可移除的身份注册记录。Tips 管理 API 不提供删除 Main 服务或杀掉整个 tmux 会话的能力。清理旧运行实例时，需要先在对应 Owner 的安全流程里停止，再处理其 Tips 任务卡。

## 操作示例

```text
tips_admin({"action":"remove_web","id":"web-unused","adminKey":"<私有管理员密钥>","reason":"conversation retired"})
tips_admin({"action":"stop_sub","id":"sub-finished-reviewer","adminKey":"<私有管理员密钥>"})
# 等待 subagent(status) 返回 stopped / completed / failed / interrupted 后：
tips_admin({"action":"remove_sub","id":"sub-finished-reviewer","adminKey":"<私有管理员密钥>"})
tips_admin({"action":"archive_task","id":"air-old-summary","adminKey":"<私有管理员密钥>"})
tips_admin({"action":"delete_message","id":"<消息 UUID>","adminKey":"<私有管理员密钥>"})
tips_admin({"action":"history","adminKey":"<私有管理员密钥>"})
```

网页：在 Tips 页解锁查看密钥 → 展开「管理员操作」→ 输入私有 `webAdminKey` → 验证 → 每张 Web/Sub/任务/消息卡片的操作按钮出现。操作前要手动输入**完整目标 ID**二次确认。Web 页面可以勾选「显示已释放/撤销 Web 身份」。

## 审计与运行时数据

全局管理员操作审计位于私有运行目录的 `tips/admin-audit.json`；Web 身份管理另写入私有 `web-identities.json` 的 adminEvents。记录操作时间、操作类型、目标 ID、可选原因，**不写入管理员密钥**。审计记录不是 Git 项目文件。

移除 Web 身份不会清除历史 Tips 留言，旧身份仍会在消息的 from/to 中出现，这是为了保持研究通信可追溯。移除 Sub 后，旧 Codex Thread 指针会归档，新建同名 Agent 从新的 Thread 开始，不会意外接续废弃会话。不要用 `delete_task` 或 `delete_message` 清理正在审查的证据。科研 STOP、冻结结果、GPU/Owner 锁与审批要求不因拥有管理员密钥而自动失效。

## 回归测试与上线

`node --test tips/*.test.mjs` 覆盖授权、Web 撤销与移除、Sub Stop/Remove、Task/Message 删除边界、HTTP 双重认证与审计；`node --test web-wake/*.test.mjs` 验证浏览器唤醒插件没有被改坏。

生产安装 `vendor/devspace/dist/tips.js`、`tips-admin.js`、`tips-agent-overview.js` 与网页静态文件时，请注意在**全局安装位置**使用正确的 `subagents.mjs` 导入路径；服务器 Main/Sub 管理进程与 MCP HTTP 进程分离，别为了更新 Tips 界面而随意中断运行中的科研任务。需要重启 MCP 才能使新 `/tips/admin/api` 和 MCP `tips_admin` 工具生效。
