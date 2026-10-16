---
name: agent-coordination
description: Read before coordinating AIR Web/Main and Local/Sub agents, assigning Luna workers, or using Tips ACK/verify and delegation.
---

# AIR Agent 调度与通信

## 四类职责

- **Web Main**：`web-main`, `web-*-main`。高难度推理、路线选择、总审查；不消耗服务器本地 Sol 额度，但需要活跃 Web Chat。
- **Web Sub**：其他 `web-*`。独立审稿、交叉验证，需通过 `web_identity` 认领。
- **Local Main**：`server-controller`, `gpt-6.1-sol`。**按需异常评审和离线兜底**，不再是 Web Main 已授权的每轮 CPU 修复、普通 Sub 完成交接的强制第二审批。Web 是唯一研究决策 Owner；Sol 只有明确需要异常诊断/独立深审时才应调用，恢复任何实验之前必须重新核对 STOP。
- **Web-first 与状态诊断**：Web Main 使用 `subagent(start/jobs/handoff)` 直接管理所委派的 Luna，任务起始先运行 `node /mnt/disk1/yangzhongcheng/tips/coordination-audit-cli.mjs` 只读核实注册表与 Tips 的不一致；`running` 卡片不一定对应活进程。正常完成只回传原 Web Owner，旧无 Owner 的 AIR 任务仅给 Local Sol 被动留档。Local 自动 blocker wake / Web 超时接管默认关闭；详见 `tips/WEB_FIRST_COORDINATION.md`。**用户已要求停止全部实验，不能因协作重构自行恢复执行。**
- **Local Sub**：`sub-*`, 默认 `gpt-6-luna`。持久 Codex App Server，低成本长期执行。高难度需要时再调用 Sol。

**注册数 ≠ 并行数**：最多保留 128 个不同持久 Local Sub 身份；Manager 默认同时运行 2 个，最多 4 个。尽量复用已完成且配置一致的 Thread，不要为同一工作无节制创建新身份。超出注册上限才考虑按安全手续退休，不得未经核对丢失实验上下文。

Main/Sub 是职责而非管理员权限；`controller` 是旧 Web 邮箱，不等于任何当前的 Main 身份。

## 工具和协议

