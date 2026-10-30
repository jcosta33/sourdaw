# Lesson library: startup entry availability

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

Reject the real initial App request after first paint and require an explicit failure path rather
than a permanently empty shell. When recovery is allowed, require a confirmed fresh retry budget
and a new document lifetime. Spent, corrupt, unavailable or unwritable budget, desktop startup,
bootstrap/render issuance and late failure after navigation intent must refuse automatic retry while
preserving manual Reload. Once retry navigation is requested, delayed App success must not start the
runtime. Keep transport initiation unknown unless direct lifecycle or network-initiator evidence
distinguishes it.
Do not widen this initial-import lesson to lazy feature imports, which do not own startup recovery.
