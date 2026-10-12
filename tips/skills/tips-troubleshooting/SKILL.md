---
name: tips-troubleshooting
description: Read to debug unread Tips messages, Local Main/Sub communication, Web Wake extension, tracked receipts, and Agent lifecycle mismatches.
---

# Tips 通信 / Web Wake 排查

- `unread` 发往 `server-controller` 且 `wakeAuthorized=false`：发送方显式 `wake:false` 或历史留档；下一次 Sol 唤醒时可附带批处理。**新可信 Main 消息默认 wake=true。**
- `unread` 发往 `server-controller` 且 `wakeAuthorized=true`：已请求唤醒，等待 Local Main daemon 领取。
- `unread` 发往 `controller`：旧版 Web 收件箱，无保证持续读取；请改发已认领 Web Main。
- `unread` 发往 `web-*`：Web Chat 尚未读取/ACK。Web Wake 只是浏览器扩展自动提交提醒，不是官方云端唤醒 API。
- Web Wake 提醒提交成功不代表 Web Agent ACK。浏览器扩展对未 ACK 的提醒按 20～120 分钟退避重试；有效的 Web 注册仍受 7 日租约限制。Local Sol 的 `web-handoff-*` 专用任务如果超过 45 分钟无人 ACK，会排入**一次**后备协调请求；检查 `tips/WEB_HANDOFF.md` 和实际任务卡以分辨网络失联、标签页未打开、尚未登录和真正的已读。
- `delivered` 不是 ACK；tracked 的完成需要接收方 `verify`。
- Local Sub 未响应时检查 Manager、Thread、运行/停止状态；不要仅凭进程存在就认为任务成功。
- Local Sub 的 `sub-*` 身份与 Tips 同名任务卡绑定。卡片 `pending` 表示排队或收到请求，不证明 Agent 已经开始；`running` + 心跳表示存活，里程碑进度和日志要由 Agent 实际提交。
- Local Main 的 watcher 为 active 不等于 Sol 正在工作。需检查服务日志、Codex 子进程与实际消息回执；若 systemd 环境找不到 Codex，检查 `TIPS_CODEX_BIN` 指向的绝对路径和 `~/.local/bin/codex` 是否可执行。使用 `scripts/doctor.mjs` 验证。

排查顺序：Tips `/tips?tab=mailbox` → 源、目的、状态和审计 → `systemctl --user is-active tips-server-controller tips-subagent-manager` → 当前 Agent Registry → 对应运行日志。**不要批量伪造 ACK、重放历史 GPU 指令或删除科研证据。**

细节：`tips/MAIN_MAIL_DIAGNOSTICS.md`、`tips/MCP_INSTRUCTIONS.md`、`tips/TIPS_ADMIN.md`、`web-wake/README.md`。私有 Token 仅在 `security.json`，不要放进日志或发信正文。
