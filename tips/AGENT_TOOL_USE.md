# DevSpace MCP / Tips 协作工具使用手册

> 适合刚加入项目的 Web Chat、服务器 Main，以及由 `subagent` 启动的 Codex App Server Worker。本文示例均为**工具输入参数**；不是 shell 命令或可直接在研究文件中运行的代码。新 Agent 先辨认自己是哪种身份，再选工具，不要把所有通信都发给 `server-controller`。

**四种身份职责与模型分工**：[`AGENT_ROLES_AND_MODELS.md`](AGENT_ROLES_AND_MODELS.md)。默认 Local Sub `gpt-6-luna` 承担长时间实验和资料整理；困难推理优先用 Web Main/Sub；无人值守、必须稳定决策时才用消耗本地额度的 Local Main `gpt-6.1-sol`。这些是调度偏好，不改变任何审批和实验冻结规则。

**按需 Skill 入口**：使用 MCP 工具 `tips_skills`，先调用 `tips_skills({action:"list"})` 浏览可选文档，必要时 `tips_skills({action:"read",name:"main-batch-triage"})`。服务器 Codex 也可以从 `tips/skills/<name>/SKILL.md` 按需阅读；详见 [`skills/README.md`](skills/README.md)。不用在每次唤醒中把整份手册塞入 Prompt。

## 先选对工具

| 你要做的事 | 使用工具 | 不应该用 |
| --- | --- | --- |
| 查看/更新研究任务、心跳、完成度 | `tips` | `subagent` 不是任务状态数据库 |
| 服务器 Main、未迁移的旧 Worker、普通 Sub 之间留言 | `tips_messages` | 不要冒充 `web-*` 发件人 |
| Web Main 向 App Server Sub 提交可验收的单项请求 | `tips_exchange` | 不等于完成，不是聊天记录同步 |
| 创建、查看、指挥、停止持久 Sub Agent | `subagent` | 不要新建长期 `codex exec` 循环 |
| 新 Web Chat 认领身份 / 以后识别自己 | `web_identity` | 共用 OAuth 不等于共用 Web 身份 |
| 已认领 Web Chat 收发所有方向的消息 | `web_mail` | 不要自填 `from=web-*` 用普通消息工具 |
| 凭管理员密钥撤销/移除 Agent、归档任务、删除留言 | `tips_admin` | 普通查看密钥、OAuth 或 `tips` 任务更新不应当作管理员权限 |

Tips 网页：`/tips`；Agent 总览：`/tips/agents`。面板需要自己的私有读取凭证。Agent 进度和消息由 **Tips 服务器持久保存**，不是自动写进 ChatGPT 聊天记录；已经关闭的 Web Chat **不会自动被后台消息唤醒**。

## 管理员：废弃 Agent 的清理

最小调用：

```text
tips_admin({"action":"revoke_web","id":"web-old","viewToken":"<Tips 查看密钥>","reason":"retired"})
tips_admin({"action":"remove_web","id":"web-old","viewToken":"<Tips 查看密钥>","reason":"retired"})
tips_admin({"action":"stop_sub","id":"sub-old","viewToken":"<Tips 查看密钥>"})
# 先 subagent(status) 确认不再 queued/running/stopping，再调用：
tips_admin({"action":"remove_sub","id":"sub-old","viewToken":"<Tips 查看密钥>"})
tips_admin({"action":"history","viewToken":"<Tips 查看密钥>"})
```

`revoke_web` 只撤销认证、保留角色登记；`remove_web` 将该角色从注册表移除并让此前聊天立即失效，历史 Tips 留言仍在。`remove_sub` 只适用于已结束或已停止的 managed Sub，且会归档旧 Thread 指针，不会杀进程或删除实验成果。`archive_task` 与 `delete_task` 都不允许操作 `running` 任务；后者还会删除 Tips **任务历史**。`delete_message` 不允许删除 `processing` 消息。每次请求必须附带密钥，并记录不含密钥的操作审计。详细的动作矩阵、前端操作、保留策略和权限说明在 [`TIPS_ADMIN.md`](TIPS_ADMIN.md)。

**诊断收件箱“未读”及 `wakeAuthorized` 时，请看 [`MAIN_MAIL_DIAGNOSTICS.md`](MAIN_MAIL_DIAGNOSTICS.md)**。特别注意 `tracked:true` 是验收协议，`wake:true` 才是 Local Sol 的授权唤醒请求。即使发往 `server-controller`，没有 wake 的普通消息也不会自动读取；如果需要 Sol 介入，重新发一条精简、明确授权的新请求，不要无条件重放全部旧邮件。

## 场景 1：新 Web Chat 首次注册，然后联系其他 Web

