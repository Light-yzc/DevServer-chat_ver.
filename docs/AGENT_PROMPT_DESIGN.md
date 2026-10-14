# Multi-Agent Prompt & evidence contract (AIR / DevSpace)

Last reviewed: 2026-10-14. This is an **implementation guide**, not an experimental result or GPU authorization.

## Upstream designs reviewed

| System | Mechanism worth adapting | Primary reference |
| --- | --- | --- |
| SWE-agent | Separate task-specific instance instructions from the system role, attach tool observations to each step, make truncation explicit and retain trajectory / patch evidence | [Default templates](https://github.com/SWE-agent/SWE-agent/blob/main/config/default.yaml), [agent templating](https://github.com/SWE-agent/SWE-agent/blob/main/sweagent/agent/agents.py) |
| OpenHands | Small always-on guidance plus tool-specific and task-triggered skills, separate persistent runtime events from model-authored summaries | [SDK agent source](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/agent/base.py), [skill injection](https://github.com/OpenHands/software-agent-sdk/blob/main/examples/01_standalone_sdk/03_activate_skill.py) |
| Claude Code | Keep project conventions in scoped, on-disk project guidance instead of repeatedly copying a huge prompt; reread current files when state changes | [Project context guidance](https://support.claude.com/en/articles/14553240-give-claude-context-claude-md-and-better-prompts) |
| LangGraph | Supervisor sees an explicit current state, routes work and expects structured completion data rather than interpreting ordinary chat as a transaction | [Supervisor API](https://reference.langchain.com/python/langgraph-supervisor/supervisor/create_supervisor) |

These are **adapted concepts**, not wholesale copies of upstream prompts. Each referenced system has its own runtime assumptions; using its prompt alone would not make DevSpace reliable.

## Prompt layering

1. **Persistent policy (small, once per Thread)** — identity, tool/messaging contract, STOP/GPU/Owner rules, evidence-vs-claim distinction. `tips/subagent-protocol.mjs` provides this to a new managed Sub Thread.
2. **Dynamic current-state context (every resumed Turn)** — current Git HEAD and document modification state, fresh task and Owner board digest, trusted pending mail, current role, exact job. `tips/app-agent.mjs`, `tips/document-freshness.mjs`, and `tips/research-loop-prompt.mjs` provide these. **Prior Thread memory is a hypothesis, not the source of truth.**
3. **Task-specific instruction (per Job)** — measurable goal, allowed resources, checked input files, expected artifact/test and STOP boundaries. This is the queued Job's `.goal.txt`, not a generic autonomous “continue research” command.
4. **Final structured output** — `<sub-report>` (what changed, tests actually run, blockers, evidence paths, documentation action, next Owner/action), followed by the existing `<tips-actions>` (ACK, tracked verdict, progress and replies). Missing fields remain unknown; tests in `<sub-report>` are self-reported until Main verifies logs.

## Never trust an old README merely because the Sub read it once

At the beginning of every Turn, recheck on-disk instructions, Git HEAD and relevant documents. `tips/document-freshness.mjs` records document modification metadata and last committed time and supplies a bounded reminder. It **never** pulls, overwrites or edits files automatically. At completion, the Manager compares observed file modification metadata against the start-of-Turn snapshot and records a documentation review state per Job. Changed code plus unchanged docs triggers `needs_documentation_review`. This is a review signal, **not proof that a particular document is wrong**, and shared workspace changes cannot be attributed to one Agent.

When implementation/experiment logic changes, either update the appropriate editable README/current-status/plan *in the same task*, or give a concrete reason that no documentation applies. Do not touch sealed scientific records or copy old numbers into a current document without verifying their source. The structured report lists updated doc paths and a `notNeededReason` alternative; claimed paths are compared against observed file changes.

## Main's acceptance checklist

1. Verify **current** Job ID, active Owner and resource gates from registry/Tips. ACKs and completed processes are not scientific acceptance.
2. Read `subagent(action="jobs",name="sub-...")` and the job's `handoff`, then `diff`, `events`, `log`, `result` only if necessary. The local equivalent is `node tips/subagent-cli.mjs handoff|diff|... NAME --job ID`.
3. Confirm actual changed files and tests. A shared checkout's Git patch is an **unattributed workspace observation**, and an Agent's verbal claims do not establish test execution. Isolated Git worktrees can be introduced as an **explicit per-job migration** only after resolving data/GPU paths; they are not silently created for existing research.
4. Check `documentation.status`, actual changed docs, false update claims and unresolved drift. Arrange correction or record a justified docs-not-needed decision. Do not approve stale docs on the basis of an Agent summary.
5. Decide accepted / needs changes / blocked based on objective acceptance tests. Persist next Owner, precise follow-up, evidence paths and trigger. Avoid duplicate Sol wakes and duplicate GPU work.

## Reliability and security boundaries

- The Manager emits one **job-specific** handoff message to Local Main, with no duplicate for the same Job ID, and to a recognized Web delegator when available. Multiple genuine completions may accumulate, but pending routine handoffs are coalesced rather than repeatedly waking Sol.
- Reconciliation after a Manager restart checks saved handoffs for missed notifications; it never executes a model or approves a gated experiment.
- Evidence reads use validated Agent/Job IDs, bounded excerpts and basic secret-line redaction; **do not treat this as a complete DLP system**. Logs/patches may contain previously unknown private data. Private files remain under Tips state and the HTTP evidence API requires the Tips view credential. Do not paste raw reports, Tokens or dataset secrets into messages, commits or public logs.
- Local Main and Luna running under the same Unix user do not have a strict OS security boundary. Full-access sandbox is a tool permission, not an authorization to bypass STOP, GPU ownership, frozen files or registration checks.
- Source-of-truth order: **live processes / explicit safety gates → actual files, code and artifacts → Git history, Diff, document modification state and tool outputs → Tips task records → Agent self-report → historical Thread memories.**

## Minimal role-specific guidance

**Local Sub (Luna):** Reconcile current task and docs before work; do a bounded change/test; keep proof; update relevant docs or explain why not; end with a structured report and real ACKs. Do not spend a model Turn solely on a routine progress ping.

**Local Main (Sol):** Read job-specific evidence before judging a Sub; select only the next safe milestone; delegate low-cost execution; use independent review for difficult scientific claims; batch routine messages and do not rerun failed jobs without diagnosis.

**Web Main/Sub:** Independently assess artifacts, frozen baselines, design/causal validity and acceptance conditions; do not accept an unverified self-report; on natural completion perform one bounded inbox recheck and ACK only actual handled mail. Offline Web Chats cannot be forced awake by prompting.

## Remaining design tradeoff

True per-Agent authored diffs require **isolated Worktrees or file-operation provenance**. The current observational snapshots intentionally do not claim authorship. The system also does not autonomously repair a stale document: it creates evidence and a review gate so the responsible Owner can update it without silently rewriting approved scientific records.
