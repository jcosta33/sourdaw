---
name: consolidated-issues-audit
description: Consolidated audit of all open issues across the codebase, verified against source code on 2026-04-16.
type: audit
status: partially-addressed
---

# Consolidated Issues Audit

## Session status (2026-04-16 fix pass)

A bug-fix session driven by task `.agents/tasks/fix-consolidated-audit-issues.md` has worked through this audit. Each issue below is annotated with a `**Status:**` line. Summary:

- **Fixed (13):** I-07, I-09, I-10, I-11, I-13, I-17, I-18, I-20, I-23, I-24; Timeline §2, §3, §5.
- **Partially fixed (1):** Timeline §1 — `nudgeClip` and `insertTime` fixed; `deleteTimeRange` and `rippleDeleteClips` deferred.
- **Deferred (architectural / feature work):** I-01, I-02, I-03, I-04, I-05, I-06, I-14, I-15, I-16, I-19, I-21, I-25, I-26, I-27, I-28, I-29, I-30; Timeline §4, §6, §7, §8.
- **Deferred (real DSP issues, non-trivial):** I-08 (LR4 cascade), I-12 (Crumbs pitch AA), I-22 (limiter deque).

The fix session's `Self-review` and verification outputs live in the task file. This audit is kept open until the deferred items either have specs, follow-up tasks, or are explicitly triaged out.

## Scope

Repo-wide audit of the Sourdaw web app covering: AI runtime, audio engine, every first-party plugin (Toaster, Proof/Dutch Oven, Levain, Knead, Grinder, Grand Boule, Fermenter, Crumbs), Faust runtime, CRDT / storage, and cross-cutting concerns (design system, export, recording, Chromium fast paths). Excludes Tauri backend (daw-core, daw-io, src-tauri), which deserves its own audit.

This file consolidates previously scattered per-domain audits. Each issue was re-verified on 2026-04-16 against `HEAD`. Stale items are moved to `## Resolved`. Items with wrong file references have been corrected.

## Goal

For every listed subsystem:

- No RT-unsafe code in audio-thread hot paths (no allocations, no `splice`/`shift`, no locks).
- Cross-module boundaries respect the architecture rules in `AGENTS.md` (no hardcoded plugin branches in shared engine code, no deep imports into module internals).
- DSP claims in code match DSP reality (stereo means stereo, dither quantises, PDC reports actual latency).
- Plugin state is per-instance, not singleton.
- Persistence is correct for user data (not silently in-memory for state the user expects to survive reload).
- AI orchestration is layered: one prompt entrypoint, one backend dispatch, one context builder.

## Relevant code paths

- `src/modules/AiRuntime/` — chat, DSO editor, prompt parsing, backend resolution.
- `src/modules/AudioEngine/engine/` — `TrackNode`, `GrinderNode`, `FermenterNode`, `ProofChamberNode`, `NativePluginBridgeNode`, WAM registry.
- `src/modules/AudioEngine/services/` — worklet processors (one file per plugin).
- `src/modules/{Toaster,Proof,Levain,Knead,Grinder,GrandBoule,Fermenter,Crumbs,Plugin,Faust}/` — per-plugin UI + stores + use cases.
- `crates/proof-chamber/`, `crates/daw-dsp/` — Rust DSP (Dattorro reverb, multiband chain, dither, crossover, imager, limiter, Crumbs voice/filter/engine).
- `src/infra/store/storage/` — storage adapters and LocalStorage key registry.
- `src/modules/CrdtDocument/` — Automerge repo, snapshot use cases.
- `src/modules/Workspace/presentations/views/ClipView/` — PianoRoll, KneadEditor.

## Current behavior

The codebase is a hybrid Tauri + browser DAW with a large surface and a high rate of plugin development. The dominant issues fall into five recurring shapes:

1. **Singleton plugin stores.** Several plugins store one instance's state in a module-level store (Levain, Toaster, Grinder, Fermenter telemetry), which breaks multi-instance usage.
2. **DSP placeholders masquerading as finished.** Several Rust DSP primitives compile and pass tests but are arithmetically wrong (TPDF dither never quantises, LR4 cascade sums to non-flat, imager zeroes the centre at max width, Dutch Oven right channel bypasses output EQ).
3. **Audio-thread allocations.** Worklet message queues use `Array.splice` in `process()`. Severity varies: per-block splice is one allocation per block (OK but not great); per-element `shift` would be worse (not observed).
4. **Architecture drift in the audio engine.** `TrackNode` has grown plugin-specific branches (`faust-`, `fermenterControls`, `toasterControls`, `levainControls`, `unregisterProofDevice`, `unregisterLevainDevice`) and two imports from other modules' private use-case surfaces.
5. **Tauri-only code paths silently unavailable on Web.** Sample loading, native plugin hosting, and native AI all assume `isTauri()` without a web fallback or a clear capability gate.

## Findings

- **The AI runtime has two parallel backend-dispatch layers.** `sendChatMessage.ts` resolves a backend and dispatches directly; `executeDsoEdit.ts` has its own `invokeLlm` with a different fallback policy; `inference.ts` has a third (`generateToolCalls`). Any bug fixed in one will not fix the others.
- **"Schema-constrained generation falls back to plain text" is a stated invariant that is not honoured.** `executeDsoEdit.ts` has a comment promising fallback; the code throws instead.
- **`TrackNode` quietly owns knowledge of eight plugin shapes.** Every new plugin adds another branch. The domain-plugin contract (a uniform interface exposed by each plugin module) does not exist yet.
- **Dutch Oven proof_chamber.rs contains code that should not compile.** `set_param` references `self.high_cut_l/high_cut_r/low_cut_l/low_cut_r` while the struct declares only `high_cut`/`low_cut`. Either the file only compiles in a configuration not exercised by this review, or there is a real build break that CI isn't catching.
- **Several audits that fed this file were stale by months.** Three significant claims (Knead offline analysis "missing", Toaster pad hydration "missing", AiRuntime "splice adds tracks") describe code that no longer exists.
- **Some claims point at the wrong file.** PERF-2 ("sledgehammer undo") points at `saveSnapshot.ts` (13-line wrapper); the actual snapshot-before-and-after logic is in `executeDsoEdit.ts`. Grinder "replacePatch flood" points at `GrinderNode.ts` where `replacePatch` does not exist — it lives in `GrinderPanel.tsx`.

