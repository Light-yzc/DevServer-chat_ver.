# Tips 可按需读取的 Agent Skills

| 名称 | 使用场景 |
| --- | --- |
| `agent-coordination` | Web/Local Main/Sub 协作、Luna 委派与回执 |
| `main-batch-triage` | Local Sol 被紧急消息唤醒，审查积压普通留言 |
| `research-safety` | AIR 实验、GPU/STOP/Owner/预注册、因果核查 |
| `tips-troubleshooting` | 消息未读、Web Wake、Main/Sub 故障与状态解释 |

本目录维护 Skill 原文。Web MCP 可调用 `tips_skills(action="list")` 或 `tips_skills(action="read",name="agent-coordination")`；Local Codex 可从 `$CODEX_HOME/skills/<name>/SKILL.md` 的软链接按需阅读。

首次 Prompt 只需向 Agent 告知有这些 Skill、适用场景和读取方式；**不要每次都注入完整文档，也绝不把任何密钥放在 Skills 内**。
