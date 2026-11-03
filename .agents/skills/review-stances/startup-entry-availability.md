# Standing probes: startup entry availability

Defects where the application entry, its initial rendering imports or the editor transport can leave a blank or
replaced document during startup, or where recovery navigates, retries or repeats effects across a document that is
already running. Each phase (served HTML before the entry body, entry body before rendering, first paint before the
initial App import settles, a running App) owns its own recovery; a capability marker, an entry-start marker, missing
UI or a request count never proves which phase is live. Drive the real served document in Chromium, observe document
identity through `performance.timeOrigin`, and keep real same-project saved state and future Undo preservation as a
separate integration obligation (`project-integrity.md` probe 10) whenever recovery navigates. Initiating transport
causes stay unknown unless direct lifecycle or network-initiator evidence distinguishes them.

## Standing probes

1. **The editor connection must not own the acceptance document lifetime (`0ef2e91d94`, #5363, #5738; Vite 8.3.5
   pinned by #5748; #5595).** Vite 8.3.5 still reloads after a socket disconnect even with `server.hmr: false`, so
   editor WebSocket loss was never separated from healthy application HTTP and pending module ownership. Hold a real
   dynamic App module while the owned HTTP server stays healthy and the transport starts connected; await both server
   and browser socket readiness, then terminate only the fixture's established socket. Require the immutable E2E
   document's original time origin, one document request, actual App and CSS fulfillment with HMR off and no console
   or page errors; under default developer HMR require an observed CDP reload plus successful successor completion.
   Retain CSS exports and custom/error delivery. Disabling WebSockets altogether introduces connection errors rather
   than proving isolation; do not infer saved-project or Undo preservation from this transport fixture.
2. **The entry can fail before its own recovery exists (`33158adccb`; #5595).** An empty HTML root and an external
   module entry had no independent failure handling. Abort the actual entry URL derived from served HTML before its
   body executes: require an independent readable fallback and, when automatic recovery is offered, one real document
   navigation followed by unconditional application readiness. Hold a speculative request until its script element
   is parsed (raw request counts can mistake a parser refetch for recovery). Prove the generated entry identity and
   controller ordering in both source and built HTML under the unchanged production CSP. If the independent
   controller fails or stays pending, native browser Reload instructions stay visible without a misleading inactive
   button: hold its download while the parsed entry's real network request fails, then release it and require
   recovery through a changed document lifetime. A persistent failure stops at an accessible manual Reload surface
   preserving the full URL; unrelated resource errors do not spend the retry budget; unavailable, unwritable or
   corrupt retry storage requires manual recovery.
3. **Entry recovery must not navigate an already running document (#5595).** Parallel bootstrap can still be pending
   while a project or recording is live, so a capability marker's absence is not admission. Mark entry-body start
   before any composition or application effects and prove the entry's static dependency closure is pure; then
   deliver a late entry-targeted error with a live project and a recording in progress and require an unchanged
   document lifetime, runtime and visible project. Fail an actual child entry separately and preserve the host's time
   origin: only the failed document may reload. Share one per-tab retry budget across host and child and never
   replenish it on successful startup; storage failure requires manual recovery. Removing the phase fence or the
   shared budget must fail its own probe.
4. **The initial App import can reject after first paint (#3356 `26c6a7fe7d`).** #3356 made the initial App import a
   fulfillment-only continuation after `ApplicationFirstPaint`, with no rejection handler; its approval named a hung
   import and marker removal, not rejection. Reject a real App-only transitive module after first paint and require
   an explicit failure path rather than a permanently empty shell. A bounded same-specifier reattempt relies on the
   browser's native module map: prove a failed fetch is retriable, successful dependencies keep identity and an
   evaluation failure keeps its error without repeating effects (Chromium 153 cached fetch failures; Chrome 156's
   real abort and evaluation probes distinguish those semantics). Never repeat bootstrap, root construction or bus
   registration around that import; require the same document, URL, singleton and one bootstrap capability emission,
   then the saved workspace and content. Permanent fetch or evaluation failure shows an already-loaded manual Reload
   view; initial first-paint and desktop error defaults stay independent controls. Observe the production bootstrap
   signal before reading identities (importing bootstrap from the test manufactures the startup whose omission the
   probe must detect); an existing readiness barrier may be awaited, never initialized. The pre-entry navigation
   controller keeps its separate document-reload budget, which a same-document reattempt must not spend or emulate.
   This lesson does not cover lazy feature imports. Removing only the identical-import reattempt must fail the same
   browser case; a one-leaf fault passing is no evidence for it.
5. **An immediate App retry can join still-failing sibling fetches (#5874, pre-merge).** One aborted dependency passed
   the retry check, but the immediate catch rejected again under an eighty-leaf cancellation burst with a healthy edge
   still finishing: Chromium 156's
   [ModuleTreeLinker](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/third_party/blink/renderer/core/loader/modulescript/module_tree_linker.cc#299)
   can finish on the first failed descendant while others remain outstanding, and its
   [ModuleMap](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/third_party/blink/renderer/core/script/module_map.cc#120)
   attaches new clients to entries still fetching. Exercise the actual App loader with simultaneous first-only
   aborts and a healthy edge released by the first real failure; removing only the short configured pause before the
   sole identical reattempt must fail the same saved-workspace/identity oracle. The pause is best effort, not a
   public cleanup fence. Keep bootstrap, successful effects and document lifetime unchanged and terminal manual
   recovery intact. The controlled failure refetched only some leaves, unlike the CI capture's eighty reissued and
   aborted leaves; do not infer the physical cancellation actor from this regression or HAR receipt order.
6. **Rendering imports must not discard recovery before React exists (#5804 `53af306a8a`; #3408 marker).** #5804's
   independent HTML startup surface was removed as soon as the entry body began, and #3408's app-shell marker
   replaced the root before CSS, React, first paint and notification-bus imports settled, so a rejected critical
   import left an empty marker before App was requested. Hold a real initial rendering dependency after entry starts,
   require both the early app-shell marker and readable HTML status, then abort it: the existing dependency-free
   manual Reload surface, the original error through platform reporting, no React root or App issuance and no
   repeated bootstrap or bus registration; document, URL and retry budget unchanged until the user reloads. The HTML
   surface stays owned by startup until rendering takes over. Do not retry the whole rendering phase or import a new
   failure view from the already failing graph.
7. **First paint conceals bootstrap effects that already started (#3356, #5876).** #3356 painted before the initial App
   import settled while bootstrap stayed on the parallel startup path, so the failed reload had already run
   capability and BrowserAi initialization before App rejected. Hold the actual initial App import after first paint;
   before release observe the real bootstrap evaluation/effect boundary (if App fulfillment owns bootstrap, effects it
   initiates stay absent until release); after release require actual App render issuance and bootstrap
   observation. Do not infer quiescence from missing UI or capability markers, fixed microtask counts or an unrelated
   hung-import case. The cold stylesheet lesson stays in `test-timing-and-isolation.md` probe 2.
