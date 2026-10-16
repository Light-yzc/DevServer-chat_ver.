# Web Chat 自己的后台任务：完成 / 报错后唤醒原 Web Chat

**不是 Subagent、不是定时重启 Web Chat，也不修改 Web Wake 浏览器扩展。**

场景：已认领 `web-air-main` 的 ChatGPT Web 会话，在 DevSpace 服务器上启动一条无需持续交互的长期 CPU/GPU（**必须先有真实资源授权**）命令，然后结束当前 Web Turn。后台命令成功或失败后，服务器的本地监护进程向 `web-air-main` 的 **Tips 邮箱**写一封终态消息。现有 Web Wake Relay 和浏览器扩展会在这段聊天处于可投递状态时提交简短查信提醒。Web 接着调用 `web_mail(inbox)`，核实记录、ACK 并决定是否继续推进。

```text
Web Chat (DevSpace.exec_command / bash)
    -> node tips/web-job-cli.mjs start ... -- executable args...
         -> detached worker -> normal shell/Python process
              -> finish 0 / finish != 0 / failed to start
              -> private log + terminal receipt
              -> trusted Tips message to *the same claimed web-* identity
         -> Web Wake Relay -> existing browser extension (unchanged)
              -> idle, bound chat -> reminder to web_mail(inbox)
              -> Web verifies result and research gates; continues once
```

## Web Agent 使用方法

**每次先调用 `web_identity(action="whoami")`**。只有 `recognized=true`、已认领且租约有效的身份才能作为 `--to`，**不要从历史聊天或任务名称猜 ID**。示例为 Web 通过 DevSpace 服务器的 `exec_command` 执行：

```bash
cd /mnt/disk1/yangzhongcheng/devspace-tips-mcp
node tips/web-job-cli.mjs start \
  --to web-air-main \
  --id webjob-air-cpu-qa-v1 \
  --title 'AIR CPU-only QA' \
  --cwd /mnt/disk1/yangzhongcheng/new_doc/air_ver1 \
  --timeout-sec 7200 \
  -- python3 -u scripts/cpu_only_qa.py

# 启动命令立即返回 JSON：id、workerPid、status、log。
node tips/web-job-cli.mjs status webjob-air-cpu-qa-v1
```

`--` 之后是**真实可执行程序及原样参数**，没有隐藏的 shell 解析；要用 Shell 管道时需明确写 `-- bash -lc '...'`。不允许让外部 Tips 消息直接决定要执行的 Shell 指令。使用稳定 `--id` 避免因 Web 调用超时而启动两遍；重复使用相同 ID 和参数只返回旧 Job，改变参数则拒绝。

**推荐 Web 使用规则**：

1. 只对**已经授权、无需持续交互**的长计算/文件处理启用；纯几秒钟命令直接同步执行即可。不将 Web 聊天、Subagent、科研验收或硬件 GPU 准入交给包装器。
2. 启动前确认当前工作目录、活动 Owner、STOP / `dispatch_hold`、资源锁、既有同类运行任务和输出文件路径。给 Job 一个明确的、可核对的验收目标；`--id` 建议同时记入已有 Tips 任务卡。
3. 命令成功提交后不需要 Web 轮询。收到 `[Web background completed]` 或 `[Web background failed]` 后，先 `web_mail(inbox)` 再到服务器执行 `status JOB_ID`、检查原始日志和输出；实际 ACK，谨慎决定是否再派发。**退出码 0 不是论文结果通过。**
4. 如果任务运行中遇到系统崩溃，恢复检查可以将监护进程丢失标记为 `lost`（实际计算结果 **unknown**），通知 Web 人工核对；**绝不因为失败通知就直接重跑 GPU**。
5. 任务用普通 Linux 进程，不创建持久 Luna/Subagent、不消耗 Local Sol 推理额度；网络/浏览器关闭会影响 Web 的提醒，但 Tips 信件和结果保留。

## 服务端补发与排障

```bash
node tips/web-job-cli.mjs status webjob-air-cpu-qa-v1
node tips/web-job-cli.mjs reconcile
```

后台 Worker 使用 Tips 现有**可信本地消息 API**写信，地址为启动时指定且校验过的 `web-*`；`from=tips-web-job-trigger`，并使用 `dedupeKey` 防止重复发信。状态和完整命令只存储在私有 `${stateDir}/tips/web-jobs/JOB_ID/`，权限为目录 `0700`、文件 `0600`；Tips 信件只包含 ID、标题、退出状态、时间及日志位置，**不包含命令参数、环境变量和日志正文**。无需给浏览器扩展或 Web Chat 增添管理员凭证。

`reconcile` 是无模型、幂等的轻量后台检查，应交给 systemd 用户 Timer 每分钟调用一次：扫描已有 Job 的终态消息是否已送达；若监护 PID 不在且没有结果，则报告 `lost`，**而不是假定任务失败或成功**。此机制不能提供计算进程级容灾，也不会接管孤儿 GPU 进程。服务定义模板：`tips/systemd/tips-web-job-reconcile.{service,timer}`。

**触发限制**：这是现有浏览器扩展的 UI 自动化，并非 ChatGPT 官方后台 Web 会话唤醒 API。需要扩展启用、Web 身份有效、匹配的聊天标签页存在且空闲。扩展成功提交只意味着 `submitted`，只有 Web MCP 的 ACK 才是真正读信；已提交但未 ACK 的同一邮件不会反复注入，以防重复启动工作。