## Priorities

Ordered by impact × confidence-of-evidence:

1. **I-07** Right channel bypasses output EQ in Dutch Oven (audible bug, trivial fix). Also: Dutch Oven file references symbols that don't exist — build health is in question.
2. **I-09** TPDF dither never quantises — output of "dithered" path is silently wrong.
3. **I-08** LR4 four-band splitter cascades crossovers and therefore does not sum flat.
4. **I-14** `createAutomergeStorage.ts` deep-imports into `CrdtDocument/repositories/` — infra layering violation blocks persistence rework.
5. **I-01** Native plugin audio path uses per-block `tauriInvoke` — fundamental perf ceiling for third-party plugins.
6. **I-05** TrackNode hardcoded plugin branches — blocks every new plugin integration and violates module architecture.
7. **I-11** Crumbs filter state corruption (stereo L/R share filter state).
8. **I-03** Multiple singleton plugin stores (Levain, Toaster controls lookup) prevent multi-instance usage.
9. **I-02** Two+ parallel AI backend dispatchers — fragile and drift-prone.
10. **I-06** Proof limiter O(window × samples) lookahead — CPU cost scales poorly.

## Open issues

### I-01. Native plugin audio path uses per-block `tauriInvoke`

**Problem:** Every audio block round-trips through Tauri IPC to reach the native plugin host, which is not viable for low-latency hosting.

**Representative files:**

- `src/modules/AudioEngine/engine/NativePluginBridgeNode.ts:51` — `await tauriInvoke('process_plugin_audio', …)` inside the audio path.

**Needed:** Move audio transport off IPC. Use `SharedArrayBuffer` rings (analogous to the recording path) between the worklet and the Rust cpal thread; drive param updates via a separate low-rate control channel.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — architectural; requires a dedicated spec and SAB transport design.

---

### I-02. AI runtime has two parallel backend-dispatch layers

**Problem:** `sendChatMessage`, `executeDsoEdit`, and `generateToolCalls` each implement their own per-backend fallback chain. The three code paths disagree on when cloud is used, how grammar-constraint failure is handled, and how lifecycle state transitions. `sendChatMessage.ts` = 296 LOC; `executeDsoEdit.ts` = 422 LOC.

**Representative files:**

- `src/modules/AiRuntime/useCases/sendChatMessage.ts`
- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:300-376` (`invokeLlm` helper)
- `src/modules/AiRuntime/useCases/llmOrchestration/inference.ts`

**Needed:** Collapse to one backend-dispatch use case that owns the chain, status-store transitions, and error mapping. Call sites should only pass mode + messages + options.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — architectural; needs a unified `invokeLlm` use case. I-18 (schema fallback) was fixed in place without collapsing the dispatchers.

---

### I-03. Singleton plugin stores prevent multi-instance usage

**Problem:** Several plugins hold one instance of state in a module-level store, so multiple instances of the same plugin on different tracks collide.

**Representative files:**

- `src/modules/Levain/stores/levainStore.ts:43-45` — one global `LevainState` (patch, macros, micPositions, telemetry) with no per-device keying.
- `src/modules/Toaster/useCases/loadToasterKit.ts:59-63` — `getToasterControls()` does `tracks.find(t => t.devices.some(d => d.type === 'toaster'))` and returns the first match; all subsequent calls address that one device.
- `src/modules/Fermenter/stores/fermenterStore.ts` — telemetry (meters, oscilloscope) is a single global object (see I-15).

**Needed:** Key state by device/instance ID (e.g. `Record<DeviceId, LevainPatch>`). The param bridges must look up state by the device they're acting on, not assume "the" one.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — cross-cutting refactor across Levain, Toaster, Fermenter stores; needs a spec.

---

### I-04. DSO edit performs full Automerge snapshot before and after each plan

**Problem:** Undo captures a full binary bundle of **every** Automerge document twice per AI edit — before and after.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:252,258` — `saveSnapshot()` before + `saveSnapshot()` after inside `commitDsos`.
- `src/modules/CrdtDocument/useCases/saveSnapshot.ts` — thin 13-line wrapper (not itself the issue — original audit pointed here by mistake).

**Needed:** Reuse Automerge's own change/heads mechanism for AI undo, or snapshot only the documents actually touched by the DSO plan. Do not snapshot the whole bundle for a one-note edit.

**Status:** **Verified** against HEAD. File reference corrected from the original audit. **Deferred (2026-04-16)** — needs an Automerge change/heads strategy decision.

---

### I-05. `TrackNode` hardcodes plugin-specific branches and imports cross-module internals

**Problem:** Shared engine code has grown branches for specific plugins (`'builtin-sidechain-compressor'`, `'faust-'` prefix, `fermenterControls`, `toasterControls`, `levainControls`, `grandBouleControls`, `wamControls`, `nativeDspControls`, `proof` type) plus hard-imports `unregisterLevainDevice` and `unregisterProofDevice` from other modules' use-case surfaces. This is the shape of a missing plugin-host abstraction.

**Representative files:**

- `src/modules/AudioEngine/engine/TrackNode.ts:2-3` — cross-module imports of `unregisterLevainDevice`, `unregisterProofDevice`.
- `src/modules/AudioEngine/engine/TrackNode.ts:213` (sidechain), `:404` (`faust-` prefix), `:314-330` (five `*Controls.destroy()` branches), `:339-385` (per-controls `updateParam` branches), `:429-446` (per-controls `updateBypass` branches).

**Needed:** Define a uniform device-node interface (`setParam`, `scheduleParam`, `setBypass`, `dispose`) that every plugin's node implements; `TrackNode` then only calls the interface. Move per-plugin logic back into plugin modules.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — large refactor; needs `DeviceNode` interface spec.

---

### I-06. Hosted plugins report PDC latency but the host ignores it

**Problem:** `ProofChamberInstance::get_latency()` is implemented in Rust and exposed in the JS WASM binding, but the worklet processor never calls it and no upstream code routes latency to the scheduler.