- `web_mail`：已认领 Web Chat 发/收消息；`tips_messages`：Local 普通消息；`tips_exchange`：旧 Web 控制端向 Local Sub 的可验收事务。
- **Web 自己的长期脚本（不是 Luna/Subagent）**：当 Web Main/Sub 经 DevSpace 启动一个已获资源授权、非交互的 Python/Shell 后台命令，并希望完成或失败后收到提醒继续推进，优先使用 `node /mnt/disk1/yangzhongcheng/tips/web-job-cli.mjs start --to <本会话 web_identity(whoami).id> --id webjob-稳定ID --title "说明" --cwd /绝对路径 -- executable args...`。Worker 退出时经现有 Tips 给同一 Web 身份发信，已有 Web Wake 扩展负责空闲时提醒；失败和终态必须先检查日志/产物，不能直接重试 GPU。`status JOB_ID` 可核对，`reconcile` 定时补发。**不新建 Sub Agent、不改扩展、不把通知当成科研验收**。完整流程参见 [`tips/WEB_JOB_TRIGGER.md`](../../WEB_JOB_TRIGGER.md)。
- `tracked:true` 表示 ACK + verify，并非科研成果验收。可信消息发往 `server-controller` 默认请求唤醒，但普通消息延迟 10 分钟归并；`priority:high`/安全门禁即时唤醒，`wake:false` 显式留档；Local Sub 回 Local Main 的回复也应携带可信唤醒。
- Local Main 可用 `node tips/subagent-cli.mjs list/status/start/message/stop`。尽量委派 Luna，并在真实下发给 Sub 的指令中记录原始消息 ID、Owner、目标、证据和禁止操作。
- **接收 Sub 完成回执后先验收，再派工**：`node tips/subagent-cli.mjs jobs sub-NAME` 查历史 Job；`handoff sub-NAME --job UUID` 得到本轮结构化报告，再按需读取 `diff/result/events/log/documentation`。Web Main 可用 `subagent(action="handoff", name="sub-NAME", jobId="UUID")` 等只读动作。共享工作区 Diff **不能归因到单个 Sub**；模型自报测试通过未经独立证明。若 `documentation.status` 显示待复核或代码变更与文档未同步，优先核查真实文件并安排 Owner 更新，不要使用旧 Thread 里复制的说明。详情见 `docs/AGENT_PROMPT_DESIGN.md`。
- **旧 Sub 身份清理（仅收到 Owner 明确要求时）**：本地 Main 可用 `node tips/subagent-retire-cli.mjs candidates` 只读列候选；已空闲至少 14 天、注册状态终止、任务卡终止、无未读信、无未完成任务依赖/Owner 引用且无打开的失败熔断时，才可按具体 ID 用 `retire sub-NAME --confirm sub-NAME --reason "..."` 审计退休。脚本内部读取服务端现有管理凭证，不在 Prompt/日志回显；不停止进程、不删除 Tips 消息/历史/科学数据。同一 Linux 用户的 Luna **没有严格 OS 隔离**，不可把本地 CLI 视为管理员级身份沙箱。详情见 `tips/TIPS_ADMIN.md`。
- **Local Sol 也负责向 Web 请求唤醒和审查**：对需要 Web 高级推理的任务，调用 `tips/web-handoff.mjs request` 将 `server-controller → web-air-main` 的追踪消息与 Tips 进度卡一起创建。Web Wake 会向在线且匹配的浏览器会话发出提示，**不是无条件唤醒云端**；Web 未在 45 分钟内 ACK，轻量 watchdog 会向 Sol 发一次后备协调请求，安排 Luna 或继续等待，不盲目重跑 GPU。完整操作见 `tips/WEB_HANDOFF.md`。
- 委派 `sub-*` 时必须让 Tips 任务板显示进度：`subagent(start)` 立即创建同名任务卡；消息任务也自动关联同名卡。Local Sub 在真实阶段或阻塞时用 `tips-cli update <sub-id>` 填写阶段与验证证据。用户应能只看 `/tips` 而无需 SSH；无可量化总量时不要猜百分比。
- 为省 Token，Local Sub 还可在已有最终 `<tips-actions>` JSON 中增加 `progress:{status,message,current?,total?}`，与 ACK / 消息一起写回同一任务卡，**不增加新模型调用**。执行中由 App Server 事件和 Manager 心跳更新阶段与存活状态。

## 长期稳定与成本优先级

先复用已有 Agent 与 Codex Thread；Local Luna 承担可持续的实验、资料与自动化执行；高难度推理优先向已认领 Web Main/Sub 委派、由浏览器在线时读取，Web 不保证无人值守；当无人值守必须立即决策且符合门禁时，使用 Local Sol Main。可信消息默认唤醒 Main，积压消息尽量在同一轮合并，不为无变化的状态反复消耗 Sol。每项工作保留 Tips 阶段证据、失败原因、可恢复检查点、下一负责人和触发事件。严禁盲目轮询、重复实验、伪造比例。
- 四角色的具体科研推进契约与最终交接字段见 [`tips/RESEARCH_LOOP.md`](../../RESEARCH_LOOP.md)。每轮至少辨认一项有证据的下一步或明确客观阻塞条件；不要只汇报“已读”“等待”。
- `delivered` 不表示接收方读过；所有完成声明需要有回执和实际证据。
- **Web Main/Sub 的收尾约束**：原任务处理完成后、最终结束本 Turn 前，再调用一次本身份的 `web_mail(action="inbox")`；如有新信，先处理在现有授权与 STOP/GPU 门禁内可执行的事项，并根据真实结果 ACK、回复或派发。不能完成的清楚标记阻塞与下一 Owner/触发，不能假称已处理。检查有界、避免新信风暴造成无限自循环；浏览器是否已提交提醒不代表收到 ACK。

## 委派前检查

1. 查看已有 Agent、Owner 和正在执行的 GPU/CPU 任务，避免重复跑。
2. 核对 STOP、GPU NO-GO 和用户预注册/验收限制。
3. 写清任务、输入、产物、允许的资源、验证步骤。跟进 ACK 和结果，不要把发送指令当作任务成功。

更多：`tips/AGENT_ROLES_AND_MODELS.md`、`tips/AGENT_TOOL_USE.md`、`tips/SUBAGENTS.md`、`tips/MCP_INSTRUCTIONS.md`、`tips/skills/main-batch-triage/SKILL.md`。