若某个 Web Chat 已废弃且本人无法再调用 `release`，管理员可以直接调用
`web_identity({"action":"revoke","id":"web-old","viewToken":"<Tips 查看密钥>"})`。
这要求该次工具请求提供密钥，不需要预先 `admin_login`、认领新的 Web 身份或等待审批。密钥保存在服务器私有 `security.json`，在 Git 中忽略；历史 Tips 留言不会被删除。

先调用一次 `web_identity` 的 `whoami`（如果已经认领，直接返回身份）：

```json
{"action":"whoami"}
```

若 `recognized=false`，由已授权的主 Web/控制窗口准备一个槽位：

```text
web_identity({"action":"prepare","id":"web-reviewer-01","label":"Reviewer"})
```

把响应里的**一次性** `invite` 私下交给目标 Chat，目标 Chat 自行执行：

```text
web_identity({"action":"claim","id":"web-reviewer-01","invite":"<一次性邀请码>"})
web_identity({"action":"whoami"})
```

无需主 Web 审批。邀请码 10 分钟后失效、使用一次后不可重用。身份租约持续 7 天，从上次认领或主动 `renew` 开始计算；`whoami` 和读信**不会**自动续期。到期不会删除角色或旧通信，但 `whoami` 将无法继续识别过期身份。若 MCP Host 没有提供稳定 `openai/session`，认领响应中的私有 `claimKey` 必须作为后续调用的 `claimKey` 参数携带（**不要**放在 `body`、文件、公开截图或 Tips 看板里）。

发送与接收：

```text
web_mail({"action":"send","to":"web-main","subject":"Review findings","body":"请看最新 CPU 对照结论"})
web_mail({"action":"inbox"})
web_mail({"action":"ack","id":"<收到的消息 ID>"})
web_mail({"action":"reply","id":"<收到的消息 ID>","body":"已收到，准备复核"})
```

发送方由服务器自动绑定为本聊天的已认领身份。另一个 Web Chat 需要主动调用 `inbox` 才能看到离线时积压的消息。`web_mail({"action":"sent"})` 可查看本人发出的记录。

## 场景 2：Web 主控委派 Sub Agent，并查看结果

```text
subagent({"action":"start","name":"sub-air-cpu-review","model":"gpt-6-luna","cwd":"/your/allowed/research-workspace","sandbox":"read-only","goal":"核对 CPU-only 实验设计，并写出具体证据；不要启动 GPU 或修改冻结结果"})
subagent({"action":"status","name":"sub-air-cpu-review"})

## Local Sub 进度必须同步 Tips

**请求本地 Agent 时，必须让用户能在 `/tips` 追踪进度**：Sub 的 ID `sub-*` 就是对应的 Tips 任务卡 ID。Web Main 与 Local Main 无论通过 `subagent(start)` 还是发给 `sub-*` 的消息指令，都应明确关联此 ID。新任务被接受时自动创建 `pending` 卡；Manager 继续写入运行、心跳、停止、失败和完成状态；Local Sub 需要在实际阶段变化时写入证据、下一步和阻塞原因。

```text
node tips/tips-cli.mjs update sub-air-cpu-review --status running --kind progress --message "已核对数据划分与随机种子，正在对齐 baseline"
node tips/tips-cli.mjs update sub-air-cpu-review --status blocked --kind progress --message "缺少完整原始日志，等待文件补齐"
```

有真实完成数/总数时可以附 `--current N --total M`，否则不要编造百分比。任务卡不是实验成功证明，验证结论仍需实验日志和原始证据。
```

`start` 返回 `accepted:true`、`queued` 只表示**已入队**。等待管理器执行后，再看 `status` 中的 `completed` 和 `lastResult`。已有 `queued/running` Agent 不应重复 `start`；可以通过留言追加要求：

```text
subagent({"action":"message","name":"sub-air-cpu-review","from":"controller","subject":"补充检查","body":"额外核对随机种子"})
```

但是如果你是已经认领的 `web-reviewer-01`，应改用 `web_mail({"action":"send","to":"sub-air-cpu-review",...})`，确保不会冒充其他 Web。

Sub Agent 的**完整 Tips 协议仅在持久 Thread 第一个真实 Turn 注入一次**。运行中可信消息通过 `turn/steer` 尝试转发；空闲时有新的可信消息则由守护器尝试恢复同一 Thread。`delivered` 是服务器已投递，不表示模型阅读；真正 ACK 必须由接收方完成。单轮 `codex exec` 旧 Worker **不具备同等级别的实时收信**；Server Main 仍有独立的唤醒/执行逻辑。

## 场景 3：Web 发起需要正式验收的请求

对于**未以 web-* 身份发件**的旧 Web 控制端，可使用：

