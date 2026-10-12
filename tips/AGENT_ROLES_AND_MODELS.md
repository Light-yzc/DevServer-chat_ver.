# AIR 四类 Agent：职责、模型和调用边界

这里的 **Web / Local** 指运行载体，**Main / Sub** 指研究协作职责；不是管理员权限等级，也不是同一个会话可以自动操控另一会话的证明。跨端消息存在 Tips 私有服务器里。

| 身份 | 示例注册 ID | 运行载体 | 模型与资源策略 | 负责什么 | 如何唤醒 / 连续运行 |
| --- | --- | --- | --- | --- | --- |
| **Web Main** | `web-main`, `web-air-main` | ChatGPT Web 中独立认领的会话 | 高难度推理、策略审查；**不消耗服务器本地 Sol 额度**，仍可能受 ChatGPT 产品限制 | 全局路线、审核因果设计、拆任务与验收 | 人工交互；Web Wake 扩展可尝试向已打开且匹配的聊天自动提交收件提醒，不是云端常驻进程 |
| **Web Sub** | `web-reviewer-01`, `web-test_1` | 另一独立 ChatGPT Web 会话 | 复杂交叉审查、独立读论文和分析 | 受委派的一次性审稿/复核，不是本地后台 Worker | 同样经 `web_identity` 认领和 `web_mail` 收发；身份绑定不代表当前在线 |
| **Local Main** | `server-controller` | systemd 的独立本地 Codex 主控服务 | `gpt-6.1-sol`：关键问题推理强、稳定自动调用，**消耗本地 Sol 额度** | 处理可信唤醒、困难决策、指导 Local Sub | 守护器按授权 `wake:true` 调度独立持久会话；与任何 Web Chat 不共享上下文或身份 |
| **Local Sub** | `sub-air-cpu-review` | Codex App Server + Subagent Manager | `gpt-6-luna` 默认：低成本、可执行持续一整天的长 Goal（受服务器与模型实际限制） | 实验执行、日志整理、批量验证、反复迭代 | `subagent(start)` 创建持久 Thread；Manager 队列、`message` 可唤醒空闲 Thread / steer 运行中 Turn |

## 建议调度

1. **耗时长、机械执行、批量实验或整理**：默认 Local Sub / Luna，保存进度、报告检查点与失败原因，不必每一步耗费 Sol。
2. **难度高、依赖高级推理的设计或验收**：优先询问 Web Main / Web Sub，独立审阅因果对照、模型改型、异常结论；其能力受 Web 会话实际可用模型及额度约束。
3. **无人值守且必须稳定推进的关键复杂决策**：用 Local Main / Sol，控制唤醒频率、成本，严格留下证据、审计和可恢复状态。
4. **审稿或因果设计疑点**：可以由 Web 先评，再由 Local Sol 复核；不要把 Luna 的单次意见当成最终学术结论。
5. **Agent 职责 ≠ 特权**：Web Main 也不能没有 `webAdminKey` 就注销别人的注册；Local Main 和 Local Sub 不因名称或模型强弱而取得 Tips Admin 权限。

## 注册与页面归类

- Tips `Agent Registry` 页面有 **Web Main / Web Sub / Local Main / Local Sub** 四个分组与筛选器；另列 `Legacy/tmux`（只是系统观察到的进程）和 `研究任务`（不是 Agent）。
- Web 是身份注册表：`web-main` 和符合 `web-*-main` 命名约定的归 Web Main，其余 `web-*` 归 Web Sub。这个归类由 **ID 命名推断职责**，不授予权限。真正身份仍由 `whoami`/`claimKey` 验证。
- Local Main 是单一 `server-controller` 服务；Local Sub 来自 `subagents/registry.json` 的 `sub-*` Codex App Server 注册表。运行中状态只能由真实管理器/进程确认；Tips 任务卡不是启动凭证。
- `controller` 是**历史 Web 控制端收件箱**，不等于 `web-main`；为防消息路由混乱，优先将 Web↔Agent 消息通过已认领会话的 `web_mail` 发送。
- Web Wake 只是**浏览器扩展中转**，不能无条件唤醒关闭或未登录的云端聊天。若需跨时段自动推进，仍应让 Local Agent 持久执行。

## 安全与实验约束

所有 Agent 受项目现有 STOP、GPU 冻结、Owner 锁、实验预注册、审查和模型预算规则约束。长期运行意味着**可以保持持久任务和检查点**，不是承诺某次模型 Turn 能无限运行；超过超时须由 Local Agent Manager 重新调度或用户恢复。删除管理走 `tips_admin`，见 [`TIPS_ADMIN.md`](TIPS_ADMIN.md)。
