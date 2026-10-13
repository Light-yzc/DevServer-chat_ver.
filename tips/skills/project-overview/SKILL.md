---
name: project-overview
description: Read when starting a long-running research project, reviewing AIR-wide progress, changing task ownership, or retiring old tasks. Read/create rights differ from manager edit/archive/delete permissions.
---

# AIR 项目 Overview · 统一任务生命周期

这个 Overview 是 **现有 Tips 任务记录的投影视图**，而非第二套待办库。旧的 `AIR-LIFE`、`AIR / Paper`、`AIR-Research`、`AIR / Other` 归于 AIR 总项目；Tips、基础设施任务归于 Infrastructure。所有具体任务还保留原 `id`、分组、历史和证据。

**开始科研调度时（Web Main/Sub）**：先调用 `tips_project({"action":"overview"})`，看当前待办、阻塞、失败、Owner 缺失、下一步缺失和工作流；再按需 `tips_project({"action":"get","id":"..."})` 查看完整记录。不要把旧 `running` 当成真实活跃进程，需核对 Agent Registry、当前实验文件、门禁与最新日志。

**普通 Agent**：`tips_project(create,id,projectId,title,message,nextAction?,acceptanceCriteria?,priority?)` 只能新增 ID，不可覆盖现有项目计划。执行中的自己可用 `tips(update)` 发阶段进度与证据，但不要擅改 Owner、优先级、项目归属或删除任务。项目起草任务要写明确验收条件，避免“继续研究”这类无法执行的待办。

Local Luna 没有 MCP 工具时，可在服务器仓库中执行 `node tips/project-cli.mjs overview`、`node tips/project-cli.mjs get TASK_ID`；新增通过 stdin JSON：`printf '%s' '{"id":"air-cpu-qa","projectId":"air","title":"CPU audit","message":"Pending evidence"}' | node tips/project-cli.mjs create`。此 CLI **只开放读/新增**，不能直接传入管理员字段修改现有任务。

**Web Main（已认领 Web 身份）**：`tips_project(edit,id,owner?,nextAction?,acceptanceCriteria?,priority?,status?,gate?,expectedUpdatedAt?)` 进行项目级整理；角色以真实 `web_identity` 绑定判断，不能只填 `from:web-main`。删除前先 `archive`，并且不得删除运行中的任务。`viewToken` 是既有 Tips 查看/管理密钥，不是新建的密码；不要复制到消息正文。Local Sol 的受信服务器环境可管理，但同 Unix 用户下不同 Luna/ Sol 的 OS 权限并未完全隔离。

**归档策略**：已验证完成的结果保留证据并移出默认活跃队列；已失效、重复的卡片先写明替代任务 ID，再归档；**物理删除仅限归档过的非运行任务**，会记审计。不要为清理 UI 而删除真实实验、Git commit、封存结果或 Owner 上锁任务。

**结束科研 Turn**：必须明确哪张任务卡发生了变化、具体 Owner、当前证据、下一可执行动作、验收标准和真正的下一触发事件。Tips 项目计划不等于解除 `dispatch_hold`、STOP、GPU NO-GO 或 preregistration。没有权限继续就给出阻塞原因，安排剩余允许的 CPU/文献/脚本审查。
