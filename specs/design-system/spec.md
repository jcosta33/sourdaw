---
type: spec
id: SPEC-design-system
title: True-black skeuomorphic design system
status: in-progress
owner: The Sourdaw team
sources:
  - self
---

# True-black skeuomorphic design system

## Intent

Give every Sourdaw surface one shared token set — surface elevation, border tiers, signal
and state colors, pastel accents, typography, and rim-lighting rules — so a new panel,
plugin, or control draws from tokens instead of hand-picked values, on a `#000` canvas where
elevation reads through luminance rather than shadow.

## Non-goals

- Per-plugin visual identity (color assignments, accent palettes per plugin).
- Layout primitives (`Stack`, `Row`, `Grid`).
- Keyboard-shortcut design.
- Accessibility guidelines beyond the contrast targets stated here.

## Requirements

### AC-001 — The token set is defined in theme

Every surface, border, signal, state, accent, and typography value must be defined as a
`@theme` CSS variable in the global stylesheet.

Verify with: `manual` — open `src/styles/main.css` and confirm each surface, border, signal, accent, and typography token resolves

### AC-002 — Surface colors resolve through variables

Every surface-color use in component code must resolve through a CSS variable, with no
hard-coded surface hex in TSX.

Verify with: `manual` — grep TSX sources for raw surface hex literals and confirm none remain

### AC-003 — Elevation reads through luminance and rim light

A raised surface must separate from the canvas through progressively lighter surface tokens
and rim-light borders rather than box-shadows.

Verify with: `manual` — render the component gallery on a #000 canvas and confirm panels separate without box-shadows

### AC-004 — Signal colors follow DAW conventions

Solo, mute, record-arm, playback-active, and selection must each render from the defined
signal tokens (solo amber, mute orange-red, record red, playback green, selection blue).

Verify with: `manual` — toggle each transport/track state and confirm it matches its signal token

### AC-005 — Signal and state contrast meets WCAG AA

Each signal and state color must meet a 4.5:1 contrast ratio against the default surface.

Verify with: `manual` — run a contrast checker on every signal/state token against `--surface-default`

### AC-006 — A gallery demonstrates every token

A component-gallery page must demonstrate every token and skeuomorphic technique in one
place.

Verify with: `manual` — open the component-gallery route and confirm each token and technique is shown

### AC-007 — Each control type carries its design specification

Every control in the inventory — knobs (24/40/72px three-style hybrid with conic-gradient value
arc, 270° sweep, center detent on pan), faders, toggle buttons, LED indicators, transport,
meters, displays, waveform, piano-roll, automation, and spectrum views — must be defined with
its concrete design constraints, not collapsed into a single "show every token" gallery line.

Verify with: `manual` — open the component inventory and confirm every control type lists its style, sizes, states, and gradient/arc recipe

### AC-008 — Faders and sliders follow the physical-throw model

A vertical fader must emulate the 100mm throw as a 160–200px track height with a 4–6px inset
groove, a stacked-gradient metallic cap, a logarithmic dB scale (+12 to -∞ with 0 dB at ~70%
travel), an adjacent green/yellow/red level meter, and horizontal sliders at 80–120px × 6px.

Verify with: `manual` — render a fader and confirm track height, groove inset, dB markings with unity at ~70%, meter thresholds, and horizontal-slider dimensions

### AC-009 — Transport controls follow their spec

Transport controls must use the universal icon set in a full-width bar with monospace LED-style
18–24px BPM/position displays.

Verify with: `manual` — exercise the transport; confirm icon set and display font/size match the spec

### AC-010 — Mouse-first interaction follows the drag and modifier model

Controls must use vertical drag with the cursor hidden via Pointer Lock, 200–300px mapping the
full range and Shift fine mode at 4:1–10:1, faders using relative (not jump-to-click) motion with
a 3–5px drag threshold, plus the cross-DAW modifier conventions (Shift fine, double-click reset
or text entry, Alt/Option reset, scroll-to-adjust) and instant parameter-readout feedback.

Verify with: `manual` — drag a knob and a fader and confirm vertical-drag, pointer-lock cursor hide, sensitivity, relative fader motion, drag threshold, modifier behaviors, and the instant value readout

### AC-011 — Panel layout uses dividers, minimum sizes, and named presets

The panel layout must use draggable dividers with resize-cursor affordance, enforce minimum
panel sizes (≈150–200px sidebars, ≈100px bottom panels), switch views instantly (no animation),
read elevation through the surface tokens with gradient-edge borders, and persist named layout
presets (screensets) as serialized JSON.

