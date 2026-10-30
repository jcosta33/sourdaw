# Lesson library: startup entry availability

## 2026-10-29 — editor reconnect replaced an acceptance document after entry began

Commit `0ef2e91d94` introduced Playwright's `pnpm dev` server; PR #5363 retained a dev
companion for source-importing cases, and #5738 routed both dev modes through the observed
wrapper. Vite 8.3.5, pinned by #5748, still reloads after a socket disconnect even with
`server.hmr: false`. The initial transport fault in #5595 is unproved; historical private
review prompts and tiers are unavailable. The missing probe was document replacement by
the editor transport after the application entry had begun, beyond entry-only recovery.

Hold a real dynamic App module while the owned HTTP server stays healthy. Await both server
and browser socket readiness, terminate only that socket, then require the immutable E2E
document's original time origin, one document request, actual App/CSS fulfillment and no
console or page errors. Keep ordinary developer reconnect reload as a positive control.
An automatic reload outside application recovery still crosses the document-state boundary;
do not infer saved-project or Undo preservation from this tiny transport fixture.

## 2026-10-28 — the entry could fail before recovery code existed

Commit `33158adccb2b0ed6a461fee10dde79c83c2b2fcf` introduced an empty HTML root and an
external module entry without independent failure handling. No associated introducing PR or
historical private review prompt or tier is established. The missing unavailable-entry probe
allowed a blank startup; the initiating transport failure in #5595 remains unproved.

Abort the actual entry URL derived from served HTML before its body executes. Require an
independent readable fallback and, when automatic recovery is offered, one real document
navigation followed by unconditional application readiness. Hold a speculative request until
its script element is parsed: raw request counts alone can mistake a parser refetch for recovery.
Prove the generated entry identity and controller ordering in both source and built HTML under
the unchanged production CSP. If the independent controller fails or stays pending, native browser
Reload instructions must remain visible without a misleading inactive button. Hold its download
while the parsed entry's real network request fails, then release it and require recovery through
a changed document lifetime; parser availability must not sacrifice resource-error ordering.

Require a persistent failure to stop at an accessible manual Reload surface, preserving the full
URL. Unrelated resource errors must not spend the retry budget. Mark entry-body start before
composition or application effects; afterward, even an entry-targeted error must neither navigate
nor replace a live app. A missing capability marker cannot prove that parallel startup is inactive.
Exercise host and child separately: only the failed document may reload, while one shared per-tab
budget survives successful entry execution. Unavailable, unwritable or corrupt retry storage
requires manual recovery. Keep real same-project saved state and future Undo preservation as a
separate integration obligation whenever recovery navigates.

### 2026-10-30 — the initial App import could reject after first paint (introduced by PR #3356)

PR #3356 (`26c6a7fe7d3374572f42510ac9accf8ff293a420`) changed the initial App import to a
fulfillment-only continuation after `ApplicationFirstPaint`; the introduced code has no rejection
handler for that actual initial App graph. Its public approval names a hung import and first-paint
marker removal, not rejection. The captured later failure proves App rejection and a subsequent
same-frame document, but the initiating transport or navigation cause is unknown; a clean WebSocket
close or Vite polling branch does not prove a poller-triggered navigation.

Reject a real App-only transitive module after first paint and require an explicit failure path
rather than a permanently empty shell. A bounded same-specifier reattempt relies on the actual
browser's native module map: prove a failed fetch is retriable, successful dependencies retain
identity and an evaluation failure retains its error without repeating any effects. Chromium 153
cached fetch failures; Chrome 156's real abort and evaluation probes distinguish those semantics.
Never repeat bootstrap, root construction or bus registration around that import. Require the same
document, URL, singleton and one bootstrap capability emission, then the saved workspace and content.
Permanent fetch or evaluation failure must show an already-loaded manual Reload view. Initial
first-paint and desktop error defaults remain independent controls. Observe the production bootstrap
signal before reading identities: importing bootstrap from the test can manufacture the very startup
whose omission the probe must detect. An existing readiness barrier may be awaited, never initialized.
The pre-entry navigation controller retains its separate document-reload budget; a same-document
module reattempt must not spend or emulate it. Keep transport initiation unknown unless direct
lifecycle or network-initiator evidence distinguishes it.
Do not widen this initial-import lesson to lazy feature imports, which do not own startup recovery.

### 2026-10-30 — an immediate App retry could join still-failing sibling fetches (#5874, pre-merge)

A single aborted dependency passed the native-module retry check, but the production-shaped
immediate catch rejected again under an eighty-leaf cancellation burst with a healthy edge still
finishing. Chromium 156's [ModuleTreeLinker](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/third_party/blink/renderer/core/loader/modulescript/module_tree_linker.cc#299)
can finish on the first failed descendant while others remain outstanding; its
[ModuleMap](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/third_party/blink/renderer/core/script/module_map.cc#120)
attaches new clients to entries still fetching. A short configured pause before the sole identical
reattempt is best effort, not a public cleanup fence or guaranteed transport recovery.

Exercise the actual App loader with simultaneous first-only aborts and a healthy edge released by
the first real failure. Removing only the pause must fail the same saved-workspace/identity oracle.
Keep bootstrap, successful effects and document lifetime unchanged; retain terminal manual recovery.
The controlled failure refetched only some leaves, unlike the required CI capture's eighty reissued
and aborted leaves. Do not infer its physical cancellation actor from this regression or HAR receipt order.

### 2026-10-30 — the rendering imports could discard recovery before React existed

PR #5804 (`53af306a8aef69e3e9a91b2d7cde823bfdafa157`) added the independent HTML startup
surface but removed it as soon as the entry body began. The earlier app-shell marker from
PR #3408 replaced the root before CSS, React, first paint and notification-bus imports settled.
A rejected critical import could therefore leave only an empty marker, before App was requested.
Entry-only and App-only failure probes missed this intermediate loading phase.

Hold a real initial rendering dependency after entry starts, require both the early app-shell
marker and readable HTML status, then abort it. Require the existing dependency-free manual Reload
surface, the original error through platform reporting, no React root or App issuance and no
repeated bootstrap or bus registration. Keep document, URL and retry budget unchanged until the
user explicitly reloads. The HTML surface remains owned by startup until rendering takes over;
an entry-start marker or capability emission alone never proves that a usable view replaced it.
Do not retry the whole rendering phase or import a new failure view from the already failing graph.
