# E2E Coverage Manifest — Sourdaw

> **How to use:** Find the first batch with `[ ]` items. Follow `PROCESS.md`.
> Update status as you complete each item.

---

## Existing Coverage (18 specs — no action needed)

| Spec | Area | Status |
|------|------|--------|
| `smoke.spec.ts` | App bootstrap, title | [x] |
| `project.spec.ts` | New project, template load | [x] |
| `tracks.spec.ts` | Track CRUD (create/rename/duplicate/delete) | [x] |
| `arrangement.spec.ts` | Timeline selection, clip context menu, marquee | [x] |
| `clips.spec.ts` | Clip copy/paste/duplicate/delete | [x] |
| `midiEditor.spec.ts` | MIDI editor open, note creation, chord button | [x] |
| `automation.spec.ts` | Automation lanes (velocity/pitchbend switch) | [x] |
| `transport.spec.ts` | Play/pause/stop, playhead position | [x] |
| `recording.spec.ts` | Record arm/disarm | [x] |
| `commandPalette.spec.ts` | Cmd+K open, search, execute | [x] |
| `devices.spec.ts` | Add device (Grinder), bypass, remove | [x] |
| `devicePanels.spec.ts` | Device panel expand, Amp tab, preset search, inspector toggle | [x] |
| `mixer.spec.ts` | Mute/solo, output routing menu | [x] |
| `browser.spec.ts` | Browser panel toggle, search, close | [x] |
| `library.spec.ts` | Sample import, preview, drag-to-timeline | [x] |
| `export.spec.ts` | Export dialog (Cmd+Shift+E), format toggles | [x] |
| `undo.spec.ts` | Undo history panel, undo button | [x] |
| `workspacePanels.spec.ts` | AI chat, virtual keyboard, session, loop station tabs | [x] |

---

## Gap Analysis — Batches to Complete

### Batch 1: Launch Screen & Project Entry `[DONE — PR #187]`
**Spec:** `launchFlows.spec.ts`
- [x] Template grid — browse templates, filter by category (Film)
- [x] Template load — Lo-fi template loads into workspace
- [x] Demo project — Nebula Drift loads from demo grid
- [x] Back button — grid-to-home navigation
- [x] Recent projects menu — all items verified (New, Template, Demo, Save, Export Audio, Export/Import Project File)
- [x] Close menu with Escape
- [x] Template chooser from menu
- [x] Save project (Cmd+S) — verified localStorage persistence
- [x] Project rename from transport bar
- [ ] Arrangement selector — `[DEFERRED — requires >1 arrangement, selector hidden by default]`
- [ ] Save project dirty indicator — `[BUG: markDirty() not called on addTrack]`
**Bugs found:**
- `markDirty()` (Project module) only called from arrangement operations, NOT from `addTrack`. Adding a track does not set `projectStore.dirty`, so the dirty indicator never appears. The TimelineSurface has a local `markDirty` for canvas redraws only. This may be by design (CRDT autosave handles persistence) or a bug.

### Batch 2: Transport Advanced Controls `[DONE — PR #189]`
**Spec:** `transportAdvanced.spec.ts`
- [x] Metronome toggle + volume slider reveal
- [x] Loop toggle
- [x] Punch in/out toggle
- [x] Count-in toggle + bars cycle (1→2→4→1)
- [x] Auto-scroll toggle (default on)
- [x] Solo mode selector — SIP/AFL/PFL cycling
- [x] Editing tools — Select/Draw/Marquee/Cut switching
- [x] Background capture toggle (round-trip)
- [x] Ripple editing toggle
- [x] Undo button enabled state after action
- [ ] Overdub toggle `[conditionally rendered — needs MIDI track context]`
- [ ] Tempo editor BPM change `[no accessible name on ValueField — needs a11y improvement]`
**Bugs found:** _(none yet)_

### Batch 3: Editing Tools & Timeline Navigation `[PENDING]`
**Spec:** `editingTools.spec.ts`
- [ ] Select tool (S/1)
- [ ] Cut tool (C/2)
- [ ] Draw tool (D/3)
- [ ] Automation tool (4)
- [ ] Stretch tool (T/5)
- [ ] Marquee tool (E)
- [ ] Ripple editing toggle
- [ ] Zoom in/out (= / -)
- [ ] Zoom to fit (F)
- [ ] Zoom to selection (Shift+F)
- [ ] Marker navigation ([ and ])
- [ ] Home/End seek
- [ ] Timeline minimap drag
**Bugs found:** _(none yet)_

### Batch 4: Keyboard Shortcuts `[PENDING]`
**Spec:** `keyboardShortcuts.spec.ts`
- [ ] Add MIDI track (N)
- [ ] Add Audio track (Shift+N)
- [ ] Select all clips (Cmd+A)
- [ ] Duplicate clip to next bar (Alt+D)
- [ ] Duplicate track (Cmd+Shift+D)
- [ ] Set loop from selection (Cmd+L)
- [ ] Delete time range (Cmd+Backspace)
- [ ] Insert silence (Cmd+Shift+I)
- [ ] Toggle sidebar (Cmd+B)
- [ ] Toggle inspector (Cmd+I)
- [ ] Toggle mixer (Cmd+M)
- [ ] Toggle track list (Cmd+T)
- [ ] Toggle virtual keyboard (Cmd+Shift+K)
- [ ] Toggle automation panel (Cmd+Shift+A)
- [ ] Shortcut cheat sheet (?)
- [ ] Preferences (Cmd+,)
**Bugs found:** _(none yet)_

### Batch 5: Inspector — Track Properties `[PENDING]`
**Spec:** `inspectorTrack.spec.ts`
- [ ] Rename track in inspector
- [ ] Track color picker
- [ ] Track gain slider
- [ ] Track pan slider
- [ ] Input monitoring mode cycle
- [ ] Arm/disarm track
- [ ] Mute/solo from inspector
- [ ] Audio input device selector
- [ ] MIDI output destination
- [ ] Follow chord track toggle
- [ ] Device chain — add, bypass, open editor, remove
- [ ] Automation lane — add, show/hide, remove
- [ ] VCA group — create, select
- [ ] Track alternatives — create, set active, flatten comp
- [ ] Track notes textarea
- [ ] Sends to bus — add, toggle pre/post fader
**Bugs found:** _(none yet)_

