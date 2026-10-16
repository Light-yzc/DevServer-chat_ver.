# Web Wake：等待当前 Web Turn，完成后再提醒

Updated 2026-10-16. Implemented in extension source **0.1.9**. Existing server
Tips task cards were not edited, and no research Agent or GPU work was started.

- [x] Inspect actual Edge DOM during Web Main thinking/MCP work and intermediate
  prose; independently trigger a Python computation to observe start/completion.
- [x] Require explicit full-turn completion plus Stop/Working/streaming checks.
  Unknown layouts stay queued. Add a 20-second quiet window and mutation tracking.
- [x] Recheck activity, drafts, attachments, navigation and the latest local
  pending/ACK state immediately before Send; preserve user edits.
- [x] Serialize snapshot/submission updates; ACK arriving during probing cancels
  dispatch, and ACK/new mail arriving during submission cannot be overwritten.
- [x] Keep one confirmed submission per ID; pending batches wait while Web works
  and remain eligible once genuinely idle. Do not infer ACK from disappearance.
- [x] Update the compact wake prompt to read unread mail, execute authorized work,
  ACK/reply/advance progress as needed, and perform one bounded final inbox check.
- [x] Recover missing/outdated content scripts via idempotent reinjection;
  throttle failed recovery and wait for sleeping/loading tabs.
- [x] Verify in actual Edge that extension reload restores the script in the
  existing Web Main document without a ChatGPT page refresh.
- [x] Automated busy-gap, pre-click activity, ACK race, batching and recovery tests.
- [x] Bounded ACK-timeout recovery: after 30 minutes of both no ACK and no
  visible Web activity, submit a separately labeled reminder; permit one more
  after two hours, then stop. Durable per-ID counts; never turn retry into
  MCP ACK, job restart, STOP override, or Local Sol wake. Snapshot/ACK races,
  busy/draft/binding gates, group batching and two-retry cap covered by tests.
- [ ] Manual browser acceptance of the 30-minute retry in the user's actual
  open Edge/Chrome chat after updating the locally loaded extension.
- [ ] Extended live acceptance for every tool/approval transition, transient
  removal of all busy indicators, and browser-discard recovery. Unit simulations
  cover the guards; this checklist does not claim these live cases were forced.

See [BROWSER_VALIDATION.md](BROWSER_VALIDATION.md) for observations and limits.
Updates require reloading the existing local unpacked extension. Normal script
recovery no longer requires refreshing a ChatGPT page. No server restart is
needed for these extension-only behavior changes.
