# VirtualKeyboard module audit

## Scope

This audit covers `src/modules/VirtualKeyboard/` in full — every file in the
module. The module is presentation-only:

- `presentations/views/VirtualKeyboard.tsx` (the component, 549 lines)
- `presentations/views/index.ts` (barrel — single re-export)
- `presentations/views/__tests__/VirtualKeyboard.spec.tsx`
- `events/index.ts` (`// no public events`)
- `useCases/index.ts` (`// no public use cases`)

It is an adversarial review focused on: keyboard event handling (key
repeat, modifier keys, focus loss); stuck-note prevention on key-up
loss; velocity correctness; octave-shift edge cases; pointer/mouse
glide handling; React anti-patterns; type soundness; AGENTS.md compliance;
and testing gaps.

It explicitly excludes the consumer (`Workspace/AppShell.tsx`,
`Workspace/Transport/PanelToggles.tsx`) and the dependencies it imports
(`AudioEngine.triggerLiveNoteOn/Off`, `Workspace.setVirtualKeyboard*`)
except where their contracts intersect this module's behaviour.

Related spec: none on disk.

---

## Goal

A correctness-first on-screen keyboard surface for the DAW:

- Every `noteOn` is paired with exactly one `noteOff`. No stuck notes
  under any of: focus loss, modifier-press during hold, octave shift
  during hold, pointer-up outside panel, browser tab visibility change,
  component unmount, parent panel close, OS-level Cmd/Tab.
- Velocity reflects the configured velocity slider _at the moment of
  the noteOn_ — and the keyboard surface is built so a future
  velocity-from-y-position upgrade fits cleanly.
- Octave shifts are bounded (Z/X) and respect the visible keyboard
  range (C-1 … C8 → MIDI 0 … 108). The configured `octave` cannot
  overflow into MIDI > 127 territory and cannot underflow into
  MIDI < 0.
- Computer-keyboard mapping is correct, repeat-suppressed, modifier-
  aware, IME-friendly, focus-scoped, and does not steal keys from
  global shortcuts.
- Black-key hit testing works pixel-correctly under the white-key
  layer (z-order, pointer-events, hover, capture).
- Accessibility: the keys are operable with a screen reader (or
  explicitly marked decorative) and the velocity / octave controls
  are labelled and reachable by Tab.
- AGENTS.md hard rules: no `any`, no assertion escapes, no
  `useMemo`/`useCallback`/`React.memo`, no `forwardRef`, ternaries
  not `&&`, no namespace imports, internal imports relative not via
  the module barrel; tests assert real contract not "is defined".

---

## Relevant code paths

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx`
- `src/modules/VirtualKeyboard/presentations/views/index.ts`
- `src/modules/VirtualKeyboard/presentations/views/__tests__/VirtualKeyboard.spec.tsx`
- `src/modules/VirtualKeyboard/events/index.ts`
- `src/modules/VirtualKeyboard/useCases/index.ts`

External contracts the module relies on:

- `triggerLiveNoteOn(channel, note, velocity)` /
  `triggerLiveNoteOff(channel, note)` from `#/modules/AudioEngine/useCases`
- `setVirtualKeyboardOctave(octave)` /
  `setVirtualKeyboardVelocity(velocity)` from
  `#/modules/Workspace/useCases` (clamp octave to `[0, 8]` and
  velocity to `[1, 127]` server-side)
- `workspaceStore` reads `virtualKeyboardOctave`,
  `virtualKeyboardVelocity` from `#/modules/Workspace/stores`

---

## Current behavior

**Layout.** The component renders 64 white keys (C-1 … C8 inclusive,
9 octaves × 7 + 1 trailing C) at fixed 28 px width inside a horizontally
scrollable region. Black keys are absolutely positioned over the white
key row with hard-coded fractional offsets per octave
(`BLACK_KEY_FRACS`, `VirtualKeyboard.tsx:77`). The black-key list is
pre-computed once at module load (`ALL_BLACK_KEYS = buildBlackKeys()`,
`:125`). On mount and on every octave change, a `useLayoutEffect`
resets `scrollLeft` to bring the active octave's first white into view
with a 60 px left padding (`:177-184`).

**Mouse interaction.** Pointer-down on a white or black key:
preventDefault, `setPointerCapture`, store `mouseNote.current = midi`,
call `triggerLiveNoteOn(0, midi, velocity)` and update `pressedNotes`
(`:188-201`). Pointer-up: if `mouseNote === midi`, fire `triggerLiveNoteOff`
and clear (`:228-234`, `:255-262`). Pointer-enter while `event.buttons
=== 1` glides: fires `noteOff` on the previous note, then `noteOn` on
the new (`:236-242`, `:264-270`). A global `pointerup` listener
clears any in-flight mouse note when release happens outside the panel
(`:273-282`).

**Computer keyboard.** `onKeyDown` (`:286`):

- Bails on `metaKey || ctrlKey || altKey` (no modifier-prefixed keys).
- `z` / `x` shift octave down/up via `setVirtualKeyboardOctave`.
- `heldKeys.current.add(key)` suppresses key-repeat (browsers fire
  `keydown` repeatedly while a key is held).
- White map (a, s, d, f, g, h, j, k, l, ;) → semitones 0…16 from the
  active octave's C; black map (w, e, t, y, u, o, p) → semitones 1…15.
- `triggerNoteOn(octave * 12 + semi)`.

`onKeyUp` (`:321`): removes from `heldKeys`, triggers `noteOff` on the
matching semitone.

`onBlur` (`:336`): clears `heldKeys`, fires `triggerLiveNoteOff` on
every entry in `pressedNotes`, clears `pressedNotes`, nulls
`mouseNote`.

**Velocity & octave.** Velocity slider 1–127, octave bounded by the
button `disabled={octave <= 0}` / `disabled={octave >= 8}` (`:400`,
`:418`). Z/X path does **not** clamp; it just calls
`setVirtualKeyboardOctave(octave ± 1)` and relies on the use case
itself clamping to `[0, 8]`.

**Default-store fallback.** `useStore(workspaceStore, defaultWorkspaceState)`
(`:165`) provides `octave = 4`, `velocity = 100` if the store is not
yet hydrated. The default object is cast `as WorkspaceState` (`:130`)
because it is a partial — only two fields are filled in.

---

## Findings