### Batch 6: Inspector — Clip Properties `[PENDING]`
**Spec:** `inspectorClip.spec.ts`
- [ ] Rename clip
- [ ] Trim clip start/end
- [ ] Fade in/out duration
- [ ] Clip gain
- [ ] Clip color picker
- [ ] Gain envelope — enable, add breakpoint, remove, reset
- [ ] Clip AI section (TTS/singing) `[may need model — skip if unavailable]`
- [ ] Clip audio AI section (denoise) `[may need model — skip if unavailable]`
**Bugs found:** _(none yet)_

### Batch 7: Mixer Advanced `[PENDING]`
**Spec:** `mixerAdvanced.spec.ts`
- [ ] Channel width cycle
- [ ] Mixer snapshot — save, recall, rename, delete
- [ ] AI Mix Health Analysis dialog
- [ ] Expanded channel strip popup (solo-safe, rename, VCA, remove)
- [ ] Master channel strip interaction
- [ ] Fader drag changes gain
**Bugs found:** _(none yet)_

### Batch 8: Bottom Dock — Routing & Analysis `[PENDING]`
**Spec:** `bottomDockRoutingAnalysis.spec.ts`
- [ ] Routing matrix tab — view, interact
- [ ] Routing graph view
- [ ] Analysis tab — LUFS meter visible
- [ ] Analysis tab — spectrum analyzer visible
- [ ] Analysis tab — spectrogram visible
- [ ] Analysis tab — oscilloscope visible
- [ ] Analysis tab — phase correlation visible
- [ ] Analysis tab — goniometer visible
- [ ] Analysis tab — spatial panner visible
**Bugs found:** _(none yet)_

### Batch 9: Bottom Dock — Setlist & Loop Station `[PENDING]`
**Spec:** `bottomDockSetlistLoops.spec.ts`
- [ ] Setlist — add item, move up/down, remove
- [ ] Setlist — auto-advance toggle
- [ ] Setlist — count-in bars
- [ ] Loop station — arm/disarm
- [ ] Loop station — create slot row
- [ ] Loop station — record/overdub slot
- [ ] Loop station — play/stop slot
- [ ] Loop station — undo last layer
- [ ] Loop station — clear slot
- [ ] Loop station — stop all loops
- [ ] Loop station — fixed loop length input
- [ ] Loop station — keyboard pads (QWERTY)
**Bugs found:** _(none yet)_

### Batch 10: Bottom Dock — Modulation, Automation & Elastic `[PENDING]`
**Spec:** `bottomDockModElastic.spec.ts`
- [ ] Modulation matrix tab — view, add modulation row
- [ ] Automation tab (bottom dock) — view
- [ ] Elastic tab — visible only with audio clips
- [ ] Elastic editor — tool buttons
- [ ] Elastic editor — detect button
- [ ] Elastic editor — quantize button
- [ ] Elastic editor — waveform canvas
**Bugs found:** _(none yet)_