Verify with: `manual` — drag a divider to its minimum, switch views, and save/restore a named preset; confirm instant switching, minimum-size enforcement, and persisted JSON

### AC-012 — Skeuomorphic recipes are specified beyond the high-level technique

The system must define the concrete CSS recipes: a 3-layer repeating-linear-gradient brushed-metal
texture, a dark-aluminum panel with asymmetric top/bottom borders, and a consistent top-left
(315°/NW) lighting model exposed as `--light-edge` and `--shadow-edge` custom properties that
inset elements reverse.

Verify with: `manual` — inspect the panel and metal utilities and confirm the brushed-metal layers, asymmetric aluminum borders, and the `--light-edge`/`--shadow-edge` lighting model are present

### AC-013 — Track-color palette and source palettes are defined

The token set must define the 16 representative track colors as hex and the named pastel-accent
tokens (e.g. `--accent-coral #FF5F80`, `--accent-teal #4CB8B8`, `--accent-amber #E0AA2A`), and
record the surveyed source palettes (Bitwig 27-color image extraction, Logic 96-color 24×4 grid)
the selection draws from.

Verify with: `manual` — confirm the 16 track-color hexes and the named accent tokens resolve, and the source-palette survey is recorded

### AC-014 — Typography defines stacks, scale, weight, and text tiers

Typography must specify the exact font stacks (system UI stack + SF Mono monospace stack), the
small-size scale (9px labels, 10–11px values, 12–13px headers, 18–24px transport), font-weight
500 for small-size legibility, and the three text-color tiers (`#E0E0E0` primary, `#999999`
secondary, `#666666` tertiary/disabled).

Verify with: `manual` — confirm the UI and mono font stacks, the four size steps, font-weight 500, and the three text-color tiers resolve from tokens

### AC-015 — Implementation status records what exists and where the gaps live

The spec must record its implementation status: which utilities and tokens exist today
(`daw-panel-surface`/`daw-inset-surface` in `src/styles/main.css`, tokens in `tokens.css`), what is
done well (consistently applied rim-lighting via `@utility`), and a pointer to the not-implemented
and needs-refactoring items.

Verify with: `manual` — read the implementation-status section and confirm it names the existing utilities/tokens, the done-well assessment, and a pointer to the gap inventory

### AC-016 — Level meters follow the named ballistics

Level meters must follow the named ballistics (near-instant attack, 1.5–3s exponential decay,
2s 2px peak-hold, segmented-LED overlay, 4–8px/12–20px widths).

Verify with: `manual` — drive a meter and confirm its ballistics match the spec

### AC-017 — Visualizers render on Canvas with their coloring and scaling

Waveform, piano-roll, and spectrum views must render on Canvas with their stated coloring and
scaling.

Verify with: `manual` — open each visualizer and confirm Canvas rendering, coloring, and scaling match the spec

### AC-018 — Controls expose a right-click context menu, and text entry suppresses single-letter shortcuts

A knob/fader right-click menu must offer Set to Default, Type In Value, Copy Value, Paste Value,
Assign MIDI Controller, and Show Automation Lane; a clip right-click menu must offer Cut, Copy,
Paste, Duplicate, Delete, Rename, Color, Split, Reverse, and Quantize. While a text input is
active (including Type In Value entry), single-letter shortcuts must be suppressed — only
modifier+key shortcuts may fire.

Verify with: `manual` — right-click a knob/fader and a clip and confirm each menu lists its items; focus a text input and confirm single-letter shortcuts do not fire while modifier chords still do

### AC-019 — Parameter feedback follows the stated timing model

Hovering a parameter must update a status-bar readout ("Parameter Name: Value Unit") with zero
delay (Ableton Info-View style); floating tooltips must appear only after a 300–500ms hover
delay; and during an active adjustment the value display must remain visible near the control.

Verify with: `manual` — hover a control and confirm the status bar updates instantly; keep hovering and confirm the tooltip appears after 300–500ms; drag a control and confirm the value display stays visible throughout

### AC-020 — VU-style meters follow symmetrical ballistics distinct from digital peak

A meter rendered in VU mode must use a 300ms symmetrical attack/release that is distinct from the
near-instant digital-peak ballistics in AC-016, smoothed per frame as
`displayValue += (targetValue - displayValue) * smoothingFactor` with an attack factor of
~0.3–0.5 and a release factor of ~0.005–0.01.

Verify with: `manual` — drive a VU-mode meter and confirm its attack and release are symmetrical at ~300ms and visibly slower than the digital-peak meter

