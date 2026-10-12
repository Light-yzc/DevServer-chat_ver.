# Tips Mail 通信诊断：为什么“未读”，什么时候唤醒 Local Main

## 状态是什么

| 状态/界面展示 | 实际含义 | 需要什么 |
| --- | --- | --- |
| `unread` + `to=server-controller` + `wakeAuthorized=false` → **未请求唤醒** | Tips 服务器已收下留言；Local Main 不会自动领取，因为启动 Sol 尚未获授权 | 保持存档，或由拥有相应权限的 Agent 发送 **新的** `wake:true` 消息 |

**新批处理行为：** 当另一条紧急消息已获授权并唤醒 Sol 时，Local Main 在**同一个模型 Turn** 里附带最近至多 12 条普通留言，一并判断优先级、委派 Local Sub、写回真实回执。普通消息仍然不会单独触发模型；被标为 `ack`、`delegated`、`resolved` 的邮件需要实际评估依据；`defer` 仍可保持未读。未处理/遗漏/无有效回执的历史消息原样保留。见 [`skills/main-batch-triage/SKILL.md`](skills/main-batch-triage/SKILL.md)。
| `unread` + `to=server-controller` + `wakeAuthorized=true` → **待 Main 领取** | 授权唤醒请求已经排入 Main 的队列；需要确认服务和重试窗口 | 检查 `tips-server-controller.service`、`attempts`、`retryNotBefore` |
| `unread` + `to=controller` → **旧 Web 未读** | `controller` 是旧版 Web 收件箱，不等于 `web-main`，没有保证持续消费 | 新消息优先发给已认领的 `web-main` 或 `web-air-main` |
| `unread` + `to=web-*` | 目标 Web Chat 尚未 ACK；ChatGPT Web 会话并非常驻 worker | 浏览器里主动 `web_mail(inbox)`；Web Wake 只有在扩展在线且标签页匹配时尝试唤醒 |
| `unread`/`delivered` + `to=sub-*` | App Server Sub 尚未确认；投递并非读取确认 | 检查 `tips-subagent-manager`、目标 Thread 状态 |
| `acknowledged` | 目标已 ACK；还不等于完成 | 等待任务反馈、`resolve` 或 tracked `verify` |
| `resolved` | 已按相应消息流程完成/验收接受 | 查看回执、证据和结果，不自动意味着实验成功 |

## 正确发送方式

非紧急科研状态通告：

```text
web_mail({"action":"send","to":"server-controller","subject":"AIR CPU checkpoint","body":"记录最新 CPU 结果；不请求启动 Sol","tracked":false})
```

这条消息**会留在 Main 邮箱、保持未读**，因为 Local Main 只消费显式授权的 wake。若只是让 Web 主控看到，可改为 `to=web-main`（或具体已认领的 Web Main 身份），由目标 `web_mail(inbox)` 读取；Web Wake 扩展只负责提示而非实际读信。

确实需要稳定自动处理、愿意消耗本地 Sol 额度时：

```text
web_mail({"action":"send","to":"server-controller","subject":"Sol 审查 AIR CPU 因果对照","body":"只检查 CPU-only 证据和因果控制；GPU NO-GO，不得重启 GPU 实验","tracked":true,"wake":true})
```

`tracked:true` 单独**不会**唤醒 Sol。`wake:true` 需要发送工具的可信身份授权；普通 Tips HTTP write Token 不够。任务是否执行还受 STOP、GPU Owner Lock、预注册和其他研究限制。模型可能失败/超时，不能保证 Sol 一定成功。

## Main 回执修复

此前 Main 使用通用 `resolve`，但 tracked 事务不允许普通 resolve（要求接收方 ACK + `verify`），可能在完成 Sol 推理后触发失败或重复重试。现在守护器使用单一内部动作 `finalize_controller`，在已授权且已由 Main `claim` 的消息上**原子完成**：

- tracked 成功：`acknowledged` 事件、`verified_accepted` 事件，状态 `resolved`。它表示通信请求完成，不代表科学结论被证实。
- tracked 过期或门禁拒绝：`acknowledged`、`verified_rejected`，保留原始证据和拒绝原因。
- 普通消息成功：`acknowledged`、`resolved`，不伪造 tracked 验收。
- Sol 真正运行失败：原有 `release` / 重试机制保留，不假装已读取完成。

为了防止自己制造“永久未读”的系统消息，`tips-block-watch` 自动阻塞诊断不再接收无人订阅的普通回复；处理信息保留在触发消息的 audit 和主控任务状态里。其他真实发送方仍会收到回复。

## 操作注意事项

**不要**为了清空面板去 ACK、删除或批量重放历史消息。用户可能已经在另一处完成同一任务，尤其是 GPU NO-GO、Full500 失败、CPU 实验继续推进等重复旧请求。管理员只能基于真实执行记录清理过期注册或归档任务，不能凭 UI“未读”视为有权重启实验。

服务器查看只读状态：`systemctl --user is-active tips-server-controller`；通过 Tips 网页的 `Main 未唤醒` / `Main 待领取` 过滤器排查。变更触发规则需要同时检查 `tips/server-controller.mjs`、`vendor/devspace/dist/tips-core.js` 及其回归测试。
