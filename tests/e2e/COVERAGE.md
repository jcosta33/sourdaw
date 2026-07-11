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

---

## Final Coverage Summary

**Total: 46 spec files, 279 tests — ALL PASSING (100%, exit 0).**

### Test depth distribution (post-upgrade)
| Category | Count | % |
|----------|-------|---|
| A — Smoke/Visibility | ~15 | 7% |
| B — Toggle/State | 16 | 8% |
| C — Behavioral | 131 | 65% |
| D — Deep/Edge | 40 | 20% |

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
