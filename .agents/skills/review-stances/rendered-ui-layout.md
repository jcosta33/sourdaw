# Standing probes: rendered UI layout, disclosure, paint, contrast and row identity

Defects where React chrome or a canvas surface renders something other than what its class, state, setter, token
or list data implies: panes that together leave the canvas unusable, a strip that overflows at some UI scale, a
disclosure that steals focus, a canvas showing stale pixels, a panel shrunk below its request, foreground text that
fails its contrast threshold on the surface it actually sits on, or a list of repeated rows whose keys lose an
occurrence on update (absorbed from the repeated-action-rows class). A class, state or token assertion on one
element cannot prove the rendered result; inspect the rendered viewports, rectangles, pixels, resolved colors and
row multiplicity.

## Standing probes

1. **Dock allocation is judged on the rendered viewports (#4027).** Runs: CI; the reviewer reads the affected
   end-to-end job that runs the dock case on the head, and from the fixed commit checks that the case reads
   rendered viewport rectangles rather than pane state. Exercise the editor and the virtual keyboard together and
   inspect the rendered main and editor viewports. Individual pane state or class assertions cannot prove the
   remaining canvas stays usable; the case must fail when the docked panes together leave it unusable.
2. **A fixed-height status strip holds at every UI scale (#4054).** Runs: CI; the reviewer reads the affected
   end-to-end job that runs the status-strip case on the head, and from the fixed commit checks that every
   admitted UI scale is measured. Measure the effective CSS viewport at each scale. Keep engine and active
   monitoring states direct, and move optional metrics or actions through one React-owned disclosure. CSS-hidden
   duplicate trees leave stale portals, focus and mutable DOM refs; a case that finds a second copy of the hidden
   tree in the DOM fails this probe.
3. **A footer disclosure that owns a portaled menu hands focus off safely (#4056).** Track the menu content ref in
   each responsive mode of `StatusBar`. On a mode change both portals close, and focus is restored only when the
   active element belongs to the footer or that portal. Recheck focus immediately before the deferred handoff and
   cancel it on cleanup; an outside target chosen during the handoff keeps keyboard control. In
   `src/modules/WorkspaceShell/presentations/views/__tests__/StatusBar.spec.tsx`, deleting the
   `focusMovedOutsideFooter` recheck inside `StatusBar.tsx`'s deferred `requestAnimationFrame` restoration must
   fail "keeps focus moved outside the footer before deferred mode restoration runs", and dropping the
   `footerOwnsFocus || moreOwnsFocus || projectLinksOwnFocus` condition that arms
   `restoreFocusAfterModeChangeRef` on a mode change must fail "keeps unrelated focus outside the footer through a mode change", each under
   `pnpm guard --profile focused -- pnpm test:run
src/modules/WorkspaceShell/presentations/views/__tests__/StatusBar.spec.tsx`. Focus restored from portaled
   Project Links items across real mode changes is observed only in the browser: read the affected end-to-end job
   that runs "restores focus from portaled Project Links items after each mode change at 2 UI scale" in
   `tests/e2e/statusBarResponsive.spec.ts` on the head.
4. **A canvas surface proves a fresh paint, not presence (Crumbs waveform, #5780; ruler, #5247).** Runs: CI; the
   reviewer reads the affected end-to-end job that runs the paint case on the head, and runs the ruler
   subscription mutation against
   `src/modules/Arrangement/presentations/views/__tests__/BeatRulerBar.meterMap.integration.spec.tsx` under the
   focused guard. A setter call, mounted canvas, counter or an older matching frame cannot show stale pixels.
   Paint the production component in Chromium at the expected DPR dimensions and prove known colored pixels,
   then pass empty peaks to the same canvas without remounting or resizing: require transparent or exact
   opaque-background pixels, with refill and resize controls. Drive project or device authority from real
   committed root events, including a same-ID ABA with no newer sequence masking the guard. For a ruler or
   similar painter derived from the map (ruler basis after Insert Time), capture raw and projected figures around
   the real Command, save a draw cursor before each Command, map write, Undo and Redo, and require a new drawing
   after each, observing the real painter's fill, labels and strokes; a matching earlier frame is not a fresh
   read. Restoring the empty-data early return, or replacing the subscribed hook with an imperative read, must
   fail the unchanged pixel, stopped map-change or history paint case.
5. **The requested size and the allocated rectangle are asserted separately.** Runs: CI; the reviewer reads the
   affected end-to-end job that runs the panel case on the head, and from the fixed commit checks that both
   values are asserted. An element's inline `style.height` (or flex basis) is the requested CSS size; its
   bounding rect is what layout allocated, and flex can shrink a panel below its request. Make a sibling push the
   panel below its request: a case asserting only `style.height` or the flex basis stays green and must go red,
   and a case asserting only the rect must go red when the request itself changes.
6. **Foreground contrast is measured against every declared background stop (#4627).** When a component selects
   foreground color through a token class and declares its own background gradient, render it in each active
   variant, read the class actually applied to its text, resolve it through the current design tokens, parse
   every declared gradient stop including color mixes, and calculate WCAG sRGB relative-luminance contrast for
   each pair against the product's 4.5:1 foreground contract. A glow sharing the class is not foreground text. Do
   not hardcode token values or treat the class name as proof of legibility. Changing active red `LatchButton`
   text back to `text-state-record` (`--color-state-record` over the `--surface-default` to `--surface-raised`
   gradient) must fail "keeps every active variant above the 4.5:1 foreground contract on every declared gradient
   stop" under `pnpm guard --profile focused -- pnpm test:run
src/components/daw/__tests__/LatchButton.contrast.spec.tsx`.
7. **Every utility class is written whole in source (#6169).** Tailwind generates a utility only from a complete
   class name it finds in a scanned file, so a class assembled at runtime (`` `border-${tone}-500/50` ``) reaches
   the DOM with no rule behind it, as the generative panel's selected genre, mood and instrument cards did. A DOM
   class assertion passes on such a class, since jsdom applies no CSS. Grep the diff for a template literal or
   concatenation producing a class name, conditional or not; each variant must map to complete literal strings. A
   case for a component whose classes vary by state must fail when any class a state adds is not written whole in
   its source; the grep alone covers unconditional strings.
8. **Repeated rows keep every occurrence through an update.** Display labels do not identify action occurrences.
   Render three identical actions followed by a distinct action in both an agent proposal and its history, then
   shrink or update the lists. Assert row multiplicity, order and the exact next state, and capture actual React
   console errors to require no duplicate-key warning. Use occurrence identity appropriate to the owning list:
   position is sufficient for stateless rows in an immutable ordered proposal or group. Do not deduplicate actions
   or mint project IDs to make labels unique. Unique-label fixtures cannot exhibit the failure. Restoring
   label-only proposal keys or action-type-plus-label history keys must fail the shrink or warning assertions
   under `pnpm guard --profile focused -- pnpm test:run
src/modules/WorkspaceShell/presentations/views/__tests__/AgentWorkspace.spec.tsx` (#4190, #4184).