```text
tips_exchange({"action":"submit","to":"sub-air-cpu-review","subject":"独立验收 CPU 对照","body":"请检查实验报告是否符合冻结的 preregistration，并给出依据"})
tips_exchange({"action":"get","id":"<submit 返回的消息 ID>"})
```

如果你已认领具体 Web 身份，更适合：

```text
web_mail({"action":"send","to":"sub-air-cpu-review","subject":"独立验收 CPU 对照","body":"请核查实验结果","tracked":true})
web_mail({"action":"get","id":"<send 返回的消息 ID>"})
```

事务流程：`submitted → delivered → acknowledged → reply_received → verified_accepted`。验收状态也可以是 `rejected` 或 `needs_changes`。这些记录在服务器 Tips，不是模型输出就自动认为已验收；`tracked` 消息只能在 ACK 后由接收方 `verify`，不能用普通 `resolve` 伪造完成。

## 场景 4：服务器 Main 与 Sub 通信

普通进度通知（**不**额外唤醒 Sol）：

```json
{"action":"post","from":"sub-air-cpu-review","to":"server-controller","subject":"CPU 进展","body":"检查已完成，结果见报告","priority":"normal"}
```

需要马上召唤 Sol 且来源已经获得授权的紧急问题：

```json
{"action":"post","from":"sub-air-cpu-review","to":"server-controller","subject":"请复核因果对照","body":"技术阻塞，需要 Sol 给出一次审查意见，不修改冻结实验","wake":true}
```

这两段是 `tips_messages` 的参数。`server-controller` 才是 Sol 守护器收件人；历史 `controller` 代表旧 Web 主控收件箱，并不等于已认领的 `web-main`。**没有 `wake:true` 不等于服务异常**，普通消息不会自动启动 Sol。收到消息后应先 `ack`，工作完成再 `resolve`；如任务仍有阻塞，只 ACK 并回复原因。服务器 Main 目前还未迁移为可实时 Steer 的 App Server 主控，不要声称它已在运行中的 Turn 接收新消息。

## 场景 5：任务卡 / 心跳 / 进度展示

```json
{"action":"update","id":"air-cpu-review","title":"AIR CPU review","status":"running","kind":"text","group":"AIR","message":"正在检查数据划分","heartbeatEnabled":true}
```

这是 `tips` 的参数。执行中需要定期 `tips({"action":"heartbeat","id":"air-cpu-review"})`。遇到问题用 `status="blocked"` 并写明技术阻塞；因用户意愿停止时使用 `paused/cancelled`，不能把它当技术阻塞自动重启。`completed` 必须有真实结果依据。`tips` 不会自动执行 Goal，也不会代表你向任何 Agent 发消息。

## 常见错误与排查

| 症状 | 正确判断 / 下一步 |
| --- | --- |
| `whoami` 返回 `recognized:false` | 检查是否已认领，或当前 MCP 会话元数据是否变化；必要时使用私有 `claimKey` |
| `web_mail` 提示身份未识别 | 先 `web_identity(whoami)`；不要直接自填 `from` 规避检查 |
| Sub Agent `start` 返回 `queued` | 不是成功完成，用 `subagent(status)` 读取当前状态及 `lastResult` |
| 普通消息一直 `unread` | 可能只是没有唤醒要求；检查 `to`、授权 `wake`、目标模型/服务状态 |
| 消息状态是 `delivered` | 目标未 ACK，不能说已读或验收；查服务日志/后续重投递 |
| `tracked` 消息不能 `resolve` | 使用接收方 `ack` + `verify(accepted|rejected|needs_changes)` |
| 找不到 `web_identity` 等工具 | 刷新 MCP 插件工具定义，必要时新开一个 ChatGPT 对话 |
| 同时运行多个 Agent | 避免并行争用 GPU、冻结实验、Owner 锁；Sol 需另行评估额度和审批 |

## 文档维护约定

- 新增或更名 MCP action 时同步修改：对应 `vendor/devspace/dist/*-tool.js` / `tips.js` 的 Zod schema、`tips-tool-descriptions.js`（模型可直接见到的帮助）、本手册、`tips/MCP_INSTRUCTIONS.md`。
- Tool `description` 要说清：何时用、首选 action、最小示例、异步/ACK 语义、权限边界、不能做什么。关键参数也用 Zod `.describe()` 写说明。
- 更新并运行 `node --test tips/*.test.mjs`；检查公开看板不包含密钥、会话 claimKey、私有状态文件。文档中的地址、ID、凭证必须使用占位符，不要提交实际邀请码或 token。
- 不因更新工具说明而强制重启正在跑的科研 Main/Sub 或 GPU。MCP Server 的工具定义重载与后台 Agent 进程是两回事。
