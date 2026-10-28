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