### AC-021 — Tailwind/shadcn implementation recipes are specified

The system must define the Tailwind v4 / shadcn implementation recipes: `@utility` definitions for
`panel-raised`, `channel-inset`, and `glow-active` (the last using `color-mix` against
`--glow-color`); the directive that shadcn components are modified directly (copy-paste, not a
dependency) — the Slider replaced by a custom audio fader and Toggle extended with the inverted
press states; `data-[state=on]` selectors for state-dependent styling; and the performance hints
`will-change: transform` plus `contain: layout style paint` on meters, knobs during drag, and the
playhead.

Verify with: `manual` — inspect the stylesheet and confirm the three `@utility` recipes, the `data-[state=on]` usage, and the `will-change`/`contain` hints on meters, knobs, and the playhead are present

### AC-022 — Border-tier and signal/state hexes are pinned to exact values

The three border-tier tokens must resolve to `#1A1A1A` (barely-visible panel edge), `#2A2A2A`
(standard border), and `#383838` (emphasized divider); the five signal/state tokens must resolve
to solo `#F7A738`, mute `#FF6446`, record-arm `#FF4032`, playback-active `#00FF81`, and selection
`#4A90D9`.

Verify with: `manual` — confirm the three border-tier tokens and the five signal/state tokens resolve to exactly these hex values

### AC-023 — Skeuomorphic surfaces carry the anti-banding and motion recipe details

Skeuomorphic surfaces must layer a noise texture at 2–3% opacity over solid dark colors to prevent
color banding, use a generous 4–8px border-radius, and apply 150–300ms easing transitions on hover
states.

Verify with: `manual` — inspect a skeuomorphic surface and confirm the 2–3% noise overlay, the 4–8px border-radius, and the 150–300ms hover transition are present

## Open questions

- [ ] (non-blocking) Whether to expand contrast targets into a fuller accessibility spec later.
- [ ] (non-blocking) (deferred-gap from intake/audit-deferred-fixes.md) Group F — UI render-scoping refactor (ChatPanel split, PianoRoll selectors, layout). This is a React re-render-performance concern adjacent to, but distinct from, this token/control design system — it covers component re-render scoping, not visual tokens. Carry the substantive detail for whoever owns it: (F1, I-16) `ChatPanel` splits into per-message components — extract `MessageItem({ messageId })` that reads `useStoreSelector(chatStore, (s) => s.messages.find((m) => m.id === messageId), (a, b) => a === b)` so only the streaming message re-renders per token; `ChatPanel` subscribes only to the message **list** (id order), and individual content updates do not re-render the panel; markdown parsing is cached via a module-level `Map<string, ReactElement>` keyed by `${messageId}:${content.length}` with simple LRU eviction bounded to ~200 entries. (F2, I-27) `PianoRoll` replaces its two `useStore` calls with three `useStoreSelector` calls — active clip's notes `(s) => s.notesByClipId[activeClipId] ?? EMPTY_NOTES` (stable empty-array sentinel), active clip's CC (same shape), and selected track `(s) => s.tracks.find((t) => t.id === selectedTrackId) ?? null` — each with a shallow-equal `equalityFn`, so editing a note on a different clip does not re-render `PianoRoll`. Acceptance is render-profiling: streaming a 50-message chat re-renders only the streaming `MessageItem` (not `ChatPanel`); editing notes on Clip A while Clip B is active does not re-render `PianoRoll`.

## Affected areas

- `src/styles/main.css` (`@theme` tokens and `@utility` skeuomorphic helpers)
- `src/styles/tokens.css` (typography and base color variables)
- the component-gallery view

## Dropped from sources

- Per-plugin identity assignments — owned by a separate plugin-identity spec.
- Layout primitives and their migration — owned by separate layout-component specs.
- A specific panel-management library choice (Dockview / Golden Layout) — design rationale behind AC-011, not a requirement on the chosen library.
- Keyboard-shortcut conventions (single-letter transport, Cmd/Ctrl chords, 1–9 screenset recall) — interaction design out of token scope. Note: the source's broader "Interaction design patterns for mouse-first control" section (vertical drag, pointer lock, sensitivity, relative fader motion, and the mouse modifier conventions) was wrongly subsumed under this drop; it is restored as AC-010. Only the keyboard-shortcut portion remains dropped.
- The cross-DAW panel-layout survey (Bitwig three-view/Display Profiles, Logic Screensets 1–9, Ableton Session/Arrangement dual-view, Cubase zone system) — background informing AC-011, not a requirement.