**Representative files:**

- `crates/proof-chamber/src/lib.rs:162-168` — `pub fn get_latency(&self) -> u32`.
- `src/modules/AudioEngine/wasm/proof_chamber.js:17-18` — JS-side wrapper.
- `src/modules/AudioEngine/services/proofChamberProcessor.ts` — no reference to `get_latency`.
- Recorded audio, MIDI, and automation are also not latency-compensated.

**Needed:** Query `get_latency()` on plugin ready, sum across the chain, and compensate recording + automation paths. Requires a host-wide PDC bus.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — needs a host-wide PDC spec.

---

### I-07. Dutch Oven right channel bypasses output EQ and struct fields are inconsistent

**Problem:** In the main reverb `process()` loop, output high-cut and low-cut filters are applied only to `wet_l`. `wet_r` is handed straight to the M/S stage. Additionally, `set_param` references fields (`high_cut_l`, `high_cut_r`, `low_cut_l`, `low_cut_r`) that are not declared on the struct — the struct has singular `high_cut`, `low_cut`.

**Representative files:**

- `crates/proof-chamber/src/proof_chamber.rs:362-363` — struct declares `high_cut: HighCut, low_cut: LowCut` (singular).
- `crates/proof-chamber/src/proof_chamber.rs:506-512` — `set_param` calls `self.high_cut_l.set_freq(...)`, `self.high_cut_r.set_freq(...)` etc. (fields don't exist on the struct).
- `crates/proof-chamber/src/proof_chamber.rs:693-697` — only `wet_l` goes through the filters; `wet_r` is untouched. The comment even acknowledges "TODO: add stereo filter instances".

**Needed:** (a) Verify whether this file actually compiles (the field mismatch suggests a broken build or a gating story). (b) Give the reverb two independent filter pairs (`high_cut_l`, `high_cut_r`, `low_cut_l`, `low_cut_r`) and filter both channels.

**Status:** **FIXED (2026-04-16)** — confirmed build break (4× E0609). `proof_chamber.rs` now declares `high_cut_l/_r` and `low_cut_l/_r`; both channels are filtered in `process()`. `cargo check -p proof-chamber` is clean.

---

### I-08. LR4 four-band splitter cascades crossovers and therefore does not sum flat

**Problem:** `FourBandSplitter::process` feeds the high output of `xover1` into `xover2`, and the high output of `xover2` into `xover3`. Each output band passes through a different number of highpass stages, so phase delay differs per band; summing them back does not yield flat response.

**Representative files:**

- `crates/daw-dsp/src/proof/crossover.rs:87-92`.
- `crates/daw-dsp/src/bacteria/crossover.rs` (same pattern in the Bacteria/Proof multiband chain per original audit — to spot-check if reused).

**Needed:** Restructure to parallel LR4s with allpass compensation on the non-split branches, or use a Linkwitz-Riley topology that sums to flat allpass by construction (standard multiband approach).

**Status:** **Verified** in `crates/daw-dsp/src/proof/crossover.rs`; the Bacteria file was not re-read in this pass. **Deferred (2026-04-16)** — real issue but requires crossover topology redesign; not a minimal fix.

---

### I-09. TPDF dither never quantises the output

**Problem:** The "dithered" output path adds noise but does not quantise to the declared bit depth, so output is _not_ the quantised signal the name implies.

**Representative files:**

- `crates/daw-dsp/src/proof/dither.rs:32-37` — `process_sample` returns `x + (r1 + r2) * lsb`. No `round()` step.
- Contrast `NoiseShapedDither::process_sample` on line 77 — `(x_dithered / lsb).round() * lsb` is correct.

**Needed:** Quantise to `lsb` after the dither addition. One-line fix, but exposes the question of whether any test has ever asserted the output grid.

**Status:** **FIXED (2026-04-16)** — `process_sample` now returns `(dithered / lsb).round() * lsb`, matching the `NoiseShapedDither` implementation it was supposed to mirror.

---

### I-10. Stereo imager zeroes the centre channel at maximum width

**Problem:** `apply_width` scales mid by `(2.0 - width)`, so `width=2.0` gives `m_scaled = 0` — the centre is gone. At `width=0.0` (mono) `m_scaled = 2*m`, which doubles the centre. A correct M/S width usually scales only side and leaves mid unscaled.

**Representative files:**

- `crates/daw-dsp/src/proof/imager.rs:143-147`.

**Needed:** Replace the formula with `m_scaled = m`, `s_scaled = s * width`. If a "mono → stereo" axis is desired, use a separate control.

**Status:** **FIXED (2026-04-16)** — `apply_width` now leaves mid unscaled and scales only side by `width`. Centre image preserved at all widths.

---

### I-11. Crumbs filter shares state across L and R channels

**Problem:** The voice filter is a single `TptSvf` whose `process_mono` advances internal state. Left is processed first, then right is processed through the _already advanced_ state. The comment acknowledges this.

**Representative files:**

- `crates/daw-dsp/src/crumbs/voice.rs:243-255` — `fr = self.filter.process_mono(right, …)` after `fl = self.filter.process_mono(left, …)`. Comment: "Stereo: process right through the same filter state (coupled stereo)."

**Needed:** Two filter instances, or a stereo SVF variant. Current topology introduces channel cross-talk proportional to filter resonance.

**Status:** **FIXED (2026-04-16)** — `CrumbsVoice` now holds independent `filter_l` / `filter_r`; coefficients kept in sync via `set_filter_params`. No state cross-talk. (Note: `cargo check -p daw-dsp` is still blocked by an unrelated pre-existing `grand_boule/voice.rs` break, logged as a follow-up.)

---

### I-12. Crumbs pitch playback has no anti-aliasing when transposing up

**Problem:** The voice reads at `position` using 4-point cubic Hermite interpolation. Cubic Hermite is an interpolator, not a pitch-shift anti-aliasing filter. At pitch ratios > 1.0 (transpose up), there is no lowpass pre-filter to prevent aliasing above Nyquist.

**Representative files:**

- `crates/daw-dsp/src/crumbs/voice.rs:218-240`.

**Needed:** For large pitch-up, either oversample the source, run a variable-cutoff lowpass before the interpolator, or switch to a windowed-sinc interpolator with anti-image filtering.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — real issue but requires a pre-resample LPF design cheap enough to run per voice.

---

### I-13. `createAutomergeStorage.ts` deep-imports into another module's private `repositories/`

**Problem:** Infra-level storage adapter imports a module-internal repository directly, violating the "repositories are STRICTLY PRIVATE to their module" rule in `AGENTS.md`. This blocks any restructure of CRDT persistence without a cross-layer break.

**Representative files:**

- `src/infra/store/storage/createAutomergeStorage.ts:3` — `import { automergeRepository } from '#/modules/CrdtDocument/repositories/automergeRepository'`.

**Needed:** Invert the dependency: `CrdtDocument` module exposes a public use-case API (`saveAll`, `loadAll`, or similar) from its `useCases/` and `index.ts`; the storage adapter imports that instead. Run `pnpm deps:validate` afterwards.

**Status:** **FIXED (2026-04-16)** — the adapter now goes through `getCrdtDoc`, `hasCrdtDoc`, `mutateCrdtDoc`, and `getSemanticContext` from `#/modules/CrdtDocument/useCases/*`. Deep per-file imports (not the barrel) avoid a module-init cycle where the barrel re-exports `projectProjection`, which transitively loads stores that call `createAutomergeStorage()` at module scope. `mutateCrdtDoc` gained an optional `message` parameter so semantic context still flows through. `pnpm deps:validate` reports 0 errors.

---

### I-14. Volatile state that should be durable

**Problem:** Stores holding user-expected-persistent data are in-memory-only (no persistence adapter).

**Representative files:**

- `src/modules/Knead/stores/kneadStore.ts` — pitch edits lost on reload.
- `src/modules/CrdtDocument/stores/actionHistoryStore.ts` — action history lost on reload despite storing AI group labels and undo records.

**Needed:** Wire both stores through `createLocalStorage` / `createAutomergeStorage` adapters with a `toCrdt` shim to strip ephemeral fields.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — depends on a storage-shim design for each store; not a minimal fix.

---

### I-15. Fermenter telemetry updates store on every audio tick

**Problem:** Telemetry (meters, oscilloscope) is pushed into a React-subscribed store at audio-rate, causing catastrophic re-renders of any component subscribed to `fermenterStore`. Related: 80+ `postMessage` calls per tick during patch morph; param updates block-aligned, not sample-accurate.

**Representative files:**

- Audit originally pointed at `src/modules/AudioEngine/engine/FermenterNode.ts → setFermenterTelemetry`. Actual location: `src/modules/Fermenter/stores/fermenterStore.ts` and `src/modules/Fermenter/presentations/hooks/useFermenterTelemetry.ts`.
- `src/modules/AudioEngine/services/fermenterProcessor.ts` — block-aligned param updates.

**Needed:** Publish telemetry via a SAB or an event-emitter that components can selectively subscribe to at UI rate, not through the global store. Batch morph messages into one keyframe message.

**Status:** **Partially verified** — re-render risk verified by pattern; morph/postMessage claims not re-measured this pass. **Deferred (2026-04-16)** — needs a SAB/event-emitter telemetry design.

---

### I-16. AI chat UI re-renders on every token and re-parses markdown

**Problem:** `ChatPanel` subscribes to the entire `chatStore`, so every streaming-token update to any message re-renders the panel. Inside the panel, `<ReactMarkdown>{msg.content}</ReactMarkdown>` reruns its tokeniser for every message every render.

**Representative files:**

- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx:68-73` (subscribe), `:164-218` (map + `ReactMarkdown`), `:206` (the `ReactMarkdown` call).
- `src/modules/AiRuntime/useCases/sendChatMessage.ts:221,235,263` (per-token `updateChatMessage`).

**Needed:** Split each message into its own subscribed component; keyed by message id; only the streaming-target message re-renders per token. Cache markdown parse by `msg.id + content.length`.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — requires a message-component split and markdown parse cache.

---

### I-17. `ReasoningBlock` has no ARIA

**Problem:** A collapsible control built from a `<button>` with no `aria-expanded`, no `aria-controls`, no `aria-label`.

**Representative files:**

- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx:34-56`.

**Needed:** Add `aria-expanded={expanded}`, `aria-controls="reasoning-body-{id}"`, a stable region id, and `aria-label="Toggle reasoning"`.

**Status:** **FIXED (2026-04-16)** — `useId`-generated region id, `aria-expanded`, `aria-controls`, and `aria-label` are all present on the `<button>`, and the expanded body is a labelled `role="region"`.

---

### I-18. DSO schema-constrained generation does not fall back to plain text

**Problem:** The in-code comment promises "If grammar-constrained generation fails (smaller models may reject tokens), retry without the constraint and rely on the system prompt alone." The `catch (constraintError)` block instead throws, aborting the edit.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:334-376`.

**Needed:** Either implement the fallback (second streaming call without `response_format.schema`), or remove the promise from the comment and the expectation from the UX.

**Status:** **FIXED (2026-04-16)** — on schema-constrained failure, the code now retries once without `response_format`. If both attempts fail, it throws a single combined error that includes both failure messages.

---

### I-19. `TrackNode` rebuilds graph on bypass for generic devices

**Problem:** `updateBypass` falls through to `this.rebuildChain()` for any device that isn't fermenter/toaster/levain/native/sidechain. Each bypass toggle on a Faust or WAM device produces an engine-wide disconnect + reconnect sweep.

**Representative files:**

- `src/modules/AudioEngine/engine/TrackNode.ts:429-446`.

**Needed:** Route generic devices through a pre-built bypass gain (two nodes, one connect-time decision) so bypass becomes a one-param change instead of a graph rebuild. The "scheduleRebuildChain" microtask coalescing helps but does not eliminate the rebuild.

**Status:** **Verified** against HEAD (nuanced — no longer affects modern plugins, still affects Faust/WAM/factory devices). **Deferred (2026-04-16)** — related to I-05; will fall out of the `DeviceNode` interface.

---

### I-20. Toaster worklet queue allocates on the audio thread

**Problem:** `_drainQueue` calls `this._queue.splice(0, drained)` inside `process()`. The current implementation is already better than per-element `shift()` but still allocates per block.

**Representative files:**

- `src/modules/AudioEngine/services/toasterProcessor.ts:128-136`.
- Same pattern: `src/modules/AudioEngine/services/levainProcessor.ts:169-177`.

**Needed:** Replace with a ring buffer or an index-based queue (`_queue[_head++]`), or free-list.

**Status:** **FIXED (2026-04-16)** — both `toasterProcessor.ts` and `levainProcessor.ts` now use a read-head index (`_queueHead`). The array is only cleared (`length = 0`) when fully drained; zero allocations in steady-state playback.

---

### I-21. Toaster sequencer uses `setTimeout` for trigger timing

**Problem:** Sequencer uses `setTimeout` with AudioContext-clock drift correction (good: no cumulative drift), but `fire()` triggers the pad without a `sampleFrame`, so individual hits land on main-thread jitter rather than on a sample-accurate grid.

**Representative files:**

- `src/modules/AudioEngine/services/toasterProcessor.ts:97-105` — DOES accept `sampleFrame` on `noteOn`.
- `src/modules/Toaster/useCases/sequencerPlayback.ts:137-149` — `fire()` calls `triggerToasterPad(track.padIndex, vel)` with no `sampleFrame`.

**Needed:** At schedule time, compute the precise AudioContext `sampleFrame` for each hit and pass it through `triggerToasterPad`. The worklet already honours `sampleFrame` queuing.

**Status:** **Verified** — infrastructure is ready; the caller is the missing link. **Deferred (2026-04-16)** — small but needs care around transport-sync.

---

### I-22. Proof limiter does O(window × samples) lookahead scan

**Problem:** Each processed sample computes `self.gain_buffer.iter().copied().fold(0.0_f32, f32::max)` — an O(W) scan per sample, O(W × N) per block.

**Representative files:**

- `crates/daw-dsp/src/proof/limiter.rs:80-87`.

**Needed:** Replace with a monotonic deque (Lemire algorithm) for O(1) amortised max-in-window. Standard limiter implementation.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — real issue but perf, not correctness; monotonic-deque implementation is non-trivial.

---

### I-23. Proof AudioWorklet processors silently drop mono inputs

**Problem:** Processors early-return on `input.length < 2`, so any mono upstream yields silence without a warning.

**Representative files:**

- `src/modules/AudioEngine/services/proofChamberProcessor.ts:71`.

**Needed:** Accept mono by duplicating `input[0]` to both channels (the existing `_passthrough` already does this for the bypass path). Fail loudly (once) if a required input is genuinely missing.

**Status:** **FIXED (2026-04-16)** — `proofChamberProcessor.process()` now accepts `input.length >= 1` and duplicates `input[0]` into the right channel when the upstream is mono.

---

### I-24. Proof React UI mutates `dynBands` objects via `forEach`

**Problem:** `const bands = [...patch.dynBands]; bands.forEach(b => (b.threshold = v))` shallow-copies the array but mutates each band object in place. When Automerge is the backing store, this can produce inconsistent snapshots.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx:541-546`.

**Needed:** `const bands = patch.dynBands.map(b => ({ ...b, threshold: v }))`. The sibling code in `ProofDynSection.tsx:28` already does it correctly — use the same pattern.

**Status:** **FIXED (2026-04-16)** — the `dynBands` and `excBands` handlers in `ProofPanel.tsx` now build new band objects via `.map()` instead of mutating in place.

---

### I-25. Plugin module duplication: `Proof` vs `Plugin/ProofChamber`

**Problem:** Three locations for one plugin: `src/modules/Proof/` (the full module), `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx` (a parallel panel), and `src/modules/AudioEngine/engine/ProofChamberNode.ts` (the node). Whether these are alternate UIs or dead code needs to be decided.

**Representative files:**

- `src/modules/Proof/` (module)
- `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx`
- `src/modules/AudioEngine/engine/ProofChamberNode.ts`

**Needed:** Pick one. The `Plugin/` namespace looks like a legacy experiment — verify and remove if so.

**Status:** **Verified** three files exist; intent unclear. **Deferred (2026-04-16)** — requires a product decision, not a code fix.

---

### I-26. Grinder's main parameters are not sample-accurate

**Problem:** Only 9 `parameterDescriptors` are declared (`gain`, `bass`, `mid`, `treble`, `presence`, `resonance`, `master`, `inputGain`, `outputGain`). All other ~50 params go through `port.postMessage`. Additionally, even the declared 9 are read via `values[frames - 1]` — block-end, not sample-accurate.

**Representative files:**

- `src/modules/AudioEngine/services/grinderProcessor.ts:112-123` (descriptor list).
- `src/modules/AudioEngine/services/grinderProcessor.ts:191-196` — `values.length > 1 ? values[frames - 1] : values[0]` (takes last value of the block).

**Needed:** Decide which params are automatable and declare them. Read automation using `values[i]` per sample inside the inner loop for automatable params.

**Status:** **Verified** against HEAD (audit's original "no AudioParams exposed" is too strong). **Deferred (2026-04-16)** — needs a policy on which params are automatable, then an AudioParam audit.

---

### I-27. PianoRoll subscribes to whole midiStore + trackStore

**Problem:** PianoRoll uses two store subscriptions. Any change to notes on _any_ clip triggers a full re-render; a dense canvas can lag on busy projects.

**Representative files:**

- `src/modules/Workspace/presentations/views/ClipView/PianoRoll.tsx:85-86`.

**Needed:** Either subscribe with a selector that isolates the active clip's notes, or move the canvas into its own component that only re-renders on note-structure change. "Excessive `useStore`" in the original audit was wrong — there are only 2 — but the re-render cost is real.

**Status:** **Partially verified** against HEAD (framing corrected). **Deferred (2026-04-16)** — needs a selector design.

---

### I-28. `LocalStorageKeys.ts` still carries legacy brand-CMS keys

**Problem:** About 80% of the `LocalStorageKey` union is from a different product (brand navigation, asset chooser, marketplace layout, guideline notices, font metrics cache). DAW keys start at line 95.

**Representative files:**

- `src/infra/store/storage/LocalStorageKeys.ts:14-94`.

**Needed:** Remove legacy keys once a cookie-policy review confirms they are not in production use. The file header mentions legal review is required before removal — route through legal before deleting.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — requires legal review per the file header.

---

### I-29. Recording pipeline is hardcoded to one channel

**Problem:** The recording `AudioWorkletNode` is constructed with `channelCount: 1, channelInterpretation: 'discrete'`, so stereo sources are downmixed before reaching the SAB ring.

**Representative files:**

- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:121-127`.

**Needed:** Parameterise by the track's input channel count (mono/stereo) and allocate the SAB ring accordingly. Include a UI toggle in input selection.

**Status:** **Verified** against HEAD. **Deferred (2026-04-16)** — needs a UI policy for input channel selection.

---

### I-30. Claims requiring DSP-level re-verification (not revalidated in this pass)

Items carried over from sub-audits, not re-proved against code in this cycle. They remain open but should be treated as "reported, needs DSP review":

- Toaster: Transient Shaper click (instant gain switch); Tone Filter / Choke / Decay sample-rate dependency; disconnected global effect mix knobs in Rust.
- Proof: Oversampler delay-line state corruption (shared up/downsample); tape-exciter pre/de-emphasis applied after saturation; telemetry-slot allocation leak.
- Levain: Tone/Attack/Release macros stubbed in Rust; true legato stubbed in Rust; default human seed hardcoded to 42.
- Knead: Block-based PSOLA artefacts; static `shift_semitones` API (no time-varying target); pitch data bound to track not clip; right channel ignored by `daw-engine` scheduler; UI params not sent to DSP; UI read-only w.r.t. timeline.
- Grand Boule: Missing parameter mappings / per-note disconnect; inverted voice stealing; progressive simplification defeated by sustain; panic button ineffective.
- Faust: Missing `destroy()` on teardown; monophonic synths used polyphonically; `/fm_synth` vs `/FM_Synth` name mismatch; inspector bypasses `FaustParamDescriptor` on lookup fail; `setTimeout(20)` init race; main-thread compilation.
- Crumbs: Fake loop crossfading (check whether `loop_crossfade` influences the loop transition); hardcoded 44100 at construction site (needs trace back to instantiation site); inefficient IPC polling for playhead position; un-batched IPC for loop params.
- Cross-cutting: design-system inconsistencies; export gaps (stem export, loudness normalisation, metadata, stem cache, ZIP opt-outs); Chromium fast paths (`OffscreenCanvas`, dual-path OPFS, predicted pointer, `scheduler.yield()`).

**Needed:** Per-claim re-verification by someone reading the specific DSP code, ideally as separate per-area audits.

**Status:** **Not re-verified this pass** — carried over. **Deferred (2026-04-16)** — belongs in per-plugin audits, not this consolidated file.

## Open questions

- [ ] Does `crates/proof-chamber/src/proof_chamber.rs` compile as-is? Lines 506-512 reference struct fields (`high_cut_l`, `high_cut_r`, `low_cut_l`, `low_cut_r`) that the struct (362-363) does not declare. Either the workspace is using a feature flag / cfg we didn't examine, there is a real build error, or the file was edited mid-refactor. **This should be answered before any work in §4.**
- [ ] Is `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx` live code, a draft, or abandoned? Same for `SpectrogramView.tsx`, `SignalFlowDiagram.tsx`, `DecayEqOverlay.tsx` in `src/modules/Plugin/presentations/`.
- [ ] What is the policy on mono recording — does the audit claim "mono recording missing" mean "stereo recording is broken" (I-29, verified), or does it mean "explicit mono-only recording mode is missing as a feature"? These are different problems.

## Risks

- **Silent DSP wrong-answers.** Dither (I-09), imager (I-10), Dutch Oven right-channel EQ (I-07), LR4 cascade (I-08) all produce output that is arithmetically wrong in a way no user test would catch without a reference. Accumulates bad impressions of the plugins.
- **Live build-health risk.** If I-07's struct field mismatch actually compiles, there is a cfg surface here we don't understand and the plugin may be shipping a different code path than the one we read. If it does not compile, the whole Proof module is broken and we don't know.
- **Every new plugin makes I-05 worse.** Each addition widens `TrackNode`'s branch tree and the cross-module use-case import surface. Shipping another plugin before I-05 is addressed is a worse-every-time bet.
- **Two AI dispatchers (I-02) mean any AI bug has to be fixed twice.** Already costing review time.
- **Persistence gaps (I-14) lose user edits.** Knead pitch edits are user-authored and disappearing.
- **Singletons (I-03) make "add two instances" a user-visible failure.** This is not subtle — users discover it immediately.

## Suggested approaches

- **Fix the wrong-DSP bugs first (I-07, I-09, I-10)**: each is a few lines, tests can be added to pin them, impact is user-audible. Start there because cost is minimal and they build trust with users who have heard bad output.
- **Triage I-07's build-health question before touching Proof code**: read `proof_chamber.rs` in a context where it actually compiles (e.g., `cargo check -p proof-chamber`). Don't bet on the file as it stands.
- **Unify AI backend dispatch (I-02) before unifying snapshot logic (I-04)**: the latter is a small change inside one caller; the former changes the architecture three callers share. Easier order: I-02, then I-04, then I-18 (fallback behaviour) naturally falls out of the unified dispatch.
- **Define a plugin-node contract in `AudioEngine` to unblock I-05 and I-19 together**: a `DeviceNode` interface with `setParam`, `scheduleParam`, `setBypass`, `dispose`. Migrate plugins one at a time; each migration removes a branch from `TrackNode`.
- **For persistence (I-13, I-14)**: invert `createAutomergeStorage`'s dependency first (I-13), so the two volatile stores can adopt the adapter via the public API.
- **Carry §I-30 into per-area audits**: a single consolidated audit cannot do justice to 40+ DSP-specific claims. Create per-plugin audits under `.agents/audits/` and migrate §I-30 bullets into them as the respective maintainers review.

## Recommendation

Start with **I-07** — verify whether Dutch Oven even compiles as-is (`cargo check -p proof-chamber`). If yes, fix the missing filter fields and wire both channels through output EQ. If no, open a blocker and fix the build before doing anything else in §4.

Once I-07 is triaged, pick up **I-09** and **I-10** (each ~5 lines) as trust-building fixes.

Then tackle **I-02** (unify AI dispatch) and **I-05** (define `DeviceNode` interface) in parallel — both are architectural foundations that many downstream issues depend on.

## Resolved

- ~~Toaster missing `busRoute` / `transientAttack` pad parameter hydration~~ — resolved pre-2026-04-16. `PAD_PARAM_MAP` in `toasterProcessor.ts:20-36` now includes both `busRoute: 'bus_route'` and `transientAttack: 'transient_attack'`.
- ~~Knead offline analysis pipeline "missing entirely"~~ — resolved pre-2026-04-16. Full chunked WASM pipeline exists at `src/modules/AudioEngine/useCases/audioAnalysis/analyzePitchForClip.ts` (KneadInstance.process in blocks, yields every 16 chunks, calls `ingestDspAnalysis`). Ingestion logic lives in `src/modules/Knead/useCases/dspAnalysis.ts` and is populated, not stubbed.
- ~~AiRuntime name resolution "accidentally adds tracks via splice"~~ — resolved or never existed as described. No `splice` in `src/modules/AiRuntime/transformers/promptParser/parsing.ts` or in `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts`. `resolveDsoNames` (compileDso.ts:279) uses `bestMatch` (fuzzy) against in-memory `mockTracks`, never mutates the real track store.
- ~~Levain "no jitter buffer in Rust engine"~~ — partially stale. `levainProcessor.ts:86-105` implements a sorted sample-frame queue. Remaining issue is that `_drainQueue` fires at block-end granularity, not sample-accurate — reframed under the generic "block-aligned plugin scheduling" family, not a missing jitter buffer.

---

_Previous revision of this file used a flat bulleted list without file/line references for many items; it is replaced here by the template in `scripts/agents/templates/audit.md`. Verification performed on 2026-04-16 against `HEAD`._

# Audit: Timeline and MIDI Editing Behavior

## Goal

The Timeline should provide a robust, visually accurate environment for arranging and editing audio and MIDI clips. This includes precise dragging, dropping, stretching, cutting, and looping behaviors, with accurate visual previews (waveforms and MIDI notes) at all times, including during interactions.

## Current State

The Timeline implementation uses a React-managed state with a Canvas-based renderer (`createCanvasRenderer.ts`). Interaction logic is primarily in `useTimelineInteractions.ts`, which uses a "preview" mechanism (`clipDragPreviewRef`) to provide high-performance visual feedback during drags without committing to the main store on every frame.

## Findings

- **MIDI notes are absolute**: MIDI notes in the `midiStore` are stored with absolute `startBeat` on the global timeline. While this simplifies playback scheduling, it complicates almost all editing operations (moving, splitting, stretching) as they must manually shift or scale all notes in the affected clips.
- **Editing operations ignore MIDI/Automation**: Operations like duplicating, nudging, ripple deleting, and inserting time only manipulate the clip boundaries in `trackStore` and fail to coordinate with `midiStore` or `automationStore`, resulting in massive data loss or desync.
- **Preview mechanism is incomplete**: The `clipDragPreviewRef` only stores new `startBeat` and `endBeat` for clips. The renderer (`drawMidiNotePreview`) uses these new boundaries but fetches original absolute notes, causing a visual mismatch during drags.
- **Waveform rendering is naive**: `drawWaveformPeaks` squashes the entire audio buffer into the clip's visual width, ignoring `audioOffsetBeats`, `stretchRatio`, and the clip's actual duration relative to the buffer.

## Issues

### 1. [CRITICAL] Widespread Time-Shift Desync and Data Loss

Many timeline operations shift clips in time without shifting their associated MIDI notes or automation points. Because MIDI notes and automation are stored in absolute time, they become desynced from the clips.

- **Files**:
    - `src/modules/Arrangement/useCases/clipEditing/nudgeClip.ts`
    - `src/modules/Arrangement/useCases/timeOperations/insertTime.ts`
    - `src/modules/Arrangement/useCases/clipEditing/deleteTimeRange.ts`
    - `src/modules/Arrangement/useCases/rippleDelete/rippleDeleteClips.ts`
- **Needed**: All clip movement logic must call `shiftClipMidiNotes` and `shiftClipAutomation` appropriately, or the underlying data model needs to be refactored so that notes/automation belong to the clip conceptually and use relative positioning.
- **Status (2026-04-16)**: **Partially FIXED**. `nudgeClip` now calls both `shiftClipMidiNotes` and `shiftClipAutomation` when the clip actually moves; `insertTime` now calls the new `shiftMidiNotesAfterBeat` use case so MIDI notes and CC/pitch-bend events follow the same global time insert that clips, markers, and automation already did. **Deferred for `deleteTimeRange` and `rippleDeleteClips`** — same class of bug, but the fix requires a three-way partition per clip (notes before / inside / after the deleted range) and is scoped as a follow-up.

### 2. [CRITICAL] MIDI Split/Cut Data Loss

When a MIDI clip is split using the Cut tool, the new "right" clip is created without any notes. The notes from the original clip remain associated with the "left" clip ID, but since the left clip's `endBeat` is now the split point, those notes are no longer visible or playable.

- **File**: `src/modules/Arrangement/useCases/clipEditing/splitClip.ts`
- **Needed**: `splitClip` must identify all notes within the original clip's range and re-associate/clone the notes that fall into the new right clip's range to the new clip ID.
- **Status (2026-04-16)**: **FIXED**. New MIDI use case `splitMidiNotesAtBeat` partitions notes between the source and the new clip id, splitting any note that straddles the cut into a left (truncated) and right (new-clip) half. `splitClip` calls it whenever a MIDI clip is split.

### 3. [CRITICAL] MIDI Duplication Data Loss

Duplicating a MIDI clip creates a new clip ID and copies automation, but it completely fails to copy any MIDI notes to the new clip.

- **File**: `src/modules/Arrangement/useCases/clip/duplicateClipCore.ts`
- **Needed**: `duplicateClipCore` must read notes from `midiStore`, clone them with the new absolute `startBeat`, and associate them with the new clip ID.
- **Status (2026-04-16)**: **FIXED**. `duplicateClipCore` now reads `getNotesForClip(clipId)`, shifts each note by `newStartBeat - originalStartBeat`, and batches them into the new clip id via `batchAddMidiNotes`.

### 4. [MAJOR] MIDI Drag Preview "Stay Behind" Bug

During a MIDI clip drag, the clip boundary (rectangle) moves with the mouse, but the MIDI note previews stay in their original positions. This is because `drawMidiNotePreview` calculates relative positions using the NEW clip `startBeat` but the OLD absolute note `startBeat`.

- **File**: `src/modules/Arrangement/presentations/renderers/clipDrawing.ts` (in `drawMidiNotePreview`)
- **Needed**: `drawMidiNotePreview` needs to know if a clip is being dragged and by how much, or `buildTimelineRenderModel` must shift the notes in the render model itself during the preview phase.
- **Status (2026-04-16)**: **Deferred** — preview-layer reshape. Cleanest fix is to add a `visualShift` to `ClipRenderModel` populated by `buildTimelineRenderModel` during the preview phase, then have `drawMidiNotePreview` add it to each note's x. Deferred to a follow-up paired with §8.

### 5. [MAJOR] Audio Waveform "Squash" Bug

The waveform renderer always shows the entire audio buffer squashed into the clip width. If a 1-bar clip points to a 10-minute file, the entire 10 minutes are rendered inside that 1 bar. It ignores `audioOffsetBeats` and `stretchRatio`.

- **File**: `src/modules/Arrangement/presentations/renderers/clipDrawing.ts` (in `drawWaveformPeaks`) and `src/modules/AudioEngine/stores/audioBufferCache.ts`
- **Needed**: `getWaveformPeaks` should accept `startSample` and `endSample` parameters. `drawWaveformPeaks` should calculate these based on `clip.audioOffsetBeats` and `clip.duration`.
- **Status (2026-04-16)**: **FIXED**. `getWaveformPeaks(id, numBins, { startSample, endSample })` now supports windowed peak generation and caches per window. `ClipRenderModel` carries `audioOffsetBeats` and `stretchRatio`; `drawWaveformPeaks` computes the sample window from clip beats using `tempo` and `sampleRate` so trimmed / offset / stretched clips render the correct slice.

### 6. [MAJOR] MIDI Stretching Not Implemented

Dragging the edge of a MIDI clip with the Stretch tool (or Shift+drag) only changes the clip's `endBeat` (trimming/extending). It does not scale the MIDI notes' positions or durations.

- **File**: `src/modules/Arrangement/useCases/clip/moveClip.ts` and `src/modules/Arrangement/handlers/clipStretch/handleSetClipStretchRatio.ts`
- **Needed**: Implement a `scaleClipMidiNotes(clipId, ratio)` use case that is called when a stretch operation is committed.
- **Status (2026-04-16)**: **Deferred** — feature work, needs a spec first (the scale should anchor on clip `startBeat`; interplay with audio `stretchRatio` needs to be specified).

### 7. [MINOR] MIDI Looping Visual Distortion

When a MIDI clip is trimmed to be longer than its `loopLength`, `drawMidiNotePreview` visually stretches the notes to fit the new duration instead of repeating them correctly. This is due to using `relStart / clipDuration` as the X-coordinate.

- **File**: `src/modules/Arrangement/presentations/renderers/clipDrawing.ts` (in `drawMidiNotePreview`)
- **Needed**: Change the coordinate calculation to use `relStart * pixelsPerBeat` (absolute pixels from clip left) instead of a percentage of the width.
- **Status (2026-04-16)**: **Deferred** — bundled with §4 / §8 in the preview-layer reshape.

### 8. [MINOR] Missing Preview for Stretching/Trimming

While "move" drags have a robust preview, "stretch" and "trim" operations only update the clip boundary in the preview. MIDI notes and waveforms do not update their internal scaling/offset until the drag is released.

- **File**: `src/modules/Arrangement/useCases/buildTimelineRenderModel.ts`
- **Needed**: The preview model should support a `stretchRatio` or `visualOffset` that the drawing functions can respect.
- **Status (2026-04-16)**: **Partially groundwork in place** — `ClipRenderModel` now carries `audioOffsetBeats` and `stretchRatio`, so the render model is no longer the blocker. Wiring the preview phase to update these during a stretch/trim drag is the remaining piece, deferred with §4 / §7.

## Priorities

1. **Fix Widespread Time-Shift Desync** (Critical - data loss during core timeline operations).
2. **Fix MIDI Split Data Loss** (Critical - data loss during editing).
3. **Fix MIDI Duplication Data Loss** (Critical - data loss during editing).
4. **Fix Audio Waveform "Squash"** (Major - fundamental visual correctness).
5. **Fix MIDI Drag Preview** (Major - UX / visual feedback).
6. **Implement MIDI Stretching** (Major - feature parity).

## Risks

- **Memory/Performance**: Fixing `getWaveformPeaks` to support arbitrary ranges might increase peak-generation overhead if not cached properly (e.g., via mipmaps).
- **Undo/Redo**: Fixing MIDI split/stretch requires careful coordination with the undo system to ensure notes are correctly restored.

## Suggested Approaches

- **Move to Relative MIDI Notes**: Consider changing the MIDI model to store notes relative to the clip start. This would automatically fix moving and simplify splitting/stretching, though it requires a migration and updates to the scheduler. If migration is impossible, ensure every clip modifier cleanly coordinates with `midiStore`.
- **Enhanced Render Model**: Update `ClipRenderModel` to include a `visualShift` or `visualScale` property that is populated by `buildTimelineRenderModel` during previews, allowing `clipDrawing.ts` to render correctly without touching the main store.
