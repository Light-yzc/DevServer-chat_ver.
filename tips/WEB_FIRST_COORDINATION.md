# Web Main 优先的 AIR 协调模式

更新：2026-10-16。此模式不撤销任何 STOP、GPU/Owner 门禁；当前用户已明确要求停止所有实验，**此刻只允许检查、修复协调基础设施，不能据此恢复实验**。

## 三个角色，只有一个研究决策 Owner

1. **Web Main**：科研方案、优先级、验收标准、具体任务授权、异常升级、下一 Owner。直接调用 `subagent(action="start", name="sub-...", goal="明确范围/测试/产物")` 管理 Luna；结束时记录 Job ID，不重复派发同一工作。检查 `jobs`、`handoff`，必要时读 `diff/log/events/documentation`。Web Wake 在空闲的绑定页面提醒新结果；没有浏览器时不能假定 Web 会自动运行。
2. **Subagent Manager + Luna**：纯执行、并发控制、持久报告和原 Web Owner 通知。Web 委派的 Sub 成功/失败后**只回 Web**；未经 Web 认领的旧 AIR 工作保留一份不唤醒模型的 Local Sol 记录。Luna 在明确授权且未被 STOP 覆盖的 CPU/代码修复范围内可做最多 3 次 edit→test→fix，无需每轮请示；更换数据范围、实验方案、GPU、冻结产物必须停下重新请求许可。
3. **Local Sol**：按需异常专家/离线兜底，**不再是所有完成事件的第二个必经研究负责人**。自动技术阻塞唤醒和 Web 超时后 Sol 接管默认关闭；只有运维明确开启环境参数 `TIPS_ENABLE_AUTO_BLOCK_WAKE=1` 或 `TIPS_ENABLE_LOCAL_SOL_FALLBACK=1` 才可能恢复旧路径，仍须遵循独立安全门禁。普通完成、Web 超时或收到 ACK 不授权启动 GPU。

## 开始一个新 Web 协调 Turn

先 `web_identity(action="whoami")`，`tips_project(action="overview")`，再通过 DevSpace **只读**查询：

```bash
node /mnt/disk1/yangzhongcheng/tips/coordination-audit-cli.mjs
```

它比较 Tips 任务卡与实际托管 Sub Job 注册表，报告 `mismatched`、`stale`、`unassigned`、`stopSignals`；**不会自行修改任务卡、启动实验或解除 STOP**。对于 `sub-*` 任务卡仍 `running` 但注册表终止的情况，查具体 Job 后再更正卡片。非 Sub 的研究进程必须检查实际 PID、GPU、锁及独立实验记录；时间戳过期不能证明进程已停止。历史任务缺 Owner/下一动作应分批人工归档或补齐，不可批量伪造负责人。

只有满足真实授权与依赖时才下发下一项有明确目标的工作；Local Sol/Manager 当前停止时**不能**把 queued 当成实际执行，不能为求自动推进擅自启动服务。Web 想监控自己启动的普通 Shell/Python 后台任务，可用 `web-job-cli.mjs`（参见 [`WEB_JOB_TRIGGER.md`](WEB_JOB_TRIGGER.md)），完成/失败后原 Web 身份会收到 Tips 提醒。

## 什么时候升级审查

- **不必每轮审查**：同一个 Owner 明确批准的代码 Bugfix、文档、普通非实验性 CPU 测试；在原输入、资源上限与验收目标内直接迭代。
- **必须审查或 STOP**：用户新暂停/撤销授权、科研实验执行、GPU 准入变化、冻存输出、共享所有权冲突、超出原始数据/方案范围、反复失败且触发熔断。
- **验收不是回复**：Sub `exit=0` 和 Tips `ACK` 只证明进程/通信成功，不等于科研结论成立。Main 以实际测试、运行凭证、代码与当前门禁验收。出现阻塞时明确阻塞原因和决策 Owner，不再要求 Sol 和 Web 按顺序重复批准同一 CPU 修复。

## 对现有系统的影响

未修改科研 STOP、GPU 门禁、Agent sandbox 和数据；没有自动下发旧任务。已经排队但未执行的任务在 Manager 重新启动前仍须由用户/Owner 按最新 STOP 重新核实。旧的 Web handoff fallback 仍可通过运维选项开启，但默认不自动派 Sol；Web ACK 后仅恢复先前因超时标记 blocked 的 handoff，不能解除真实科研阻塞。