1. **Stuck-note matrix is incomplete.** The component handles three
   release paths (`onBlur`, `pointerup` global, `keyup` per-key), but
   there is **no protection** for:
    - **Component unmount** while keys are held — no cleanup effect
      fires `triggerLiveNoteOff` for entries in `pressedNotes`. A
      parent that hides the panel during a chord (e.g. user clicks the
      panel-toggle button while holding a note) leaves notes hanging
      in the audio graph forever.
    - **Tab visibility change** (`document.visibilitychange`) — when a
      user Cmd-Tabs / switches tabs while holding keyboard keys, the
      browser does not fire `keyup` for the held keys. The next focus
      cycle restores `heldKeys` containing stale entries, so the very
      next press of the same key is silently swallowed (the
      `heldKeys.has(key)` guard at `:303` returns true).
    - **Window blur** (different from React's `onBlur` on the panel) —
      Cmd-Tab when the panel is the focused element fires React's
      `onBlur`, but if the panel is not focused (e.g. user is typing
      somewhere else, then presses Z to shift octave globally — see
      next finding) and the window blurs while a held note is active,
      no path clears it.
    - **Octave shift while holding a key** — see issue #2; the
      `keyup` for that key targets the _new_ octave, leaking the
      previous noteOn.

2. **Octave shift during a held note guarantees a stuck note.**
   `onKeyDown` (`:286`) for the `z`/`x` keys mutates octave _without_
   clearing held notes. If the user holds `a` (C of octave 4) and
   presses `x`, the next `keyup` for `a` computes
   `octave * 12 + 0` against the **new** octave (5) and emits a
   `noteOff` for MIDI 60 (C4) → wait, let me re-read… `triggerNoteOff`
   at `:325-328` reads `octave` at the time of the call, so it sends
   `noteOff` for MIDI **5 × 12 + 0 = 60** which is wrong: the original
   `noteOn` was at MIDI **4 × 12 + 0 = 48**. The stuck note is on MIDI
   48; the user has emitted a spurious `noteOff` on MIDI 60 (which the
   AudioEngine ignores as no matching `noteOn` exists), leaving MIDI
   48 hanging until panel blur or unmount. Repeated octave shifts
   compound the leak.

3. **`onKeyDown` octave handler does not guard against key repeat.**
   `:292-301` shifts octave on every `keydown` for `z`/`x`, including
   the OS auto-repeat fires (~30 ms cadence on macOS). Holding `x`
   sweeps from octave 4 → 8 in <250 ms. The `heldKeys` guard at
   `:303-305` is _below_ the z/x branches — they early-return before
   it. UX: you cannot hold `x` to "scroll the keyboard" because the
   octave just blasts to the max.

4. **Velocity is captured at noteOn time but `triggerNoteOn` reads it
   from the closure, not a ref.** `velocity` (`:167`) is a closure
   capture from the latest render. With React Compiler this is
   probably fine, but the global pointerup listener (`:274-281`) and
   the keyboard handlers all reference `velocity` via the same
   closure — meaning every render rebuilds these handlers and the
   `useEffect` on `:273` depends on `[]` so the global handler keeps
   the **first** render's `velocity`. The first render's velocity is
   `defaultWorkspaceState.virtualKeyboardVelocity = 100`, so the
   global pointerup handler can only ever fire `triggerNoteOff` (no
   velocity arg) — that's actually safe by accident.
   However, the Three Strikes adversarial frame: if anyone refactors
   `onGlobalUp` to call `triggerNoteOn` (e.g. velocity-changed event
   bus), the stale closure becomes a real bug. Also the empty-dep
   array means a `velocity` change does **not** re-attach a fresher
   listener — fine today, but a footgun next session.

5. **`onBlur` releases via raw `triggerLiveNoteOff`, not the local
   `triggerNoteOff` helper.** `:339` `triggerLiveNoteOff(0, midiNote)`
   does **not** also remove the entry from `pressedNotes` — the
   subsequent `setPressedNotes(new Set())` at `:341` does that, but
   the asymmetry means `pressedNotes` and the actual audio-graph
   state are momentarily out of sync. Cosmetic, but inconsistent with
   the rest of the file. More importantly: `onBlur` clears `heldKeys`
   and `pressedNotes` but does **not** clear `mouseNote` to null
   first, then sets it; if the panel loses focus _during_ a mouse
   drag (e.g. user drags off the panel onto an iframe that grabs
   focus), `mouseNote` is set to null at `:342` but the subsequent
   global pointerup will see `mouseNote === null` and skip — except
   the audio note for the captured pointer will _have already been
   released_ by the global pointerup listener at `:273`… or will it?
   The global handler uses the same `mouseNote` ref, but after
   `onBlur` nulls it the global handler skips. Net effect: if onBlur
   fires _before_ the global pointerup, the mouse note is leaked.
   This is a real ordering hazard.

6. **Velocity is hard-coded constant — no velocity-from-y-position
   and no velocity sensitivity curve.** Real piano keyboards (Logic,
   Ableton) modulate velocity by where you click on the key (top =
   soft, bottom = hard) or by mouse force on supported devices.
   `triggerLiveNoteOn(0, midi, velocity)` always passes the slider
   value, regardless of where the click lands. UX gap, not a bug, but
   call out: the comment at the top promises Logic Pro-style behaviour
   and this is the most visible miss.

7. **Computer-keyboard map ignores the focus contract.** The
   `onKeyDown` handler is wired to the panel `<div>` with
   `tabIndex={0}` (`:354`). When the panel is _not_ focused, the
   handler does not fire — good. But the surface-level UX
   communication to the user is "press A to play C" (`DawInlineHint`,
   `:386`) without any indication that the panel must be focused
   first. Users will press `a` while a text input is focused and
   either type "a" or — if the text input has the global keyboard
   shortcut hijacker mounted somewhere upstream — get nothing. At
   minimum the inline hint should change colour or show a "🎹 ready"
   indicator when the panel actually has focus.

8. **`heldKeys` is keyed on `event.key.toLowerCase()` not `event.code`.**
   `:290`, `:322`. On AZERTY/Dvorak/Workman keyboards, `a` lives in a
   different physical position than QWERTY's `a`. Using `event.code`
   (`KeyA`) maps to physical position regardless of layout — typical
   for game / DAW keyboard mappings. Using `event.key` is locale-
   dependent: an AZERTY user pressing the physical "QWERTY a" key
   gets `event.key === 'q'`, which lands in `KEYBOARD_BLACK_MAP['q']`
   (undefined → no note). The component is silently broken for non-
   QWERTY users.

9. **`event.key.toLowerCase()` collides with shifted variants.**
   Pressing `Shift+a` produces `event.key === 'A'`; `.toLowerCase()`
   normalises it to `'a'`. The handler then fires noteOn — even
   though Shift is held, which the user might intend as a modifier
   for "play one octave up" or "sustain". The bail at `:287` only
   excludes `metaKey`, `ctrlKey`, `altKey` — **not** `shiftKey`.
   Inconsistent with most DAW keyboards.

10. **`heldKeys` is a `useRef<Set<string>>`, not state — and is
    referenced from a render-scoped function.** Fine in itself, but
    `onKeyDown`, `onKeyUp`, `onBlur` all close over `heldKeys.current`
    and `octave`. If `octave` changes mid-hold, the per-render
    `onKeyDown` reads the new value — but the corresponding `onKeyUp`
    that was registered as the React handler on the same render is
    fine, _except_ the React handler is rebuilt every render so a
    keyup that happens after an octave change reads the new octave
    (issue #2 again). React's auto-memoisation under React Compiler
    might or might not stabilise the handler. Either way, the
    octave-during-hold bug is not a closure issue — it is
    architectural: octave is read from the store at handler-call
    time.

11. **Velocity slider has no keyboard accessibility for value
    increments.** `<Slider>` (`:430`) is presumably keyboard-operable
    as a Radix slider, but the per-key arrow nudges are tied up with
    `onKeyDown` of the panel. When the slider is focused, pressing
    `a` will: (a) the slider receives the key (Radix slider does not
    use `a` for nudges so it does nothing), then (b) it bubbles to
    the panel's `onKeyDown` and fires C noteOn. That is _probably_
    intentional — but pressing `Tab` to focus the slider, then
    pressing arrow-left to decrement the value, also fires the panel
    keydown handler. `arrow-left` is not in the maps so nothing
    happens — but if the user uses the keyboard's `g` to increment
    by a stride, that key fires a note. There is no event-bubbling
    guard.

12. **`role="application"` swallows screen-reader navigation.** The
    panel sets `role="application"` (`:359`) which tells assistive
    tech "we handle keyboard navigation; do not enter virtual
    cursor / browse mode". Combined with 64+ child `role="button"`
    elements (`:500`, `:540`), the AT will try to expose every key
    as a clickable button — but the application role prevents native
    arrow-key navigation between them. Either: (a) drop
    `role="application"` and let the buttons be Tab-navigable, or
    (b) implement a single composite-keyboard model (e.g. roving
    tabindex on the keys) per WAI-ARIA APG. Today: a screen-reader
    user cannot meaningfully play notes.

13. **Black-key `aria-label` is just `MIDI ${midi}`.** White keys at
    least disclose `C${displayOctave}` for C notes (`:499`). Black
    keys never disclose pitch class. A screen reader announces "MIDI
    61, button" instead of "C#4 button". Also, white-key non-C notes
    are equally undescriptive. AT user cannot tell which note they
    are about to play.

14. **`role="button"` on every key, no keyboard activation handler.**
    `:500`, `:540`. ARIA `role="button"` + `tabIndex` (none here, so
    actually unfocusable!) means screen-readers see "buttons" but
    users cannot Tab to them and cannot activate them with `Enter` /
    `Space`. The buttons exist in the AT tree but are pure decorations.
    Either remove `role="button"` (they are not really buttons —
    they're keys) or add `tabIndex={0}` and `onKeyDown` activation.

15. **`isValid` gate skips event handlers for invalid white keys —
    but the visual styling does not change.** `:464`, `:493-498`.
    A white key whose MIDI is < 0 or > 127 (none in the C-1…C8 range,
    so this branch is currently unreachable) or whose semitone is
    not in `WHITE_KEY_SEMITONES` (also unreachable since
    `whiteIdxToMidi` only emits white-key semitones) renders as a
    white key with no event handlers and no visual disabled state.
    The `isValid` check is dead code; the conditions cannot be false
    given the way `whiteIdxToMidi` is constructed. Either remove the
    guard or make it real.

16. **`whiteIdxToMidi` uses a `?? 0` on a typed array index.**
    `:96` `semiOffsets[posInOct] ?? 0`. `semiOffsets` is a six-
    element array indexed by `posInOct = whiteIdx % 7` (0…6), which
    is always in range — but the array has _seven_ elements
    `[0, 2, 4, 5, 7, 9, 11]`. Comment says six. The `?? 0` is dead
    defensive code on a JS array (out-of-range indexes return
    undefined → `?? 0`); the loop's bounds make it unreachable.
    Code style: shows insecurity in the math.

17. **`buildBlackKeys` produces two-octave-wide black keys at the
    edges that map to invalid MIDI notes.** Loop iterates
    `oct = 0…8` (`:110`) and adds black keys at semis 1, 3, 6, 8,
    10. For `oct = 0` (the C-1 octave): MIDI 1 (C#-1) through 10
    (A#-1) — all valid. For `oct = 8` (the C8 octave): the iteration
    adds C#8 (MIDI 109), D#8 (111), F#8 (114), G#8 (116), A#8 (118).
    All are > 108 — which is the documented top of the rendered
    keyboard (one trailing C8 = white key 63). The black keys past
    C8 are filtered by the `midi > 127` guard (`:115`) — which only
    excludes 128+. So **C#8 through A#8 (MIDI 109–118) are
    rendered, hover, and click-able** even though there is no white
    key after C8 to anchor them visually. They appear as floating
    black bars to the right of C8. Either narrow the loop to
    `oct < TOTAL_OCTAVES && oct < 8` or filter on `midi > 108`.

18. **`BLACK_KEY_FRACS` uses raw object enumeration order.**
    `Object.entries(BLACK_KEY_FRACS)` (`:112`) relies on
    insertion order of integer-keyed properties — JS engines enumerate
    integer keys in numeric ascending order regardless of insertion,
    so this happens to work. But the implicit dependence on engine
    behaviour for what is effectively a constant lookup is bad style.
    Use a typed array of `{ semi, frac }` objects with explicit
    ordering.

19. **Octave bounds disagree across the codebase.**
    - `setVirtualKeyboardOctave` clamps to `[0, 8]`
      (`Workspace/.../setVirtualKeyboardOctave.ts:4`).
    - The button `disabled` gates use `octave <= 0` / `octave >= 8`
      (`:400`, `:418`).
    - The Z/X handlers do **not** clamp before dispatch, relying on
      the use case to clamp.
    - `whiteIdxToMidi` and `buildBlackKeys` model 9 octaves
      (C-1 … C8 = displayOctave -1 … 8).
    - The "active octave" mapped from `setVirtualKeyboardOctave` (0…8)
      is used at `:181` `octaveToFirstWhiteIdx(octave) =
      (octave + 1) * 7` → octave=0 → first-white index 7 (= C0).
      So `octave=0` displays as **C0**, not **C-1**. The 9th octave
      (C-1) is unreachable as the "active octave" — the keys exist
      but cannot be the home row. Computer keyboard `octave * 12 +
      semi` at `octave=0` plays C0 = MIDI 12. There is no way to play
      MIDI 0–11 from the computer keyboard. Either the rendered
      range overshoots (drop C-1) or the active range under-shoots
      (allow `octave = -1`). Discrepancy is silent.
    - `octave = 8` then plays MIDI 96 (C7) … 96 + 16 (E8) for the
      `;` key — but the keyboard's `;` is `KEYBOARD_WHITE_MAP[';'] =
      16`, so `octave=8` + 16 = **104** (G#7… wait, 96+16=112,
      semitone 4 of octave 9 = E8) — yes, MIDI 112 = E8. Within
      range, but octave-shifting up past 8 is allowed (`octave > 8`)
      via the use case clamp; the inline hint says "Z/X octave"
      with no bounds.

20. **Octave Z/X dispatch does not exit early if at bounds.**
    `:294`, `:299`. `setVirtualKeyboardOctave(octave - 1)` at
    `octave=0` becomes `-1`, clamped to `0` by the use case → no-op.
    But the `event.preventDefault()` runs first, so the `z`/`x`
    keypress is consumed even when nothing happens. If a parent
    handler also wanted to listen, it would not see the event. Minor
    but worth noting.

21. **`useEffect` at `:273` does not depend on anything but is
    re-attached on every render only via dep `[]` semantics.**
    React under StrictMode mounts effects twice in development, so
    the global `pointerup` listener fires twice per release (no
    real bug because it just nulls a ref and triggers
    `triggerLiveNoteOff(0, mouseNote.current)` which is idempotent
    on the AudioEngine — _if_ the AudioEngine is idempotent on
    duplicate `noteOff`s. Need to verify; if not, this double-fires
    in dev.

22. **`event.preventDefault` is missing on `pointerEnter` glide
    branches.** `:236-242`, `:264-270`. `pointerenter` does not have
    a default action that benefits from `preventDefault` (no text
    selection on the empty divs), but inconsistent with `pointerdown`
    which calls it. Cosmetic.

23. **Pointer capture conflicts with the cross-key glide intent.**
    `:219` `setPointerCapture(event.pointerId)` redirects subsequent
    `pointermove` events to the captured element. The W3C
    PointerEvents spec history around `pointerenter` / `pointerleave`
    during capture has been ambiguous: older Chromium implementations
    did not fire enter/leave to non-capture targets; newer ones
    (per the L3 spec) re-emit `pointerover`/`pointerenter`/`pointerleave`/`pointerout`
    based on actual hit-testing, which means glide *might* work on
    modern Chromium / Firefox but not on older builds (Safari
    historically lagged here too). Either way: the glide path
    (`onWhitePointerEnter` / `onBlackPointerEnter`) is fragile and
    cross-browser-inconsistent. The cleanest correctness story is
    a single wrapper-level `pointermove` that hit-tests against
    pre-computed key rects (or `document.elementFromPoint`) — that
    is what every well-tested DAW keyboard implements.

    **Confidence:** Medium-high that this is broken on at least
    some target browsers. Needs an explicit cross-browser test;
    the audit's recommendation is to refactor away from per-key
    capture+enter regardless of which browsers happen to "work"
    today.

24. **Black-key `pointerEnter` handler for glide does not inherit the
    pointer capture.** `:264-270`. If the user starts on a white key
    (capture set), then drags onto a black key, `pointerenter` does
    not fire on the black key (per #23). Even if it did, the black
    key handler is not a pointer-capture target, so subsequent moves
    follow the white-key capture. Glide between white and black is
    broken either way. The intended behaviour (drag glissando across
    the keyboard) requires a different architecture (a single
    pointer-tracker on the wrapper that does hit-testing).

25. **`pointerLeave` is not handled.** Comment at the top
    (`VirtualKeyboard.tsx:8`) advertises "pointerup/pointerleave =
    noteOff" — but `pointerleave` is not bound. If the pointer leaves
    the key and then `pointerup` fires off-panel, the global handler
    (`:273-282`) clears it. But if the pointer drags off and then
    re-enters _without_ releasing, the `pointerenter` glide will see
    `event.buttons === 1` and might re-trigger the same MIDI on
    re-entry. Test: hold mouse, drag off, drag back to the same key
    → expect a single sustained note, but get noteOff/noteOn
    re-trigger.

26. **Default workspace state is cast `as WorkspaceState`.**
    `:130` `} as WorkspaceState`. `WorkspaceState` has many fields
    (panel toggles, BPM, time signature, etc., per
    `Workspace/models/WorkspaceState.ts`). The cast erases the
    missing fields. AGENTS.md "TypeScript — soundness" forbids `as`
    used to silence the compiler. Should import the canonical
    `defaultWorkspaceState` from `Workspace/useCases` (it is exported
    at `Workspace/models/WorkspaceState.ts:122`), or build a typed
    `Pick<WorkspaceState, 'virtualKeyboardOctave' | 'virtualKeyboardVelocity'>`.

27. **Test file uses `any` extensively.** `__tests__/VirtualKeyboard.spec.tsx`
    uses `any` at lines 32, 60, 74. The vi.mock for `Button`, `Slider`,
    `DawHeaderBand` types props as `any`. AGENTS.md "TypeScript —
    soundness" forbids `any` outside immediately-narrowed boundaries.

28. **Tests cover only render smoke — no behavioural assertions.**
    The 11 tests assert: renders without crashing, displays title,
    renders strip/surface, octave controls present, octave displayed,
    close button conditional. **None** test:
    - That a pointerdown on a white key calls
      `triggerLiveNoteOn(0, expectedMidi, velocity)` with the right
      MIDI for octave 4.
    - That a pointerup releases.
    - That a keyboard `a` keydown plays C of the active octave.
    - That `onBlur` releases held notes.
    - That key-repeat is suppressed (multiple keydowns of `a` →
      only one `triggerLiveNoteOn`).
    - That Z/X shifts octave (and that octave-during-hold is
      handled — see issue #2).
    - That the global pointerup listener fires.
    - That black keys hit-test correctly under the white-key layer.
    - That octave bounds work (`octave <= 0` disables button).
    - That the velocity slider sets velocity.
    - Stuck-note prevention on unmount, blur, visibility-change.

    The current spec file is checking that the HTML scaffolding
    renders, not that the keyboard works. AGENTS.md "TypeScript —
    soundness" → tests: "Do not stop at 'defined' / 'truthy' /
    generic `toBeTypeOf('object')` — assert the actual contract".

29. **Test mocks point at deep paths instead of the module barrel.**
    `__tests__/VirtualKeyboard.spec.tsx:14`,`:18`,`:22`,`:26` mock
    deep paths
    (`#/modules/AudioEngine/useCases/triggerLiveNoteOn`,
    `#/modules/Workspace/useCases/togglePanel/panelToggles/setVirtualKeyboardVelocity`).
    Production imports these from the module barrels
    (`#/modules/AudioEngine/useCases`,
    `#/modules/Workspace/useCases`). Vitest's `vi.mock` mocks the
    exact path; mocking the deep path does not intercept the barrel
    re-export (the barrel re-exports the same value, but `vi.mock`
    operates per-module-id, and the production code's `import { x }
    from '#/modules/Foo/useCases'` resolves to `Foo/useCases/index.ts`
    not the deep file). The mocks may or may not bind depending on
    how Vitest resolves the module graph (sometimes it follows the
    re-export, sometimes not). At minimum the mock paths are
    fragile. Compare with `AudioAnalysis.md` issue #2 — same
    failure mode.

30. **Module is presentation-only with empty `events/` and `useCases/`
    sentinels and NO root `index.ts`.** `events/index.ts` and
    `useCases/index.ts` both just contain `// no public events` /
    `// no public use cases`. There is **no** `index.ts` at
    `src/modules/VirtualKeyboard/`. The consumer
    (`Workspace/presentations/views/AppShell.tsx:65`) reaches in via
    `import { VirtualKeyboard } from '#/modules/VirtualKeyboard/presentations/views'`
    — a **deep cross-module import** into another module's
    `presentations/views` directory. AGENTS.md "Cross-module imports
    MUST only target the destination module's root `index.ts`" — this
    import is a direct violation. The fact that `presentations/views/`
    is documented as private in AGENTS.md ("Private Internals:
    `handlers/`, `models/`, `repositories/`, `engine/`, `transformers/`,
    `services/`, `presentations/hooks/`, and `presentations/components/`")
    — wait, AGENTS.md lists `presentations/hooks/` and
    `presentations/components/` as private but **`presentations/views/`
    is part of the cross-module public surface** ("each module's root
    `index.ts` … may only re-export from `useCases/`, `events/`,
    `stores/`, and `presentations/views/`"). So `presentations/views/`
    is allowed to be re-exported by the root barrel — but the
    cross-module access must still go through that root barrel, not
    directly. The deep-import here is a `same-module-rule`-style
    violation.

31. **No `forwardRef` (compliant).** No `useMemo`/`useCallback`/
    `React.memo` (compliant). No `&&` rendering — the conditional
    rendering uses ternaries (e.g. `:382`, `:511`) (compliant).
    No `enum` (compliant). Uses `type` for `VirtualKeyboardProps`,
    `BlackKeyDef` (compliant). One minor: `actions` prop receives
    `onClose ? <Tooltip>…</Tooltip> : null` — this is a ternary,
    fine.

32. **`onPointerDown={isValid ? (event) => onWhitePointerDown(...)
    : undefined}` allocates a fresh closure per render per key.**
    `:493`. With 64 white keys this allocates 64 × 3 closures per
    render (down/up/enter). React Compiler should hoist these, but
    only if it determines stability. The data-flow (`midiNote` is
    derived from `whiteIdx`) is render-invariant per iteration, but
    the compiler must prove that. If it cannot, this is a per-render
    allocation. Not a bug, but on a virtual keyboard re-rendering
    on every press (due to `setPressedNotes` state), the allocation
    cost is non-trivial. A single-handler-on-the-wrapper pattern
    would be both faster and fix the glide issues (#23, #24).

33. **`pressedNotes` is a `Set<number>`, but the render reads it as
    `pressedNotes.has(midiNote)` for every key on every render.**
    For 64 white keys + ~50 black keys = 114 lookups per render.
    `Set.has` is O(1) so fine, but combined with a re-render on
    every `pressedNotes` mutation (which happens on every noteOn /
    noteOff), it's 228+ lookups per noteOn. Same observation as
    PianoRoll's optimisation work (commit `d2c899dce`); this
    component has not been similarly optimised.

34. **Confirmed: deep cross-module import in `AppShell.tsx`.**
    `Workspace/presentations/views/AppShell.tsx:65` reads
    `import { VirtualKeyboard } from '#/modules/VirtualKeyboard/presentations/views';`
    — this is a deep import that bypasses any root barrel. AGENTS.md
    explicitly forbids: "Cross-module imports MUST only target the
    destination module's root `index.ts` (e.g. `#/modules/Arrangement`).
    Deep imports into `useCases/`, `events/`, `stores/`,
    `presentations/views/`, or any other path from outside the module
    are forbidden." `pnpm deps:validate` should be flagging this; if
    not, the rule has a hole.

35. **`onClose` prop callback never wraps the underlying
    `triggerLiveNoteOff` for held notes.** `:373` `onClick={onClose}`
    fires close immediately, no panel `onBlur` is guaranteed to
    fire first (the close button is _inside_ the panel). On unmount
    React fires effect cleanup; the only effect with cleanup is
    the global pointerup listener. There is no
    `useEffect(() => () => releaseAllHeldNotes(), [])`. So clicking
    Close while holding `a` leaves MIDI 60 (or wherever) sustained
    forever in the audio engine. Same root cause as #1 (component
    unmount leak).

36. **`virtualKeyboardOctave` typed as `number`, no branding for
    "display octave" vs "MIDI octave".** `Workspace/models/WorkspaceState.ts`
    line 69 reads `virtualKeyboardOctave: number`. The component
    treats this as "displayOctave + 1" implicitly (issue #19); the
    PianoRoll or any other consumer would treat it as raw octave.
    No type brand → silent semantic divergence.

37. **No tests for layout math.** `whiteIdxToMidi`,
    `octaveToFirstWhiteIdx`, `buildBlackKeys`, `BLACK_KEY_FRACS`
    — the geometry that determines whether a click actually plays
    the right note. Not exposed for testing (private to the file).
    A regression in `BLACK_KEY_FRACS` (e.g. someone "fixes" the
    1.67 typo) would silently shift hit-zones, and there is no
    test to catch it.

38. **`heldKeys.current.add(key)` does not protect against
    re-fire across blur cycles.** When the panel loses focus
    (`onBlur` clears `heldKeys`) but the user is still holding a
    key on the OS, the next focus + keydown _without_ keyup will
    fire as if it were a fresh press — fine in normal usage, but
    if the user releases the key while focus is elsewhere, the
    keyup is lost. On the next focus + new keydown for the same
    key, `heldKeys.has(key)` returns false (cleared), so a fresh
    noteOn fires — correct. But the **previous** noteOn (before
    blur) was released by `onBlur` (good, this is handled). OK
    this one is actually safe — but the visibility-change case in
    issue #1 is not.

39. **The "global pointerup" listener uses `window.addEventListener`,
    not the panel ref.** `:280`. Fine for capturing pointer-up
    outside the panel, but the listener fires for **any** mouse
    release anywhere on the page — including releases that have
    nothing to do with the keyboard. Today the handler just
    no-ops if `mouseNote.current === null`, so it is harmless.
    But scaling: this listener stays attached for the entire
    lifetime of the panel, on every render's effect setup
    (which is once due to `[]` deps).

40. **`event.currentTarget as HTMLDivElement`** at `:219`. The
    cast is unnecessary — `event.currentTarget` from
    `React.PointerEvent<HTMLDivElement>` is already typed as
    `HTMLDivElement`. The `as` is dead. AGENTS.md "TypeScript —
    soundness" forbids casts that silence the compiler. Here it
    silences nothing because the type is already correct, but it
    is noise.

41. **All velocity dispatched via slider is unclamped; UI suggests
    `[1, 127]` but the contract is enforced by the use case.**
    Fine, but if the use case ever stops clamping (regression),
    velocity 0 (which means noteOff in MIDI) could be sent as a
    noteOn, producing a "ghost" off. Defence in depth: clamp at
    the call site too (`Math.max(1, Math.min(127, velocity))`
    inside `triggerNoteOn`).

42. **`Slider` `value={[velocity]}` array allocation.** `:431`. A
    fresh single-element array on every render. Fine perf-wise,
    but if React Compiler does not auto-stabilise it, the Slider's
    internal effect-deps may see a "changed" value every render
    and re-run. Cosmetic.

43. **The barrel chain `presentations/views/index.ts` →
    `VirtualKeyboard.tsx`** is one re-export deep — fine. But
    the missing root `index.ts` (issue #30) means there is no
    sanctioned import path from outside the module.

---

## Priorities

1. **Stuck notes on unmount / panel close / visibility change**
   (issues #1, #35) — clicking Close mid-chord leaves notes
   sustaining indefinitely. Most user-visible failure mode.
2. **Octave shift while holding a key emits noteOff for the wrong
   MIDI** (issue #2) — guaranteed stuck note. Compounds into
   audio-graph state corruption with repeated shifts.
3. **Z/X octave shift fires on key-repeat** (issue #3) — holding
   `x` blasts octave from 4 to 8 in one beat, ruining UX.
4. **Pointer capture breaks glide** (issues #23, #24) — the
   advertised "drag across keys glides" feature does not work
   per W3C spec.
5. **Computer-keyboard mapping uses `event.key` not `event.code`**
   (issue #8) — broken for non-QWERTY layouts.
6. **Tests cover render smoke only; no behavioural coverage**
   (issue #28) — every fix above lands without test enforcement.
7. **No root `index.ts` at module level** (issues #30, #34) —
   cross-module imports are non-conformant; the module has no
   sanctioned public surface.
8. **`buildBlackKeys` emits keys above C8** (issue #17) — visual
   junk (floating black keys past the right edge).
9. **Octave display ↔ active range disagreement** (issue #19) —
   silent off-by-one between displayOctave and `virtualKeyboardOctave`.
10. **`as any` and `as WorkspaceState` escapes** (issues #26, #27,
    #40) — AGENTS.md soundness violations.

---

## Open issues

### 1. Stuck notes on component unmount, panel close, and tab visibility change

**Problem:** No effect cleanup releases notes held in `pressedNotes`
when the component unmounts (parent panel close, route change), and
no `document.visibilitychange` listener releases held keyboard /
pointer notes when the user Cmd-Tabs away. The only release paths
are `onBlur` (panel-focus blur), the global `pointerup` (mouse
release anywhere), and per-key `keyup`. None of these run when:

- The user clicks the panel's Close button mid-chord (component
  unmounts; `onBlur` may not fire before unmount; no cleanup
  effect releases held notes).
- The browser tab is hidden / Cmd-Tabbed (no `keyup` events fire
  for held keys; the next focus restores stale `heldKeys` entries).
- A parent toggles `display: none` on the panel.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:273-282`
  (only effect, only handles global pointerup)
- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:336-343`
  (`onBlur` does the release work but only fires on focus loss)
- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:373`
  (close button fires `onClose` directly without panel blur)

**Needed:** Add a `useEffect(() => () => { releaseAll(); }, [])`
cleanup that fires `triggerLiveNoteOff` for every entry in
`pressedNotes` (read via a ref, since the closure cannot see the
latest `pressedNotes` state). Add a
`document.addEventListener('visibilitychange', () => { if
(document.hidden) { releaseAll(); heldKeys.current.clear(); } })`
side-effect. Add a `window.addEventListener('blur', releaseAll)`
listener (for Cmd-Tab).

### 2. Octave shift during a held note emits noteOff for the wrong MIDI

**Problem:** `onKeyDown` for `z`/`x` shifts the active octave
without first releasing held notes. The corresponding `keyup` later
computes the noteOff target as `(newOctave) * 12 + semi`, which is
`±12` semitones away from the original noteOn. The audio engine
ignores the spurious noteOff (no matching noteOn), and the original
noteOn is leaked.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:292-301`
  (z/x branches mutate octave; do not release `pressedNotes`)
- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:321-334`
  (`onKeyUp` reads current `octave`)

**Needed:** Before dispatching the octave change, release every
note in `pressedNotes` whose source was the computer keyboard.
Either:

- (a) release everything in `pressedNotes` (simplest, but kills
  any sustained mouse note the user is holding while pressing
  z/x); or
- (b) track per-note origin (`'mouse' | 'keyboard'`) and release
  only keyboard-origin notes; or
- (c) record `(midi, originatingOctave)` pairs in `heldKeys` so
  the keyup can use the original octave to compute the correct
  noteOff MIDI.

### 3. Z/X octave shift fires on OS key-repeat

**Problem:** `onKeyDown` for `z`/`x` does not check `event.repeat`
or use `heldKeys` to suppress repeats. Holding `x` shifts octave
~30 times per second; the bound clamps at 8 but the user blasts
through the range instantly. Same applies to `z`. The `heldKeys`
guard at `:303-305` is below the z/x branches and never reached.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:292-301`

**Needed:** Either (a) add `if (event.repeat) return;` at the top
of `onKeyDown`; or (b) move `heldKeys.has(key)` check above the
z/x branches and include `z`/`x` in `heldKeys` tracking; or
(c) add a per-octave-shift cooldown.

### 4. Pointer capture conflicts with cross-key glide; behaviour cross-browser-inconsistent

**Problem:** `setPointerCapture(event.pointerId)` on white-key
pointerdown (`:219`) redirects `pointermove` to the captured
element. Whether `pointerenter`/`pointerleave` fire on sibling keys
during capture is browser-dependent (older Chromium did not; newer
builds may, per the PointerEvents L3 boundary-events redispatch
behaviour). The result is that the advertised glide ("Drag across
keys glides", `:8`) is fragile across browsers. Even when
`pointerenter` fires, white→black and black→white glide is
broken because the capture target's z-stacking and event routing
do not let the black-key pointerenter run consistently.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:217-226,244-253`
  (set capture)
- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:236-242,264-270`
  (glide handlers, never fire while capture is active)

**Needed:** Remove `setPointerCapture` and instead implement a
single `pointermove` listener on the wrapper that hit-tests against
the current pointer position to determine which key is active. This
is the standard pattern for piano-keyboard glissando. As a side
effect this also fixes the white→black and black→white glide
(currently broken regardless).

### 5. Computer-keyboard map uses `event.key`, broken for non-QWERTY layouts

**Problem:** `KEYBOARD_WHITE_MAP` / `KEYBOARD_BLACK_MAP` are keyed
on `event.key.toLowerCase()`, which is layout-dependent. AZERTY
users pressing the physical key in QWERTY's `a` position get
`event.key === 'q'`, which is unmapped. The keyboard surface is
silently broken for any non-QWERTY layout.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:135-156`
  (key→semitone maps)
- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:290,322`
  (`event.key.toLowerCase()`)

**Needed:** Switch to `event.code` (`KeyA`, `KeyW`, etc.). Map
physical positions, not layout-dependent labels. This is the same
choice every DAW (Logic, Ableton, Reaper) makes.

### 6. Tests cover render smoke only — no behavioural assertions

**Problem:** The 11 tests in `VirtualKeyboard.spec.tsx` assert that
the HTML scaffold mounts. None test:

- That a pointerdown on a white key calls `triggerLiveNoteOn` with
  the correct MIDI for the active octave.
- That a keyboard `a` keydown plays C of the active octave.
- That `onBlur` releases held notes.
- That key-repeat is suppressed.
- That Z/X shifts octave (and that octave-during-hold behaves
  correctly per issue #2).
- That the global pointerup releases mouse notes.
- That black keys hit-test correctly (no z-order regression).
- That octave-bound buttons disable at min/max.
- That the velocity slider sets velocity.
- Stuck-note prevention on unmount, blur, visibility change.

The test mocks also point at deep paths (`#/modules/AudioEngine/useCases/triggerLiveNoteOn`)
when production imports from the barrel (`#/modules/AudioEngine/useCases`),
which may cause the mocks not to bind (same failure mode as
`AudioAnalysis.md` issue #2).

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/__tests__/VirtualKeyboard.spec.tsx`
  (entire file — 143 lines, 11 tests, 0 behavioural)

**Needed:** Add behavioural tests:

1. `triggerLiveNoteOn` mock asserts `(0, 60, 100)` after a
   pointerdown on the C4 key at default octave 4.
2. `onKeyDown` for `a` triggers `(0, 48 + 12*octave, velocity)`.
3. Holding `a` (multiple keydown events) calls `triggerLiveNoteOn`
   exactly once (key-repeat suppression).
4. `keyup` for `a` triggers `triggerLiveNoteOff` exactly once.
5. `onBlur` releases all entries in `pressedNotes`.
6. Z/X press calls `setVirtualKeyboardOctave(octave ± 1)`.
7. Z key with held `a` releases `a`'s noteOn before mutating
   octave.
8. Component unmount releases held notes.

Fix the mock paths to target the barrels (or use `vi.mock` of the
specific path that matches the production import).

### 7. No root `index.ts`; consumers reach in via `#/modules/VirtualKeyboard/presentations/views`

**Problem:** `src/modules/VirtualKeyboard/` contains
`events/index.ts`, `presentations/views/index.ts`,
`useCases/index.ts` — but no `src/modules/VirtualKeyboard/index.ts`.
The only cross-module consumer (`Workspace/AppShell.tsx:65`) reaches
in via `#/modules/VirtualKeyboard/presentations/views` — a deep
cross-module import that violates AGENTS.md's "Cross-module imports
MUST only target the destination module's root `index.ts`. Deep
imports into … `presentations/views/` … are forbidden." If
`pnpm deps:validate` is not flagging this, the rule has a hole.

**Representative files:**

- `src/modules/VirtualKeyboard/` (no `index.ts` at root)
- `src/modules/Workspace/presentations/views/AppShell.tsx:65,752`
  (consumer reaching deep)

**Needed:** Add `src/modules/VirtualKeyboard/index.ts` that
re-exports `VirtualKeyboard` from `./presentations/views`. Update
`AppShell.tsx:65` to
`import { VirtualKeyboard } from '#/modules/VirtualKeyboard';`. Run
`pnpm deps:validate`; if it did not catch this previously, file a
follow-up to tighten the lint rule.

### 8. `buildBlackKeys` renders black keys above C8

**Problem:** The loop iterates `oct = 0…8` adding C#/D#/F#/G#/A#
for each. For `oct = 8` (the C8 octave), MIDI 109 (C#8), 111 (D#8),
114 (F#8), 116 (G#8), 118 (A#8) all pass the `< 0 || > 127` filter
and are rendered. But there is no white key after C8 to anchor them
visually — they appear as floating black bars past the right edge
of the keyboard. The white-key loop emits `TOTAL_WHITE_KEYS = 64`
which stops at C8. The black-key loop overshoots by 5 keys.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:108-123`

**Needed:** Tighten the filter to `midi > 108` or restrict the loop
to `oct < TOTAL_OCTAVES && oct !== 8` (or special-case the last
octave to skip black keys past C8).

### 9. Active octave 0 maps to displayed C0; C-1 keys are unreachable from the keyboard

**Problem:** `setVirtualKeyboardOctave` clamps to `[0, 8]`. The
display-octave-to-keyboard math (`octave * 12 + semi`) at
`octave = 0` → C0 = MIDI 12 to E1 = MIDI 16. The C-1 octave
(MIDI 0–11) is rendered as white/black keys but cannot be the
"home row" — the computer keyboard cannot play them. Also,
`octaveToFirstWhiteIdx(0) = 7` (C0), so the scroll-to-active-octave
behaviour skips the leftmost octave entirely. The discrepancy is
silent.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:103-106,311,317`
- `src/modules/Workspace/useCases/togglePanel/panelToggles/setVirtualKeyboardOctave.ts:4`

**Needed:** Decide: (a) drop C-1 from the rendered range
(`TOTAL_OCTAVES = 8`, total whites = 57); or (b) widen the
`virtualKeyboardOctave` clamp to `[-1, 8]`. Document the choice
and add a test that the computer keyboard plays MIDI 0 (or asserts
the chosen lower bound).

### 10. `as WorkspaceState` cast hides missing fields

**Problem:** `defaultWorkspaceState` (`:127-130`) is a partial that
fills only `virtualKeyboardOctave` and `virtualKeyboardVelocity`
but is cast `as WorkspaceState`. The full `WorkspaceState` type has
many more fields (panel toggles, BPM, time signature, etc.). The
cast erases the soundness check.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:127-130`

**Needed:** Either import the canonical `defaultWorkspaceState`
from `Workspace/useCases` (the real default has all fields) or
narrow the local default's type to
`Pick<WorkspaceState, 'virtualKeyboardOctave' | 'virtualKeyboardVelocity'>`
and have the `useStore` selector consume only the picked fields.

### 11. Test file uses `any` for prop types

**Problem:** `__tests__/VirtualKeyboard.spec.tsx:32, 60, 74` typing
mock prop signatures as `any`. AGENTS.md "TypeScript — soundness"
forbids `any` outside an immediately-narrowed boundary.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/__tests__/VirtualKeyboard.spec.tsx:32,60,74`

**Needed:** Replace with the actual prop types from each component
(`ComponentProps<typeof Button>`, etc.) or build typed mock
factories.

### 12. Pointer-capture-induced glide breakage; pointerLeave not handled

**Problem:** Combined hazard from issues #4 and #25. The advertised
"drag across keys glides" feature does not work because
`setPointerCapture` blocks `pointerenter` to non-capture targets.
`pointerleave` is also not bound. Net behaviour: only the
first-pressed key plays, regardless of where you drag.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:217-226,236-242,244-253,264-270`

**Needed:** Refactor pointer handling to a single wrapper-level
`pointermove` listener that does hit-testing. Drop
`setPointerCapture` per-key. Maintain a single `mouseNote.current`
that updates as the pointer moves over keys. Bind `pointercancel`
and `pointerleave` on the wrapper for cleanup.

### 13. Hard-coded velocity; no per-click velocity modulation

**Problem:** `triggerLiveNoteOn(0, midi, velocity)` always passes
the slider value. Real DAW keyboards modulate by click-y-position
(top of key = soft, bottom = hard). The component's docstring
promises "Logic Pro–style" behaviour — this is the most visible
gap.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:188-201`
- (Comment at `:1-12`)

**Needed:** Compute velocity as a function of click position
within the key bounding box (clientY relative to key top/bottom).
Honour the slider value as the maximum velocity (so the slider is
"max velocity" when clicking at the bottom edge). Document the
mapping.

### 14. `role="application"` + `role="button"` on each key without keyboard activation

**Problem:** The panel uses `role="application"` (`:359`) which
removes screen-reader virtual cursor; combined with `role="button"`
on every key (`:500`, `:540`) without `tabIndex` and without
`onKeyDown` handlers for `Enter`/`Space` activation, the keys
appear in the AT tree but are unreachable. Black-key labels are
just `MIDI ${n}` (no pitch class). White-key non-C labels are also
opaque.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:354-360,499,539`

**Needed:** Either:

- (a) Remove `role="application"` and let the keys be plain
  `<button>` elements with proper `aria-label` and `Enter`/`Space`
  activation; or
- (b) Implement a single composite-keyboard model per WAI-ARIA APG
  with roving tabindex; or
- (c) Mark the keys `role="presentation"` and document that the
  keyboard is mouse-only, with the computer-keyboard surface as
  the AT-friendly path (then ensure the inline hint and labels
  expose the mapping).

Black-key labels should disclose pitch class:
`C#${displayOctave}` etc.

### 15. Test mocks point at deep paths instead of barrels

**Problem:** `vi.mock('#/modules/AudioEngine/useCases/triggerLiveNoteOn', ...)`
mocks the deep file. Production imports from
`#/modules/AudioEngine/useCases` (the barrel). Vitest mocks per
exact module-id; depending on resolver config the barrel re-export
may or may not pick up the mock. Same failure mode as
`AudioAnalysis.md` issue #2.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/__tests__/VirtualKeyboard.spec.tsx:14,18,22,26`

**Needed:** Mock the same path that production imports from
(`#/modules/AudioEngine/useCases`, `#/modules/Workspace/useCases`).
Verify by adding a test that asserts `triggerLiveNoteOn` is called
— which will fail today if the mock does not bind.

### 16. `event.currentTarget as HTMLDivElement` redundant cast

**Problem:** `:219` casts `event.currentTarget` to `HTMLDivElement`
even though the event is typed `React.PointerEvent<HTMLDivElement>`,
making `currentTarget` already `HTMLDivElement`. Dead cast.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:219`

**Needed:** Remove the cast.

### 17. `pressedNotes` re-renders the entire keyboard on every press

**Problem:** Every `triggerNoteOn` / `triggerNoteOff` mutates
`pressedNotes` via `setPressedNotes`. The full keyboard re-renders;
each of 64 white keys + ~50 black keys reads `pressedNotes.has`.
Same issue addressed for PianoRoll in commit `d2c899dce`. Not
catastrophic at typical interaction rates, but visible jank when
striking chords on lower-end machines.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:172,193-200,205-212,460-545`

**Needed:** Either subscribe each key to a per-key store slice via
the same pattern PianoRoll uses, or split `pressedNotes` into a
separate state used only by a child memoised list. The simplest
fix: a `Map<midi, ReactRef>` that updates only the affected key's
DOM via direct `dataset` mutation — but that breaks the React
model. The cleaner fix follows PianoRoll's `useStoreSelector`
pattern.

### 18. `BLACK_KEY_FRACS` enumeration ordering is implicit

**Problem:** `Object.entries(BLACK_KEY_FRACS)` (`:112`) relies on
JS engine integer-key enumeration order. Works today, but a
typed array of `{ semi, frac }` objects with explicit ordering is
clearer.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:77-83,108-123`

**Needed:** Replace `Record<number, number>` with
`readonly { semi: number; frac: number }[]`. Marginal — list as a
"clean up while you're here" item.

### 19. No tests for layout math (`whiteIdxToMidi`, `buildBlackKeys`)

**Problem:** The hit-zone geometry is pure math but private to the
component file, so untestable without exporting. A regression in
`BLACK_KEY_FRACS` (e.g. a digit typo in `1.67`) would shift
hit-zones silently; same for `octaveToFirstWhiteIdx`.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:85-125`

**Needed:** Extract `whiteIdxToMidi`, `octaveToFirstWhiteIdx`, and
`buildBlackKeys` into a sibling module `keyboardLayout.ts` (per
AGENTS.md "Services layer (`services/`)" — pure helpers).
Re-export to `VirtualKeyboard.tsx`. Add `__tests__/keyboardLayout.spec.ts`
with table-driven tests:

- `whiteIdxToMidi(0) === 0` (C-1 = MIDI 0).
- `whiteIdxToMidi(35) === 60` (C4 = MIDI 60).
- `whiteIdxToMidi(63) === 108` (C8 = MIDI 108).
- `buildBlackKeys()` length is 35 (5 black per octave × 7
  full + 0 trailing) **after** fixing issue #8.
- All black keys have `midi >= 1 && midi <= 106` after fix.

### 20. Octave Z/X dispatch fires `preventDefault` even at bounds

**Problem:** Pressing Z at `octave === 0` calls
`setVirtualKeyboardOctave(-1)` (clamped no-op) but
`event.preventDefault()` runs first, consuming the keypress from
any parent handler. Same at `octave === 8` for X.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:292-301`

**Needed:** Guard the dispatch on `octave > 0` / `octave < 8`
before calling `preventDefault`. Or accept that the keyboard panel
has exclusive ownership of Z/X while focused (current behaviour),
and document.

### 21. `Slider` `value={[velocity]}` allocates a new array per render

**Problem:** `:431`. A fresh single-element array on every render.
React Compiler may stabilise it, but if the underlying Radix slider
uses the prop in an effect dependency, every render causes a
re-run.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:430-446`

**Needed:** Hoist to a stable reference if the Compiler does not
auto-stabilise. Trivial.

### 22. `Slider`'s `onValueChange` falls through `nextValue !== undefined` check that is always true for Radix

**Problem:** `:441-444` `const nextValue = values[0]; if (nextValue
!== undefined) setVirtualKeyboardVelocity(nextValue);`. Radix
slider always emits a single-element array for a single-thumb
slider. The undefined check is defensive but never triggers.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:440-445`

**Needed:** Drop the guard or replace with an `assertDefined`
helper. Cosmetic.

### 23. Computer-keyboard handling does not exclude held shift / repeat

**Problem:** `event.shiftKey` is not in the modifier bail (`:287`).
Pressing `Shift+a` plays C as if shift was not held. Inconsistent
with `Cmd+a` which is correctly excluded. Also, `event.repeat`
is not consulted — handled redundantly by `heldKeys` for note keys
but not for z/x (issue #3).

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:286-290`

**Needed:** Add `if (event.shiftKey || event.repeat) return;` at
the top, or include `shiftKey` in the modifier list; remove the
redundant `heldKeys` repeat-suppression.

### 24. `defaultWorkspaceState` lives inside the view file

**Problem:** `:127-130`. A presentation file declaring a
`WorkspaceState` default is a layering inversion. Workspace owns
the state; the view should consume the canonical default.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:127-130`

**Needed:** Import `defaultWorkspaceState` from `Workspace`'s
public surface. (Or, since `useStore`'s second arg is just a
fallback for un-hydrated stores, build the picked-fields default
locally with explicit type.)

### 25. The advertised "Logic Pro–style" docstring oversells

**Problem:** `:1-12` claims Logic Pro–style behaviour. The actual
behaviour is missing: velocity-from-y, glide (broken per #4),
keyboard layout independence (broken per #5), screen-reader
operability (broken per #14). This is a documentation/expectation
mismatch that should be fixed alongside the implementation.

**Representative files:**

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:1-12`

**Needed:** After implementing the missing features, the docstring
is accurate. Until then, narrow it to "minimal on-screen MIDI
keyboard" so reviewers do not assume the missing behaviour exists.

---

## Open questions

- [ ] Does the `#/modules/VirtualKeyboard` import in
      `Workspace/AppShell.tsx` resolve to a real module without a
      root `index.ts`? (Bundler config may be picking up the
      `presentations/views/index.ts` via some alias rule.)
- [ ] Is `triggerLiveNoteOff` idempotent on the AudioEngine side?
      If not, double-fires from StrictMode dev mounts and from the
      `onBlur` + global pointerup overlap (issue #5) could produce
      audible artifacts.
- [ ] Is there a global "panic" / "all-notes-off" use case we
      should call from cleanup paths instead of iterating
      `pressedNotes` (which may have drifted from the audio graph
      truth)?
- [ ] What does `tsconfig.json` say about resolving
      `#/modules/VirtualKeyboard`? Path alias rule needed to verify
      issue #7.
- [ ] Should the velocity-from-y mapping replace the slider, or
      complement it (slider as max velocity)?
- [ ] Should Cmd/Ctrl/Alt+Z still be reserved for the global undo
      shortcut even when the panel has focus? Currently any
      modifier bails (no note fires; no octave shift), which is
      correct; verify.

---

## Risks

- **Stuck notes are the most user-visible failure.** A panel-close
  mid-chord leaves a sustained note in the audio graph forever (or
  until the user manually re-triggers the same MIDI to release it).
  In a session with hundreds of clicks the engine's voice pool can
  fill with phantom notes, eventually exhausting voices.
- **Octave-shift-during-hold corrupts audio-graph state.** Each
  shift while holding emits a noteOff for the wrong MIDI, leaving
  the original noteOn sustained. Combined with `onBlur` clearing
  `pressedNotes` (a JS-side set, not an audio-graph state), the
  view's notion of "what is playing" diverges from reality.
- **Non-QWERTY users cannot use the computer keyboard.** Silent
  internationalisation regression — no error, just no notes.
- **Glide does not work.** Users expecting drag-glissando get
  single-key clicks. The docstring advertises the feature.
- **Tests do not catch any of the above.** A refactor that breaks
  noteOn dispatch will pass the existing 11 tests because none
  assert `triggerLiveNoteOn` was called.
- **Module without a root `index.ts` is at the edge of bundler
  resolution.** A future `tsconfig.json` change (e.g. switching
  `moduleResolution`) could break `<VirtualKeyboard>` imports
  silently. The dependency graph contract is undefined.
- **Accessibility:** screen-reader users cannot meaningfully
  interact with the keyboard. The `role="application"` +
  `role="button"` mismatch creates an AT tree of unreachable
  buttons.

---

## Suggested approaches

- **Lock down release paths first** (issues #1, #2). Add a
  `releaseAllHeldNotes` ref-stable function. Wire it to: component
  unmount cleanup, `visibilitychange`, `window.blur`, panel `onBlur`,
  z/x octave-shift entry. This single change closes the worst
  user-visible failure mode without touching any other logic.
- **Land behavioural tests next** (issue #6). With release paths
  fixed, write tests that drive pointer events and assert
  `triggerLiveNoteOn` / `triggerLiveNoteOff` mock calls. Use the
  same mock paths the production imports use (the barrels). These
  tests guard every subsequent change.
- **Switch to `event.code` and add `event.repeat` guard** (issues
  #3, #5). Mechanical refactor of two maps; one new guard line.
- **Refactor pointer handling to a single wrapper-level tracker**
  (issue #4 / #12). Replace per-key `pointerdown`/`pointerup`/
  `pointerenter` with a wrapper `pointerdown` + `pointermove` +
  `pointerup` that hit-tests against `elementFromPoint` or against
  a pre-computed key-rect lookup. Drop `setPointerCapture` per-key.
  This also fixes glide between white and black keys, and gives
  velocity-from-y a clean home (`event.clientY` relative to key
  bounds).
- **Extract layout math to `services/keyboardLayout.ts`** (issue
  #19). Pure helpers, table-driven tests. Tightens the
  `buildBlackKeys` overshoot (issue #8) along the way.
- **Decide the octave range** (issue #9). Either drop C-1 or widen
  the clamp. Document.
- **Add the missing module root `index.ts`** (issue #7). One file,
  one re-export.
- **AGENTS.md compliance pass** (issues #10, #11, #16) for
  `as`-cast removal and test-`any` cleanup.
- **Accessibility pass** (issue #14) — separate concern, can land
  independently.

---

## Recommendation

Start with **issue #1 (stuck notes on unmount / visibility change)**
and **issue #2 (octave-shift-during-hold leak)** in a single pass.
These are the user-visible failure modes; the fixes are localised
to a `releaseAllHeldNotes` helper and a few effect / handler
additions. Both can be enforced by a behavioural test added in the
same commit, which doubles as the foundation for **issue #6 (test
coverage)**.

After those land, the next session should tackle **issue #4 (pointer
capture / glide)** — the refactor to wrapper-level pointer tracking
unlocks velocity-from-y (issue #13), fixes glide, and is the right
place to drop `setPointerCapture`. This is the largest single
behavioural improvement available.

The **`event.code` switch (issue #5)** and **the missing root
`index.ts` (issue #7)** are small mechanical fixes that can land
as cleanup commits between the larger pieces.

Accessibility (issue #14) is a separate, independent track.

---

## Resolved

_No issues resolved yet._
