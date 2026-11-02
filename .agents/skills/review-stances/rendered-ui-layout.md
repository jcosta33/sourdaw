# Standing probes: rendered UI layout, disclosure, paint and contrast

Defects where React chrome or a canvas surface renders something other than what its class, state, setter or token
name implies: panes that together leave the canvas unusable, a strip that overflows at some UI scale, a disclosure
that steals focus, a canvas showing stale pixels, a panel shrunk below its request, or foreground text that fails its
contrast threshold on the surface it actually sits on. A class, state or token assertion on one element cannot prove
the rendered result; inspect the rendered viewports, rectangles, pixels and resolved colors in Chromium.

## Standing probes

1. **Dock allocation is judged on the rendered viewports (#4027).** Exercise the editor and the virtual keyboard
   together and inspect the rendered main and editor viewports. Individual pane state or class assertions cannot
   prove the remaining canvas stays usable; the case must fail when the docked panes together leave it unusable.
2. **A fixed-height status strip holds at every UI scale (#4054).** Measure the effective CSS viewport at every
   admitted UI scale. Keep engine and active monitoring states direct, and move optional metrics or actions through
   one React-owned disclosure. CSS-hidden duplicate trees leave stale portals, focus and mutable DOM refs; a case
   that finds a second copy of the hidden tree in the DOM fails this probe.
3. **A footer disclosure that owns a portaled menu hands focus off safely (#4056).** Track the menu content ref in
   each responsive mode. On a mode change both portals close, and focus is restored only when the active element
   belongs to the footer or that portal. Recheck focus immediately before an asynchronous handoff and cancel it on
   cleanup. Choose an outside target during the handoff: it keeps keyboard control; a restore that steals focus from
   the newly chosen target fails this probe.
4. **A canvas surface proves a fresh paint, not presence (Crumbs waveform, #5780; ruler, #5247).** A setter call,
   mounted canvas, counter or an older matching frame cannot show stale pixels. Paint the production component in
   Chromium at the expected DPR dimensions and prove known colored pixels, then pass empty peaks to the same canvas
   without remounting or resizing: require transparent or exact opaque-background pixels, with refill and resize
   controls. Drive project or device authority from real committed root events, including a same-ID ABA with no
   newer sequence masking the guard. For a ruler or similar painter, save a draw cursor before each Command or map
   write and require a new drawing after it, observing the real painter's fill, labels and strokes. Restoring the
   empty-data early return, or replacing the subscribed hook with an imperative read, must fail the unchanged pixel
   or fresh-paint case.
5. **The requested size and the allocated rectangle are asserted separately.** An element's inline `style.height`
   (or flex basis) is the requested CSS size; its bounding rect is what layout allocated, and flex can shrink a
   panel below its request. Assert both, each on its own. Make a sibling push the panel below its request: a case
   asserting only `style.height` or the flex basis stays green and must go red, and a case asserting only the rect
   must go red when the request itself changes.
6. **Foreground contrast is measured against every declared background stop (#4627).** Active red `LatchButton` text
   used `--color-state-record: #c45040` over an active gradient of `--surface-default: #13110f`, an intermediate sRGB
   mix and `--surface-raised: #1c1917`, giving 4.098:1 at the first stop (lower at the last), below the product's
   4.5:1 foreground contract; the record glow shared the class but is not foreground text. (The failing value entered
   in `eb278e9466` replacing `#FF4032`; the mapping predates it at `d9c1c4ca43`; `5aae4754d6` moved it to
   `tokens.css`; no introducing PR is established.) When a component selects foreground color through a token class
   and declares its own background gradient, render it in each active variant (all five for `LatchButton`), read the
   class actually applied to its text, resolve it through the current design tokens, parse every declared gradient
   stop including color mixes, and calculate WCAG sRGB relative-luminance contrast for each pair against the stated
   threshold. Do not hardcode old token values or treat the class name as proof of legibility. Changing the red
   class back to `text-state-record` must fail at 4.098:1 on the first stop.