### Batch 11: Virtual Keyboard & Chord Track `[PENDING]`
**Spec:** `keyboardChord.spec.ts`
- [ ] Virtual keyboard — play note (click key)
- [ ] Virtual keyboard — octave up/down
- [ ] Virtual keyboard — note velocity slider
- [ ] Virtual keyboard — QWERTY input (A=C, W=C#, etc.)
- [ ] Virtual keyboard — close
- [ ] Chord track lane — visible in arrange view
- [ ] Chord picker popover — add chord
**Bugs found:** _(none yet)_

### Batch 12: Instrument Panels — Synths & Samplers `[PENDING]`
**Spec:** `instrumentPanelsSynths.spec.ts`
- [ ] Fermenter panel — open via track with Fermenter, macro knobs, preset
- [ ] Toaster panel — kit search, pad trigger, step sequencer
- [ ] Levain panel — instrument search, family filter, engine ready status
- [ ] Crumbs (Sampler) panel — waveform display, pad grid, slice overlay
- [ ] GrandBoule panel — interactive piano, velocity histogram
**Bugs found:** _(none yet)_

### Batch 13: Instrument Panels — Effects `[PENDING]`
**Spec:** `instrumentPanelsEffects.spec.ts`
- [ ] Gluten panel — preset search, transfer curve, GR meter, gain reduction history
- [ ] Bacteria panel — preset search, node graph editor, XY morph pad
- [ ] Grinder panel — tone stack response, speaker preview, preset search, pedal move
- [ ] Proof panel — EQ response, loudness history, tonal balance, chain order
- [ ] Scoring panel — needle/strobe tuner display, pitch history, display mode
- [ ] Yeast panel — step pattern editor, keyboard split
- [ ] Crust panel — saturation toggle, gain strip, meters, waveform display
- [ ] Dutch Oven (ProofChamber) panel — IR browser `[TAURI-ONLY — skip if no IRs]`
**Bugs found:** _(none yet)_

### Batch 14: AI Features `[PENDING]`
**Spec:** `aiFeatures.spec.ts`
- [ ] Generative AI panel — toggle via Generate button
- [ ] Generative AI — genre grid, mood grid, instrument grid
- [ ] AI leader key (G then D/M/C/B) — trigger generation
- [ ] Voice command overlay — hold V key
- [ ] AI change toast — appears after AI action
- [ ] AI action history panel — view history
- [ ] Mix analysis panel — issues list, suggestions list
- [ ] Model manager panel — download/remove `[may need network — skip if offline]`
- [ ] Capability report panel — re-detect capabilities
**Bugs found:** _(none yet)_

### Batch 15: Collaboration & Preferences `[PENDING]`
**Spec:** `collabPreferences.spec.ts`
- [ ] Collaboration panel — open from status bar toggle
- [ ] Collaboration panel — QR code visible, invite code visible
- [ ] Collaboration panel — close
- [ ] Preferences dialog — open via Cmd+,
- [ ] Preferences dialog — navigate tabs (Audio, MIDI, Appearance, etc.)
- [ ] Preferences dialog — close
- [ ] Ableton Link — enable/disable toggle
- [ ] Branch manager dialog `[CRDT — may need project with branches]`
**Bugs found:** _(none yet)_

### Batch 16: Audio Clip Ops, MIDI Advanced & Adjustment Layers `[PENDING]`
**Spec:** `audioMidiAdjustment.spec.ts`
- [ ] Audio clip — normalize via context menu
- [ ] Audio clip — reverse via context menu
- [ ] Audio clip — strip silence via context menu
- [ ] MIDI editor — velocity lane interaction
- [ ] MIDI editor — CC lane
- [ ] MIDI editor — pressure lane
- [ ] MIDI editor — probability lane
- [ ] MIDI transforms — humanize, invert, quantize lengths (via menu/toolbar)
- [ ] Adjustment layer — add layer, configure fade in/out
- [ ] Marker lane — add marker, marker color
- [ ] Session view — scene/grid interaction
- [ ] Onboarding tour — arrow navigation, dismiss
- [ ] Notification toast — appears and dismisses
- [ ] Status bar — metrics visible (CPU/MEM/sample rate)
- [ ] Mobile gate — shows blocked message on mobile viewport
**Bugs found:** _(none yet)_

---

## Session Log

| Session | Date | Batch | Status | PR |
|---------|------|-------|--------|----|
| 1 | 2026-07-10 | Setup (PROCESS.md + COVERAGE.md) | Done | _(n/a — committed to main)_ |
| 2 | 2026-07-10 | Batch 1: Launch & Project Flows | Done — merged | [#187](https://github.com/jcosta33/sourdaw/pull/187) |
| 3 | 2026-07-10 | Batch 2: Transport Advanced | Done — merged | [#189](https://github.com/jcosta33/sourdaw/pull/189) |
| 4 | 2026-07-11 | Batch 3: Timeline Navigation | Done — merged | [#190](https://github.com/jcosta33/sourdaw/pull/190) |
| 5 | 2026-07-11 | Batch 4: Keyboard Shortcuts | Done — merged | [#191](https://github.com/jcosta33/sourdaw/pull/191) |
| 6 | 2026-07-11 | Batch 5: Inspector — Track | Done — merged | [#192](https://github.com/jcosta33/sourdaw/pull/192) |
| 7 | 2026-07-11 | Batch 6: Inspector — Clip | Done — merged | [#193](https://github.com/jcosta33/sourdaw/pull/193) |
| 8 | 2026-07-11 | Batch 7: Mixer Advanced | Done — merged | [#194](https://github.com/jcosta33/sourdaw/pull/194) |
| 9 | 2026-07-11 | Batch 8: Routing & Analysis | Done — merged | [#195](https://github.com/jcosta33/sourdaw/pull/195) |
| 10 | 2026-07-11 | Batch 9: Setlist & Loop Station | Done — merged | [#196](https://github.com/jcosta33/sourdaw/pull/196) |
| 11 | 2026-07-11 | Batch 10: Modulation & Elastic | Done — merged | [#197](https://github.com/jcosta33/sourdaw/pull/197) |
| 12 | 2026-07-11 | Batch 11: Virtual Keyboard | Done — merged | [#198](https://github.com/jcosta33/sourdaw/pull/198) |
| 13 | 2026-07-11 | Batch 12: Instrument Panels | Done — merged | [#199](https://github.com/jcosta33/sourdaw/pull/199) |
| 14 | 2026-07-11 | Batch 13: Effects Panels | Done — merged | [#200](https://github.com/jcosta33/sourdaw/pull/200) |
| 15 | 2026-07-11 | Batch 14: AI Features | Done — merged | [#201](https://github.com/jcosta33/sourdaw/pull/201) |
| 16 | 2026-07-11 | Batch 15: Collab & Preferences | Done — merged | [#202](https://github.com/jcosta33/sourdaw/pull/202) |
| 17 | 2026-07-11 | Batch 16: Audio/MIDI Misc | Done — merged | [#203](https://github.com/jcosta33/sourdaw/pull/203) |
| 18 | 2026-07-11 | Additional UI gaps | Done — merged | [#204](https://github.com/jcosta33/sourdaw/pull/204) |
| 19 | 2026-07-11 | Bug fix: markDirty on track add | Done — merged | [#205](https://github.com/jcosta33/sourdaw/pull/205) |
| 20 | 2026-07-11 | A11y: aria-labels for tempo/ruler/scrollbar | Done — merged | [#206](https://github.com/jcosta33/sourdaw/pull/206) |
| 21 | 2026-07-11 | Phase 1: Upgrade 50 A-tests to behavioral | Done — merged | [#210](https://github.com/jcosta33/sourdaw/pull/210) |
| 22 | 2026-07-11 | Phase 3: Cover 126 uncovered elements | Done — merged | [#214](https://github.com/jcosta33/sourdaw/pull/214) |
| 23 | 2026-07-11 | Phase 4-5: Dynamic elements, error/edge cases | Done — merged | [#215](https://github.com/jcosta33/sourdaw/pull/215) |
| 24 | 2026-07-11 | Phase 6: Fix 2 flaky tests | Done — pushed to main | _(direct)_ |
| 25 | 2026-07-11 | Remaining element coverage | Done — merged | [#219](https://github.com/jcosta33/sourdaw/pull/219) |
| 26 | 2026-07-11 | Deep coverage: modulator/setlist/AI/takes | Done — merged | [#220](https://github.com/jcosta33/sourdaw/pull/220) |
| 27 | 2026-07-11 | Fix flaky browser scroll test | Done — pushed to main | _(direct)_ |
| 28 | 2026-07-11 | E2E workflows + deep inspector | Done — merged | [#222](https://github.com/jcosta33/sourdaw/pull/222) |
| 29 | 2026-07-11 | Deep interactions: export/palette/MIDI/timeline | Done — merged | [#223](https://github.com/jcosta33/sourdaw/pull/223) |
| 30 | 2026-07-11 | Flow coverage: recording/chords/sessions/panels | Done — merged | [#224](https://github.com/jcosta33/sourdaw/pull/224) |
| 31 | 2026-07-11 | Final batch: shortcut effects, device chains, metrics | Done — merged | [#225](https://github.com/jcosta33/sourdaw/pull/225) |
| 32 | 2026-07-23 | E2E: replace 93 no-op visibility assertions (batch 1) | Done — merged | [#686](https://github.com/jcosta33/sourdaw/pull/686) |
| 33 | 2026-07-23 | fix: keep launch overlay exited once project loads | Done — merged | [#687](https://github.com/jcosta33/sourdaw/pull/687) |
| 34 | 2026-07-23 | Unit: proof presentation gap (analyser hook, tonal balance, limiter) | Done — merged | [#688](https://github.com/jcosta33/sourdaw/pull/688) |
| 35 | 2026-07-23 | E2E: replace 52 no-op visibility assertions (batch 2) | Done — merged | [#689](https://github.com/jcosta33/sourdaw/pull/689) |
| 36 | 2026-07-23 | Unit: TimelineEditor TrackMidiFxSection + DeviceInspector | Done — merged | [#690](https://github.com/jcosta33/sourdaw/pull/690) |
| 37 | 2026-07-23 | E2E: eliminate final 54 no-op visibility assertions (batch 3) | Done — merged | [#692](https://github.com/jcosta33/sourdaw/pull/692) |
| 38 | 2026-07-23 | Unit: YeastPreviewSidecar decision/page/route logic (17 tests) | Done — merged | [#696](https://github.com/jcosta33/sourdaw/pull/696) |
| 39 | 2026-07-23 | Unit: GrooveTemplate + GrooveTemplateState pure logic (80 tests) | Done — merged | [#701](https://github.com/jcosta33/sourdaw/pull/701) |
| 40 | 2026-07-23 | Unit: UndoTree branching + effects DSP bitcrush/feedbackDelay (23 tests) | Done — merged | [#704](https://github.com/jcosta33/sourdaw/pull/704) |
| 41 | 2026-07-24 | Unit: deep SetlistPanel + PresetBrowser + DawPickerRow component specs (60 tests) | Done — merged | [#739](https://github.com/jcosta33/sourdaw/pull/739) |
| 42 | 2026-07-24 | Unit: deep PunchRecordingControls + CrustWaveformDisplay specs (25 tests) | Done — merged | [#740](https://github.com/jcosta33/sourdaw/pull/740) |

---

## Session 2026-07-24 — Presentation-component branch coverage

**Frontier:** the pure-logic and shallow-spec wells were exhausted (PRs #686-#704, 120 deep unit tests). This session pivoted to **React presentation components** with zero or 1-expect smoke specs — components with rich computed-output branches (formatting, conditional rendering, disabled states, canvas paint layers) that were completely untested.

**Procedure:** seed real stores or mock `useStore` so derived render values are genuine; mock mutation use cases to assert callback wiring without DI/undo/CRDT coupling; assert against rendered text, className branches, aria attributes, and (for canvas) recorded 2d-context calls. Every assertion verifies a computed output, state mutation, callback argument, or rejection — no existence-only checks.

### Deep component specs added this session

| Spec | File under test | Tests | Coverage area |
|------|-----------------|-------|---------------|
| `SetlistPanel.spec.tsx` | `SetlistPanel.tsx` (433 LOC, ZERO spec) | 38 | empty-state readout, computed progress (N of M), m:ss formatting + negative clamp, remaining-duration derivation, current-item marker, move-button disabled states + reorder args, auto-advance aria-pressed/variant, count-in spinbutton clamp, name edit commit/blank-reject/escape, per-item autoStop toggle, drag-and-drop reorder (drop/dragOver/dragEnd/no-op guards), row navigation |
| `PresetBrowser.spec.tsx` | `PresetBrowser.tsx` (182 LOC, 1 expect) | 17 | search filter (name + tag), category narrow + tag reset, user-patches derivation + tag-bar hide, tag toggle on/off + highlight, Fermenter prefix strip, empty-state, active-pill inline color (incl. lavender fallback), current-preset highlight, onLoadPreset callback, footer count |
| `DawPickerRow.spec.tsx` | `DawPickerRow.tsx` (111 LOC, 2 expects) | 17 | element-type selection (a/button/div + href precedence), active vs inactive classes, compact vs expanded padding/text-size, slot + description conditional render + text-size branches, className merge, passthrough attrs (title/role/tabIndex/onKeyDown) |
| `PunchRecordingControls.spec.tsx` | `PunchRecordingControls.tsx` (184 LOC, ZERO spec) | 13 | background-capture latch aria-label/aria-pressed toggle, four NumberFields seeded values + blur/Enter commit + below-min clamp + non-numeric fallback + per-field routing, Mark-region disabled/active styles + definePunchRegion args + recording-capture selection |
| `CrustWaveformDisplay.spec.tsx` | `CrustWaveformDisplay.tsx` (canvas, 273 LOC, 1 expect) | 12 | canvas attrs (role=img, aria-label, backing size, pixelated), wrapper bg (jsdom-rgb), delta-mode bg+banner+red GR fill + input/output layer absence, normal-mode bg+input fill+GR-gap fill, delta-banner absence, target-LUFS dashed line present/absent, peak-GR label above/below 3dB threshold |

**Total new deep component tests this session: 97** (PR #739: 60; PR #740: 25; +12 review-driven additions across both). All assert computed outputs, not existence.

### Canvas-component testing approach
`CrustWaveformDisplay` is rAF-driven canvas with no DOM-expressible output. Tested via a **single-shot `requestAnimationFrame`** (one synchronous draw pass, then inert — the component self-reschedules at the top of `draw()`, so an always-firing rAF recurses forever) plus a **recording 2d context** capturing `fillStyle` assignments (via a setter) and method calls. Uses `scrollSpeed: 'fast'` (frameSkip=1) so the single pass reaches the paint body; `normal`/`slow` early-return on `tick % frameSkip`.

### Review discipline applied
Each PR passed a hand-trace review (expected values verified against component source by an independent reviewer). PR #739: DnD reorder branches, per-item Enter/Escape commit, and PresetBrowser active-pill inline-color were added post-review; the `goToItem` row-navigation test was corrected (item-name button `stopPropagation` means row nav fires only via non-button children). PR #740: one vacuous test removed (`fireEvent.click` on a disabled button never fires `onClick`, so the no-capture guard was unexercised) and the GR-gap fill (`rgba(196,64,48,0.18)`) assertion added.

### Known tooling friction
- **oxlint vs tsc type-resolution conflict** on `testing-library` query returns: `getByRole('spinbutton')`/`getByTestId` resolve to `HTMLInputElement` in oxlint's type-aware lint (flagging `as HTMLInputElement` as unnecessary) but to `HTMLElement` in `tsc`/`tsconfig.test.json` (requiring the cast). Worked around with `getByLabelText` + `toHaveValue` matcher (no cast needed).
- **Radix `TooltipContent` is not queryable via `getByText` in jsdom** (portal/delayed render) — state is already covered by aria-label/aria-pressed/className, so tooltip-text assertions were dropped rather than worked around.

---

## Session 2026-07-23 — Depth + breadth push

**Goal shift:** from "make green" to **maximum coverage with maximum depth**. Prior work left the suites honest but shallow (613 existence assertions vs 181 deep). This session eliminated all 198 remaining no-op `if (visible) { toBeVisible() }` patterns across 27 e2e files (batches 1-3: PRs #686, #689, #692) and then pivoted to **deep unit coverage** of pure-logic modules with zero/weak direct specs.

**Procedure for bugs found:** sus-audit artifact first (document, don't prescribe), then campaign fix, then write the test against corrected behavior — never contort a test around a shortcoming.

### Deep unit specs added this session

| Spec | File under test | Tests | Coverage area |
|------|-----------------|-------|---------------|
| `YeastPreviewSidecar.spec.ts` | `workers/YeastPreviewSidecar.ts` (1232 LOC) | 17 | beat-time math, decision/lineage, route reset, provenance, capacity drops |
| `GrooveTemplate.spec.ts` | `models/GrooveTemplate.ts` (190 LOC) | 46 | canonicalization, subdivision math, name collision, exact-shape guard |
| `GrooveTemplateState.spec.ts` | `models/GrooveTemplateState.ts` (184 LOC) | 34 | assignment/state guards, sanitize legacy-id remap + dedup + rename |
| `undoTreeDeep.spec.ts` | `models/UndoTree.ts` (96 LOC) | 12 | branching tree: sibling creation, activeBranch, immutability |
| `effects.spec.ts` | `services/effects.ts` (36 LOC) | 11 | bitcrush quantization, feedbackDelay wet/dry + feedback decay |

**Total new deep unit tests this session: 120.** All assert computed values/state diffs, not existence.

### Review discipline applied
Each PR passed a frozen stance-pool review (2-3 reviewers). PR #696 had 3 vacuous guard-clause tests removed and the `releasePage` test strengthened to verify state integrity. PR #701 had weak assertions tightened (exact collision names, non-canonical id canonicalization, builtin-dedup isolation) and 2 coverage gaps filled (invalid-consumerType drop, midi-clip provenance). PR #704 passed mutation testing proving assertions bite.

### Known bugs/shortcomings documented
- **Crust device** — `addDevice` intentionally rejects with `PluginNotImplementedError`. Not a regression; by design.
- **Gain envelope toggle** renders outside the inspector DOM region — e2e works around via page scope (not a product bug, a DOM-scoping note).
- **InstrumentCard** is a `<div>` with onClick, not a `<button>` — accessibility gap, tested via `getByText` not `getByRole`.

---

## Final Coverage Summary

**Total: 48 spec files, 296 tests.**

> **Status 2026-07-19:** 295/296 pass. One known flake under full-parallel load
> (`launchFlows.spec.ts` "browse demos and load Nebula Drift" — the heaviest demo;
> passes in isolation and on CI retries). A fresh-boot regression that had the launch
> harness timing out suite-wide was fixed (loadProject now lands on the LaunchScreen for
> fresh profiles). Four tautological / assertion-free tests (uncoveredControls,
> mixerAdvanced, dynamicAndEdge, aiFeatures) were upgraded to real assertions. The depth
> table below predates these changes and is approximate.

### Test depth distribution
| Category | Count | % |
|----------|-------|---|
| A — Smoke/Visibility | ~10 | 3% |
| B — Toggle/State | 14 | 5% |
| C — Behavioral | 200 | 68% |
| D — Deep/Edge | 70 | 24% |

### New specs added (16 files, ~112 tests)
| Spec | Tests | Area |
|------|-------|------|
| `launchFlows.spec.ts` | 9 | Launch screen, templates, demos, project menu, save, rename |
| `transportAdvanced.spec.ts` | 10 | Metronome, loop, punch, count-in, auto-scroll, solo, tools, capture, ripple, undo |
| `timelineNavigation.spec.ts` | 6 | Chrome components, adjustment layers, zoom, playhead, minimap, context menu |
| `keyboardShortcuts.spec.ts` | 11 | N, Cmd+B/I/M/J/K, Shift+K, ?, preferences, palette, M, L |
| `inspectorTrack.spec.ts` | 11 | Inspector sections, arm/mute/solo, gain, devices, notes, VCA, automation, chord |
| `inspectorClip.spec.ts` | 3 | Clip rename, duplication, MIDI editor open |
| `mixerAdvanced.spec.ts` | 6 | Channel strips, width, snapshots, AI health, master, close |
| `bottomDockRoutingAnalysis.spec.ts` | 6 | Routing, analysis, editor, automation tabs, switching, close |
| `setlistLoopStation.spec.ts` | 7 | Loop station arm/create/stop/fixed-length, setlist add/navigate/auto-advance |
| `modulationElastic.spec.ts` | 5 | Modulation matrix, automation tab, elastic tab, switching |
| `virtualKeyboardChord.spec.ts` | 6 | Keys, octave up/down, velocity, close, note trigger |
| `instrumentPanels.spec.ts` | 5 | Browser instruments, default synth, device panel, Toaster add, bypass |
| `effectsPanels.spec.ts` | 6 | Gluten/Bacteria/Grinder/Proof add, remove, bypass round-trip |
| `aiFeatures.spec.ts` | 6 | Generative panel, chat, action history, voice, Load AI, composer |
| `collabPreferences.spec.ts` | 6 | Collab panel open/interactive/close, preferences open/content, Ableton Link |
| `audioMidiMisc.spec.ts` | 8 | Status bar metrics, session view, MIDI lanes, browser tabs, dock toggle |

### Known gaps (deferred)
- ~~**Dirty indicator on track add**~~ — **FIXED in PR #205** (`markDirty()` now subscribed to `trackStore` in bootstrap)
- **Overdub toggle** — conditionally rendered, needs MIDI track context
- **Tempo BPM editing** — ValueField has no accessible name
- **Audio clip operations** (normalize, reverse, strip silence) — require audio clips
- **Chord track** — only visible with chords; tested via Pop Song template (additionalUi.spec.ts)
- **Arrangement selector** — only visible with >1 arrangement
- **Elastic editor** — only visible with audio clips
- **Tauri-only flows** — native file dialogs, plugin hosting, .dawproject import/export

### Bug fixes
- **PR #205** — `markDirty()` not called on track add. Fixed by subscribing to `trackStore` changes in bootstrap. The dirty indicator now correctly appears when adding tracks and disappears after save.

---

## Unit & Component Coverage Campaign (PRs #1005-#1120)

### Phase 1: Pure-Logic Unit Specs (PRs #1005-#1036, ~606 assertions)

28 PRs covering pure-logic `.ts` files across all modules: DSP math (envelopes,
filters, oscillators, normalization, bitcrusher, drum voices), codecs (midiTimeStateCodec,
timelineMapTimeCodec), state machines (punch region, groove navigation, bend range),
parsers (NAM, DAWproject zip, denied-prompt, seed notes), validators (frozen buffer tail,
device type matching), music theory (scale navigation, time-signature math), and more.

### Phase 2: Component Specs (PRs #1048-#1120, ~468 assertions)

35 PRs covering component `.tsx` files: ChatComposer, MidiLearnButton, ProjectTab,
LUFSMeter, ToolSelector, SoloModeSelector, UndoRedoButtons, SampleRow, ResizeHandle,
StepPatternEditor, SpatialPanner, GrooveDropTarget, LibraryRootCard, BandStrip,
PresetItem, RailTabBar, GenerativeParamGrids, ChoiceCard, InspectorDetailHeader,
RailBackBar, ProjectLoadingOverlay, CrustGainStrip, CrustMeteringStrip,
MixAnalysisSections, PresenceLabel, PresenceMarker, ControlHeader, InsetPanel,
SearchSummary, BounceOptionsDialog, LegatoTuning, SliceOverlay, KeyboardSplit,
TimelineMinimapResizeHandle, CompressorCurve, DawPluginChip, DawPluginToggle,
DawCompactSelect, DawSwatchButton, DawCompactCheckbox, DawKeycap,
DawGridHeaderCell, DawMeterBar, DawMeterFrame, DawInlineHint,
DawPluginReadoutList, DawUtilityListRow, DawPluginChoiceRow,
DawCompactTextarea, DawTransportCluster, DawDisplaySurface,
OnlineSampleBrowser, SpectrumAnalyzer, Oscilloscope, Goniometer,
PhaseCorrelationDisplay, StringVibrationView.

### Threshold Raise (PR #1055)

| Metric | Old Floor | Actual | New Threshold |
|--------|-----------|--------|---------------|
| Lines | 55 | 89.16% | 87 |
| Statements | 52 | 85.93% | 84 |
| Branches | 40 | 74.95% | 72 |
| Functions | 50 | 86.75% | 84 |

### Item 4: Store-coupled handlers + integration paths (PRs #1121-#1155, ~227 assertions)

33 PRs covering store-coupled commit/hydrate/restore handlers, handler-map getters,
and untested useCases: chordTrack restore/mutation/noop/toggle, automation
restore/lane/remove/add/transform-undo, crossfade restore, master gain set/restore,
groove apply/assign/create/rename, marker add/remove/section, soloSafe set/restore,
trackSoloStates restore, addNotes NaN guards/clamping, addChordEvent sanitization,
quantizeNotes/transposeNotes delegation, autoOrganizeProject mutations,
createMidiGenerationSourceGuard, hasDurableMidiGenerationResult,
adjustmentLayerHandlers withFreezeStaleness wrapper, handler-map getters
(PunchRecording/Project/WebMidiInput), commitYeastGrooveExtraction,
hydrateCrumbsStateFromProject, projectDeviceTails.

### Item 5: Remaining model/service/transformer gaps (PRs #1156-#1164, ~92 assertions)

9 PRs covering the last pure-logic gaps identified by exhaustive symbol-level scans:

- **PR #1156-#1161**: invokeCancelableNativeLlm (abort/timeout/cancel),
  hydrateLevainPatchFromParameterValues, telemetrySeqlock (seqlock writer).
- **PR #1162**: createAddNotesToolSchema (2×2 branch matrix for
  allowNegativeStartBeat/expectedClipId), trackAction/clipAction preset builders
  (null-return guard), ArpPattern factories (defaultStep shape + independence,
  createDefaultPattern length/edge).
- **PR #1163**: 8 MIDI pure transformers (invertMidiNotes axis mirror + clamp,
  retrogradeMidiNotes time-reversal, normalizeMidiNoteInput clamp/round/default,
  midiNotesEqual 11-field deep equality, quantizeMidiNoteLengths grid snap +
  threshold/zero branches, setMidiVelocities clamp, scaleMidiVelocities multiply +
  clamp, transposeMidiNotes shift + clamp) — 29 tests.
- **PR #1164**: getGrooveProjection factory — memoization identity, assignment
  routing (match/missing-template/passthrough), loop-wrap segmentation (drop
  above-loop, absolute vs relative, clip-boundary clipping, two-segment wrap,
  zero-duration, groove-already-applied bypass) — 11 tests.
- **PR #1166**: normalizeSafeProjectName validator (non-string/empty/overlength/
  HTML-char/control-char rejection, unicode/emoji pass-through) + collectProjectAudioBufferIds
  (bufferId/audioBufferId fallback, frozenBufferId precedence, alternatives traversal,
  dedup, active-arrangement routing) — 17 tests.
- **PR #1167**: ProofImagerSection deepened — band width Mono/% formatting, module
  toggle ON/OFF + callback, auto-mono-bass toggle + callback, frequency Hz formatting,
  correlation readout (positive/negative) — 9 new tests.
- **PR #1168**: ProofExciterSection deepened — module/band toggle ON/OFF labels +
  callbacks, saturation type select onChange + immutability, band enable immutability —
  6 new tests.
- **PR #1169**: ArticulationList deepened — enabled filter, keyswitch MIDI-note-name
  formatting, null-keyswitch branch, compact sidebar mode rendering + onSelect,
  active state routing — 7 new tests.
- **PR #1170**: isValidDynCrossoverFreqs validator (finite/range/strict-order branches)
  + ProofEqSection deepened (module toggle, band enable immutability, freq kHz
  formatting, gain +/- formatting, band-type/channel-mode select wiring) — 15 new tests.
- **PR #1172**: CollaborationBlock deepened (conditional header rendering, children
  pass-through), InspectorDetailHeader deepened (title/backLabel wiring, actions slot),
  Mix/File/Workspace preset tables (action types, null-return contract, payloads) — 14 tests.
- **PR #1173**: Track preset table (24 presets — creation/mute/solo/arm/hide/disable/fold
  pairs, remove-track master guard, global actions), Generate preset table (15 presets —
  drum/melody/chord styles, trackId forwarding), Registry (CATEGORY_ORDER completeness,
  PRESET_ACTIONS category coverage, unique ids) — 19 tests.
- **PR #1174**: getFaustErrorMessage (AppError/Error/non-Error branches), PresenceMarker
  deepened (variant label positioning, track dot conditional rendering) — 8 tests.
- **PR #1175**: createSubscriptionRegistry (on/off, once auto-remove, onAny wildcard,
  snapshot independence, empty-event handling) — 9 tests.
- **PR #1177**: raceAbortSignal (no-signal passthrough, pre-abort, in-flight abort,
  unhandled-rejection swallow) — 7 tests.
- **PR #1178**: generateAcousticKit (8 samples, ids, names, tags, buffer shape) — 4 tests.
- **PR #1179-#1181**: Project templates — createAmbientTemplate (groove/buses/chords/
  sections), createSingerSongwriterTemplate (G-Em-C-D/sections/sends),
  createLofiTemplate (MPC-60 groove/dorian progression/sections) — 18 tests.
- **PR #1182**: Remaining 4 templates — podcast (chromatic/sidechain ducking),
  edm (C minor/i-VI-III-VII/4 VCAs/kick sidechain), hipHopTrap (F minor/4 VCAs/808
  sidechain), rockBand (E minor/Em-C-G-D/4 VCAs) — 15 tests.

- **PR #1184**: getLevainProjectParameterId (override/snake-to-camel), quantiseDeviceParameterValue
  (builtin clamp/unknown passthrough), getToasterPresetDeviceState (serialize/null/clone-immunity) — 9 tests.
- **PR #1185**: createAudioTrack (overrides/devices), projectLevainPatchToEngineParameters
  (base fields/articulation-id/mic-positions/empty-mics) — 9 tests.
- **PR #1186**: 4 template helpers — buildDevice (defaults/unique-ids), createInstrumentTrack
  (device-chain/overrides), createBus (devices/overrides), createFolder (color/collapsed) — 15 tests.
- **PR #1187**: 4 more helpers — addDeviceChain (append/preserve), addSend (busId/replace/dedup),
  setChordProgression (repeat/wrap/clamp/unique-ids), setMasterChain (presets/replace/all-9) — 16 tests.
- **PR #1188**: Final 4 helpers — attachSidechainCompressor (defaults/overrides), addMarkers
  (default-color/append/preserve-sections), addSections (default-color/append/preserve-markers),
  setGroove (subdivision-selection/empty-offsets) — 14 tests.

- **PR #1190**: CompressorLayout — final device layout (registration, parameter grid,
  curve defaults/live values) — 4 tests.
- **PR #1191**: ClipCommands — 6 untested commands (split/normalize/reverse/glue/
  consolidate/loop) with selection guards — 7 tests.
- **PR #1192**: TrackCommands — 18 untested commands (duplicate/delete/freeze/unfreeze/
  flatten/bounce/arm/solo/mute/group/ungroup + 5 declarative actions) — 20 tests.
- **PR #1193**: EditCommands — 7 commands (undo/redo/copy/cut/paste/select/deselect)
  — 7 tests. Completes ALL 11 command interface files with behavioral coverage.
- **PR #1195**: deviceLayoutRegistry — exact/prefix resolution priority, filterParams — 8 tests.
- **PR #1196**: clampDeviceParameterValue + isDeviceParameterAutomatable adapter wrappers — 4 tests.
- **PR #1197**: planPromptActions — revision invalidation guard, abort skip, empty-actions passthrough — 4 tests.

### Threshold Raise #2 (PR #1198)

Re-measured full suite coverage after 73 additional PRs since the initial threshold raise (PR #1055):

| Metric | Old Threshold | Actual (PR #1055) | Actual (now) | New Threshold |
|--------|--------------|-------------------|--------------|---------------|
| Lines | 87 | 89.16% | **89.87%** | 88 |
| Statements | 84 | 85.93% | **86.62%** | 85 |
| Branches | 72 | 74.95% | **75.65%** | 74 |
| Functions | 84 | 86.75% | **87.57%** | 86 |

All four metrics measurably increased (+0.7-0.8% each). New thresholds set with ~1.5-2% headroom.

### Post-threshold-raise coverage (PRs #1199-#1202, ~35 assertions)

- **PR #1199**: duplicateSelectedClipsForward (R-B2 shortcut — span calc, undo/redo
  closures, guard branches) — 8 tests.
- **PR #1200**: extractGrooveTemplate (validation branches, straight-groove detection,
  timing/dynamics extraction, id resolution) — 12 tests.
- **PR #1201**: applyNoteExpression (no-expression/no-strip/no-controls guards, normalized
  forwarding, channel default) + restoreDeletedGrooveTemplate (null/invalid/mismatch guards,
  template restore, assignment restore) — 10 tests.
- **PR #1202**: prepareOfflineProof (device lookup, chain order restore, reorder message
  routing, non-proof device filter) — 5 tests.
- **PR #1204**: updateTextNode (null guard, in-place update, node identity preservation,
  multi-node replace) — the last clean pure-logic gap — 5 tests.
- **PR #1205**: collectDeviceRuntimeFailures (Map iteration, failure/health aggregation)
  + commitToasterKit (store guard, executeAppAction dispatch) — 8 tests.
- **PR #1206**: commitCrumbsDeviceState (store guard, executeAppAction dispatch)
  + getScopedGrooveAssignment (scoped/legacy fallback) — 6 tests.

### Coverage re-measurement (PR #1211, post #1198 thresholds)

Re-measured after 12 additional PRs since threshold raise #2 (PR #1198):

| Metric | Threshold | Actual (#1198) | Actual (now) | Delta |
|--------|-----------|----------------|--------------|-------|
| Lines | 88 | 89.87% | **89.92%** | +0.05% |
| Statements | 85 | 86.62% | **86.67%** | +0.05% |
| Branches | 74 | 75.65% | **75.69%** | +0.04% |
| Functions | 86 | 87.57% | **87.61%** | +0.04% |

Small gains — thresholds not raised (headroom unchanged at ~1.6-1.9%). The remaining
zero-coverage files require heavy mocking (CRDT/AudioContext/WebGPU/canvas/DOM-events).

- **PR #1208**: restoreCrossfadeClips — 7 branch paths (same-id, eligibility, finite,
  negative, not-found, no-change, mutation) — 7 tests.
- **PR #1209**: projectToasterPatternGroove — 4 paths (unassigned passthrough, status
  failure, missing-template, groove application) — 4 tests.
- **PR #1210**: linkCloudRequestAbort — AbortSignal linking (no-caller, pre-aborted,
  deferred abort, cleanup, unlink isolation) — 5 tests.
- **PR #1214**: getClipNormalizationTargetGain — 7 branch paths (eligibility, state,
  clip-type, buffer, scale-null, clamp, success) — 7 tests.
- **PR #1215**: proposeYeastGrooveExtraction — 6 status routing paths (ineligible,
  extracted, straight, invalid-source, empty) — 6 tests.
- **PR #1216**: createPopSongTemplate — groove, I-vi-IV-V progression, sections, VCAs,
  sidechain. Completes ALL 9 project templates with dedicated specs — 6 tests.
- **PR #1218**: handleDeleteGrooveTemplate + handleSetDeviceState handlers — 9 tests.
- **PR #1219**: executePlayheadSeek — first hardest-tier file (transport scheduler mocking,
  recording flush, scheduler restart gating, error recovery) — 7 tests.
- **PR #1221**: grandBouleEngineHandle — disconnected handle factory — 4 tests.
- **PR #1222**: deviceNodeFactory — factory lookup + gain delegation — 4 tests.
- **PR #1224**: AiTaskResultCard deepened — type formatting, status branches, duration — 8 tests.
- **PR #1225**: sanitizePersistedActionHistoryBundle — Automerge-mocked CRDT sanitization,
  incremental folding, deletion — 6 tests.
- **PR #1226**: EmptyState + InstrumentCard component specs deepened — 4 tests.

**Campaign total to date: 147 PRs, ~1868 assertions across pure-logic models,
services, transformers, store-coupled handlers, useCases, components,
cross-cutting infrastructure, ALL 9 project templates, ALL 14 template helpers,
ALL 9 device layouts, ALL 11 command interface files, the device layout registry,
groove extraction/restoration, offline render preparation, device-state commit paths,
crossfade restore, Toaster groove projection, cloud request abort linking,
transport seek orchestration, CRDT action-history sanitization, and deepened
component specs.**

### Threshold Raise #3 + Re-measurement (PR #1231)

Re-measured after 12 additional PRs since threshold raise #2 (PR #1198):

| Metric | Old Threshold | Actual (#1198) | Actual (now) | New Threshold |
|--------|-------------|----------------|--------------|---------------|
| Lines | 88 | 89.87% | **89.94%** | 89 |
| Statements | 85 | 86.62% | **86.69%** | 86 |
| Branches | 74 | 75.65% | **75.74%** | 75 |
| Functions | 86 | 87.57% | **87.66%** | 87 |

- **PR #1229**: runBranchLineageTransition — CRDT branch lineage with re-entrancy guard,
  snapshot rollback, persistence operation, dedup — 5 tests.
- **PR #1230**: replaceProjectData — full project replacement with AudioContext/IDB/CRDT
  mocking, abort paths, degraded recovery — 7 tests.
- **PR #1232**: executableAppActionRegistry (1684 LOC) — descriptor count, Map consistency,
  risk validation, unique keys, known types — 6 tests.
- **PR #1233**: crdtPersistenceQueueCoordinator (844 LOC) — entry points, reset, lineage
  transition validation, load operation — 6 tests.
- **PR #1235**: ControlHeader deepened — value conditional, zero value, complex content — 4 tests.
- **PR #1237**: ShortcutCheatSheet deepened — open/close lifecycle, escape/button close,
  group titles, shortcut descriptions — 5 tests.

- **PR #1235-#1240**: ControlHeader (value conditional), ShortcutCheatSheet (open/close lifecycle),
  InstrumentBottomPanel (aria-label/onClose), SampleRow (play/stop/favorite/metadata/formatting),
  HumanizePanel (computed readouts/knob transforms), MicBlendSlider (room threshold/mixer toggle).
- **PR #1243-#1244**: GrHistory (canvas role/aria-label), CrustSatCurve (canvas size/aria-label per algo).
- **PR #1245-#1247**: WaveshaperEditor (canvas size/drag commit), BezierLfoEditor (label toggle/drag),
  CrossoverDisplay (band labels/mode/drag/click).
- **PR #1264**: SignalFlowDiagram — shimmer/freeze conditionals, FDN-8/FDN-16 distinction — 6 tests.
- **PR #1267**: StepSequencer — velocity aria-label, pointer toggle, alt-drag gesture — 3 tests.
- **PR #1268**: PadGrid — onSelectPad click, aria-pressed, muted overlay, choke badge, volume — 6 tests.
- **PR #1270**: GlutenCurve — canvas role/aria-label, default size, grab/grabbing cursor, threshold drag — 6 tests.
- **PR #1271**: PerNoteEditor — onReset callback, onParamChange knob, value readout, labels — 4 tests.
- **PR #1272**: IrBrowser — drag-over state toggle, AIFF-by-extension, canvas waveform render — 3 tests.

- **PR #1273**: SpectralBinEditor — canvas size, mode label, paint with brush falloff — 5 tests.
- **PR #1274**: LoudnessHistory — aria-label, canvas size, full gridline verification — 3 tests.
- **PR #1275**: SpectralWaterfall — aria-label, className passthrough, idle render, multi-frame — 4 tests.
- **PR #1276**: SpectrumAnalyzer — canvas size, default props, crossover overlay with bandCount gate — 4 tests.

### Threshold Raise #4 (PR #1277)

Re-measured after additional PRs since threshold raise #3 (PR #1231). Lines crossed 90% for the first time!

| Metric | Old Threshold | Actual (#1231) | Actual (now) | New Threshold |
|--------|-------------|----------------|--------------|---------------|
| Lines | 89 | 89.94% | **90.03%** | 90 |
| Statements | 86 | 86.69% | **86.84%** | 87 |
| Branches | 75 | 75.74% | **76.02%** | 76 |
| Functions | 87 | 87.66% | **87.83%** | 88 |

- **PR #1278**: FermenterPatch model constants — DEFAULT_PATCH shape, name arrays,
  FERMENTER_PARAMS, MACRO_LABELS/MAPPINGS — 13 tests.
- **PR #1279**: BacteriaPatch model — DEFAULT_BAND, DEFAULT_PATCH shape, type unions,
  crossover ordering — 15 tests.
- **PR #1280**: FactoryDrumKits — 6 kits, unique ids, voice shapes, accessor functions — 10 tests.
- **PR #1281**: BuiltinEffectDescriptors — 19 effects validated, unique ids, params, categories — 8 tests.
- **PR #1282**: BuiltinInstrumentDescriptors + COVERAGE.md update — 8 tests.
- **PR #1283**: expandedPresets — 60 presets, unique ids, trackKind, device validation — 10 tests.
- **PR #1285**: faustInstrumentPresets + COVERAGE.md — 7 tests.
- **PR #1286**: transactionalPersistence — IDB test fixture, 14 tests.
- **PR #1288**: GenerationAndView tools — 218 LOC tool schema registry — 9 tests.
- **PR #1290**: XYMorphPad — drag transform, clamp, corner labels — 4 tests.
- **PR #1291**: ModulationDock — source labels, count badge, amount formatting — 5 tests.
- **PR #1292**: WaveformDisplay — canvas attrs, cursor position callback — 7 tests.
- **PR #1293**: MobileGate — branding text, full message, Discord CTA button — 3 tests.
- **PR #1294**: DecayEqOverlay — canvas size, pointer-events, drag onChange with multiplier clamp — 5 tests.

**Campaign total to date: 188 PRs, ~2112 assertions. Lines coverage at 90.04%.**
