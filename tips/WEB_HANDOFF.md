# Local Sol ↔ Web Chat：可持续唤醒与后备调度

## 当前策略

1. 任意**可信的新消息**发往 `server-controller`，默认 `wake=true`。`wake:false` 仍可明确保持无模型消耗的普通留档。不可信 Tips write Token 不得授权启动 Sol；`server-controller` 自己发信不会唤醒自己。
2. Local Sol 作为真正的 Main 指挥者：每次处理一条已领取消息，附带最多 12 条其他待处理可信消息，验证后集中 ACK/委派/完成；避免同时启动多次 Sol。
3. 需要 Web 高级推理时，由 Local Sol **主动**发起 Web Handoff：

```bash
printf '%s' '{"to":"web-air-main","subject":"AIR CPU 因果设计审查","body":"请独立复核当前 CPU-only 证据与控制组；GPU NO-GO 不得解除","sourceId":"CURRENT_SOL_WAKE_MESSAGE_ID"}' \
  | node tips/web-handoff.mjs request

node tips/web-handoff.mjs status web-handoff-xxxxxx
```

`request` 先确认收件人 Web 身份已认领且租约有效；然后生成 `server-controller → web-*` 的 **tracked 消息**与同名 `web-handoff-*` Tips 进度卡。对相同 `sourceId`/收件角色幂等，减少重复通知。

4. Web Wake Relay 读取 Tips 待处理消息与有效 Web 身份，向扩展推送 `{id,to}` 和不含正文的 ACK 标志。扩展仅在匹配的 ChatGPT 对话打开、页面空闲、输入框空时提交提示。**成功提交一次立刻持久标记 `submitted`，绝不重复提交同一条消息**；真实 Web Agent ACK 后才标记 `done`。提交失败则保留 `pending` 待重试。恢复连接时可显示 30 天内未确认邮件，但 Web 身份租约仍需有效（默认 7 天）。
5. `tips-server-controller` 的轻量定期扫描只看 Tips 记录，不调用模型。Handoff **45 分钟没有 Web ACK**、**已 ACK 但 3 小时没完成验收**，或 Web 正式拒绝/请求修改时，自动仅发送**一次**可信提醒给 Local Main，由 Sol 决定 Luna 后备还是继续等待；绝不自动解除 GPU/STOP/Owner 门禁。Web 后续 ACK 和 Verify 仍可在任务卡追踪，避免并行重复修改同一实验。

**重要限制**：无法通过 DevSpace MCP 直接从云端启动一个不存在的 ChatGPT Web 会话。Web Wake 仅依赖用户自控的浏览器扩展和在线的匹配标签页；离线只可保存消息和等待后备调度。

**本地扩展更新（2026-10-13）**：Web Wake v0.1.8 加入完整回复状态、Working/Stop/流式信号和 20 秒稳定空闲窗口，处理中不插入新提醒，结束后再次核对 pending/ACK。页面脚本失联时先尝试无刷新恢复。已通过真实 Edge DOM 调查、独立计算聊天及原 Web Main 无刷新脚本恢复检查；瞬时按钮缺失和 ACK 竞态由自动化测试覆盖。浏览器更新需 Reload 扩展；不能据此推断 Web 已 ACK 或科研任务完成。详见 [`../web-wake/BROWSER_VALIDATION.md`](../web-wake/BROWSER_VALIDATION.md)。

**没有凭证存进 Git**。真实配置仍在服务器私有 `security.json`，不能把该文件、Tips 查看/管理密钥、Web Wake 配对 Token、任何私钥复制到本项目文档或 Agent 邮件里。

## 排查方法

- `/tips` 查看 `web-handoff-*` 任务卡。`pending` 表示已发出但尚无 ACK；`running` 表示 Web 已 ACK 但不代表评审完成；`completed` 仅表示 Web 通信协议的验收已接受，不是科学结果有效性的证明。
- Web 未 ACK：查 Web 身份租约、浏览器扩展状态、标签页标题和 URL 固定绑定、消息是否仍 unread。
- 多次重复提醒：扩展只在未 ACK 时按退避重试；如果浏览器标签页被隐藏、忙碌、草稿非空，消息保持待发送。
- 超时后只有**一次**后备唤醒：检查 `tips-web-handoff-watch` 发出的消息和 Local Main 的真实进程、审计。后备收到后不应自动删除原 Web 审查请求，而应该识别重复 Owner。
