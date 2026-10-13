# Web Wake 0.1.8 browser validation

Date: 2026-10-13, Asia/Shanghai. Browser: the user's existing Microsoft Edge
profile and ChatGPT Web. Browser access used the computer-use connector;
no hidden React state, network interception, or private tokens were read.

## Observations used by the idle guard

| Phase | Observed DOM | Decision |
| --- | --- | --- |
| Existing Web Main doing thinking / MCP work | Latest `main [data-turn-key]` contains `[data-talvt-turn-state="in_progress"]`; sidebar current `[role="group"][aria-current="page"]` contains `[role="status"][aria-label="Working"]`; composer Stop present | Busy, no insertion |
| Intermediate assistant prose during that work | Assistant headings/prose already present, but the full turn remains `in_progress`; `[data-markdown-animated]` present | Busy; prose is not a finished turn |
| Independent test immediately after Send | Turn briefly says `complete`, but Stop is already present | Busy; `complete` alone is insufficient |
| Independent Python computation after final response | Latest turn `complete`, no Stop, no current Working, no animated markdown; final response actions present | Eligible only after 20 seconds of quiet |

The independent test asked for two Python calculations of primes below 100000.
It ran analysis and Python and completed. It did not use DevSpace, create any
Agent, edit project files, or add a message to the user's ongoing Web Main.
Only state markers were read on the existing research conversation.

## Recovery check

After reloading the unpacked extension at version 0.1.8 in Edge, the existing
`web-air-main` page was **not reloaded**. Its document root acquired
`data-devspace-wake-version="0.1.8"`, confirming the updated bundled content
script was reinjected into the original document. The popup reconnected and
showed existing pending/submitted/ACK counts and its original conversation pin.
The version attribute is diagnostic only and does not authenticate a Web role.

## Automated adversarial coverage

`content.test.mjs` covers work without Stop, unknown turn state, Working and
streaming flags, quiet-window resets, activity/attachments/navigation/user
edits during the final send check, ACK cancellation, repeated reinjection,
script upgrades, and lost-response deduplication.

`extension-retry.test.mjs` covers queued batches while busy, idle dispatch,
missing/outdated content recovery, sleeping tabs and failed recovery throttling,
ACK during probing, concurrent ACK/new mail during dispatch, exact role/URL/
sender checks, partial confirmed batches, and update-time script restoration.

These simulations do not constitute live observation of every possible
ChatGPT tool transition. No production message was fabricated to force a wake,
and no live approval dialog or browser-discard scenario was forced. If the UI
changes or the latest full turn is not rendered/recognized, the guard waits;
manual inspection may still be required. Server ACK can change after the last
snapshot, so the final check reduces rather than eliminates distributed races.
