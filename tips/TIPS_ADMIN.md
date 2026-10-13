# Tips 管理员与 Agent 生命周期

## 统一查看与管理密钥

DevSpace 原生 OAuth 仍由 DevSpace 的授权页面与 `auth.json` 处理。私有明文 `security.json` 保存 `tips.viewToken`、`tips.writeToken`、`tips.dispatchToken`，以及 Web Wake 专用 `webWakeToken`。文件权限 `0600`、已排除 Git；仓库只保留 `security.example.json`。**Tips 的查看密钥现在也用于管理和删除，不再有额外 `webAdminKey`。**

- **Tips 查看用户 = 管理用户**：在 `/tips` 解锁一次即可显示管理入口，无需再输入密钥；持有查看链接的人也能够撤销身份、归档或删除数据。
- **Web API**：`/tips/admin/api` 使用与查看页相同的 Bearer `viewToken`，不再接受或校验第二把管理员密钥。
- **MCP**：`tips_admin({"action":"…","id":"…","viewToken":"<私有 Tips 查看密钥>"})`；每次请求都传查看密钥。`web_identity(action=revoke)` 也使用同一个 `viewToken`。DevSpace OAuth 本身不等于拥有 Tips 查看密钥。
- Tips 查看链接或密钥现在具备删除权限，须当作高权限凭证保护。删除操作仍要求完整目标 ID 二次确认，保留审计。

## 操作对照（删除 ≠ 停止运行）

| `tips_admin.action` | 对象 | 动作与保留数据 | 限制 |
| --- | --- | --- | --- |
| `history` | 审计 | 读取最近 100 条管理操作 | 需要 Tips 查看密钥，不需要 `id` |
| `revoke_web` | `web-*` | 立即撤销会话绑定与 claimKey，但**保留角色登记和历史消息** | 角色必须存在 |
| `remove_web` | `web-*` | 从身份注册表完全移除该角色，旧 claimKey/session 立即失效 | 不删除发给该角色的历史消息；以后可重新 `prepare` 同名身份 |
| `stop_sub` | `sub-*` | 对队列中 Agent 标为 stopped；运行中请求正常终止 | 不是同步 kill，也不等于已退出；不影响其他 Sub |
| `remove_sub` | `sub-*` | 移除注册表条目，把旧 Codex Thread 指针移动到私有 `app-agents/retired/` | **queued/running/stopping 拒绝**；有活着的 PID 也拒绝；实验和日志不删除 |
| `archive_task` | Tips task ID | 隐藏任务卡，保留其状态和历史 | 正在 `running` 拒绝 |
| `delete_task` | Tips task ID | 删除任务和**对应的 Tips 任务状态历史** | 正在 `running` 拒绝，不删除研究磁盘文件 |
| `delete_message` | 消息 UUID | 仅删除指定 Tips 留言 | 正在 `processing` 拒绝；请注意会永久丢失该消息的 Tips 审计链 |

Main (`server-controller`) 与 `air-*` 等 tmux 旧 Worker 由 systemd/tmux 状态**实时发现**，并不是可移除的身份注册记录。Tips 管理 API 不提供删除 Main 服务或杀掉整个 tmux 会话的能力。清理旧运行实例时，需要先在对应 Owner 的安全流程里停止，再处理其 Tips 任务卡。

## 操作示例

### Local Main 低风险退休入口（不向模型透露密钥）

在**当前受信任 Linux 用户下**运行下列本地 CLI；它不是远程 MCP 管理 API，不能用作严格 Main/Luna 操作系统级权限隔离：

```bash
node tips/subagent-retire-cli.mjs candidates
node tips/subagent-retire-cli.mjs retire sub-old-reviewer \
  --confirm sub-old-reviewer \
  --reason "Owner confirmed obsolete QA; evidence and tasks archived"
```

只有 Owner 明确要求整理旧 Sub 时，Local Main 才应先读候选、检查当前科研 Owner/实验状态，再退休逐个确认的身份。工具**默认只读**；退休需要相同 ID 的二次确认、14 天无活动、已结束的 Agent + Tips 任务卡、无本身份未读信、无未完成任务 Owner/依赖引用、无待诊断失败熔断。实际删除走同一 `tips_admin(remove_sub)` 内部管理审计，Token 只在本地进程内传递，不应出现在 CLI 参数、Prompt、Tips 消息或日志中。不会自动停止 Agent、删除科研文件、历史任务/邮件或解除 STOP/GPU/`dispatch_hold`；有不确定的任务关系或研究门禁应放弃清理而非强制通过。此工具不会自行创建定时任务。

CLI 在生产复制到 `/mnt/disk1/yangzhongcheng/tips/` 时，必须按当前服务器布局适配 `vendor/devspace/dist` 的导入到实际全局模块路径并通过 `node --check`，然后才可使用；参见 `docs/DEPLOYMENT.md`。

```text
tips_admin({"action":"remove_web","id":"web-unused","viewToken":"<私有 Tips 查看密钥>","reason":"conversation retired"})
tips_admin({"action":"stop_sub","id":"sub-finished-reviewer","viewToken":"<私有 Tips 查看密钥>"})
# 等待 subagent(status) 返回 stopped / completed / failed / interrupted 后：
tips_admin({"action":"remove_sub","id":"sub-finished-reviewer","viewToken":"<私有 Tips 查看密钥>"})
tips_admin({"action":"archive_task","id":"air-old-summary","viewToken":"<私有 Tips 查看密钥>"})
tips_admin({"action":"delete_message","id":"<消息 UUID>","viewToken":"<私有 Tips 查看密钥>"})
tips_admin({"action":"history","viewToken":"<私有 Tips 查看密钥>"})
```

网页：使用 Tips 查看密钥解锁一次 → 展开「管理员操作」或直接使用 Web/Sub/任务/消息卡片管理按钮 → 操作前手动输入完整目标 ID 确认。Web 页面可以勾选「显示已释放/撤销 Web 身份」。**不会再出现第二次密钥输入。**

## 审计与运行时数据

操作审计位于私有运行目录的 `tips/admin-audit.json`；Web 身份管理另写入私有 `web-identities.json` 的 adminEvents。记录操作时间、操作类型、目标 ID、可选原因，**不记录查看密钥**。审计记录不是 Git 项目文件。

移除 Web 身份不会清除历史 Tips 留言，旧身份仍会在消息的 from/to 中出现，以保持研究通信可追溯。移除 Sub 后，旧 Codex Thread 指针会归档，新建同名 Agent 从新的 Thread 开始。不要用 `delete_task` 或 `delete_message` 清理正在审查的证据。科研 STOP、冻结结果、GPU/Owner 锁与审批要求不因持有查看/管理密钥而自动失效。

## 回归测试与上线

`node --test tips/*.test.mjs` 覆盖查看密钥授权、Web 撤销与移除、Sub Stop/Remove、Task/Message 删除边界、HTTP 单密钥鉴权与审计；`node --test web-wake/*.test.mjs` 验证浏览器唤醒插件没有被改坏。

生产安装 `vendor/devspace/dist/tips.js`、`tips-admin.js`、`tips-agent-overview.js` 与网页静态文件时，请注意在**全局安装位置**使用正确的 `subagents.mjs` 导入路径；服务器 Main/Sub 管理进程与 MCP HTTP 进程分离，别为了更新 Tips 界面而随意中断运行中的科研任务。需要重启 MCP 才能使新 `/tips/admin/api` 和 MCP `tips_admin` 工具生效。
