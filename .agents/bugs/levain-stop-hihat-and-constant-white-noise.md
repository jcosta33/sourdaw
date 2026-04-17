# Bug — Levain emits a "hi-hat" on stop and a constant white-noise floor

## Symptoms

1. **On transport stop**, a Levain track (bowed-string patches especially) emits a short, bright "ksshh" — described by the user as a hi-hat-like noise.
2. **At all times** while a Levain-bearing track is loaded, a continuous white-noise / hiss is audible in the mix, even when no notes are playing and the transport is not running. It is most obvious on wind-family patches (flute, brass), and subtler on bowed strings.

Neither symptom depends on user MIDI input — it happens purely from loading the track and pressing stop.

## Root cause 1 — 128-note release-burst storm on stop

On transport stop we fan out a brute-force all-notes-off to every Levain device:

`src/modules/AudioEngine/repositories/createWebAudioEngine.ts` — `stopAllScheduled()`:

```ts
for (const [, trackNode] of this.trackNodes) {
    for (const dn of trackNode.strip.deviceNodes) {
        // …fermenter, toaster…
        if (dn.levainControls) {
            for (let note = 0; note < 128; note++) {
                dn.levainControls.noteOff(note);
            }
        }
    }
}
```

`dn.levainControls.noteOff` posts a `{type:'noteOff', note}` message to the Levain AudioWorklet (`src/modules/AudioEngine/engine/LevainNode.ts` — `noteOff`). The processor dispatches it into the WASM engine (`src/modules/AudioEngine/services/levainProcessor.ts` — `_dispatch` → `inst.note_off(msg.note)`).

Inside the Rust engine (`crates/daw-dsp/src/levain/engine.rs` — `LevainEngine::note_off`):

```rust
pub fn note_off(&mut self, note: u8) {
    if self.articulation.handle_note_off(note) { return; }
    // Realism release transient (bow lift noise burst).
    self.realism.note_off(note);
    // …
}
```

`RealismEngine::note_off` (`crates/daw-dsp/src/levain/realism/mod.rs`):

```rust
pub fn note_off(&mut self, _note: u8) {
    if self.instrument.is_bowed_string() {
        self.bow_noise.trigger_burst();
    }
}
```

`BowNoise::trigger_burst` resets a `t·exp(−t/τ)` envelope (τ = 5 ms) on a 2–5 kHz bandpassed white-noise source at peak gain `0.25 × amount` (`crates/daw-dsp/src/levain/realism/bow_noise.rs`). `amount` for bowed strings is fixed at `0.5` (`realism/mod.rs` — `configure`).

Pressing stop therefore retriggers this envelope **128 times within one message batch** for a bowed-string patch. All 128 envelopes share the same bandpass filter state and the same decay window; they sum into one loud 5-ms bandpassed noise peak in the 2–5 kHz region — which is exactly the spectral / temporal signature of a hi-hat cymbal tick.

Fermenter / Toaster / GrandBoule do not have an equivalent release transient, which is why only the Levain track exhibits this symptom.

## Root cause 2 — Continuous realism noise irrespective of voice activity

`LevainEngine::process_block` runs the realism layer for every sample of every audio block, unconditionally:

```rust
for i in 0..len {
    let mut mono_sum = 0.0_f32;
    for voice in self.voice_pool.voices.iter_mut() {
        if !voice.active { continue; }
        mono_sum += voice.tick(&self.sample_pool);
    }
    mono_sum += self.fallback.tick();
    mono_sum *= expr_gain * self.master_gain;

    // Orchestral realism augmentation.
    mono_sum = self.realism.tick(mono_sum);
    // …
}
```

Inside `RealismEngine::tick` (`realism/mod.rs`):

```rust
let with_noise = damped + self.bow_noise.tick() + self.breath.tick();
```

Both noise generators add an **always-on** continuous component whenever `amount > 0`:

- `BowNoise::tick` (`realism/bow_noise.rs`): `continuous = bandpassed * 0.04 * cc1 * cc1 * amount`. For bowed strings `amount = 0.5`, default CC1 ≈ 0.5 → ≈ `0.005 × bandpassed(white)` — quiet but audible in silence.
- `BreathNoise::tick` (`realism/breath_noise.rs`): `band * preset_gain * level * amount`, where `level = cc11 / 127` and `cc11` defaults to **127** in `ExpressionState::new` (`expression.rs:151`). For a flute patch: `0.10 × 1.0 × 0.55 = 0.055 × bandpassed(white)` — audible hiss the instant the track is armed.

Neither generator is gated on voice activity. A real flute / violin makes no sound when no one is articulating; this layer does.

The fallback tone engine (`self.fallback.tick()`) is also unconditionally summed into `mono_sum` before realism, but it self-gates on note activity and is not responsible for the hiss.

## Reproduction

1. Load any Levain-instrument preset on a MIDI track (violin is clearest for bug 1; flute / trumpet for bug 2).
2. Bug 2: with the transport stopped and no MIDI input, listen to the master bus. Continuous bandpassed hiss is audible.
3. Bug 1: play any MIDI note (or don't — the bug fires either way), then press stop. A single short "ksshh" fires on stop.

## Evidence / key files

| Concern | File | Note |
| --- | --- | --- |
| Brute-force all-notes-off on stop | `src/modules/AudioEngine/repositories/createWebAudioEngine.ts` → `stopAllScheduled` | Loops 0..128 per Levain device |
| TS → worklet bridge | `src/modules/AudioEngine/engine/LevainNode.ts` → `noteOff` | One postMessage per note |
| Worklet dispatch | `src/modules/AudioEngine/services/levainProcessor.ts` → `_dispatch` | `inst.note_off(msg.note)` |
| Release transient per noteOff | `crates/daw-dsp/src/levain/engine.rs` → `LevainEngine::note_off` | Calls `realism.note_off` |
| Burst trigger | `crates/daw-dsp/src/levain/realism/mod.rs` → `RealismEngine::note_off` | Bowed-string only |
| Burst envelope / 2–5 kHz bandpass | `crates/daw-dsp/src/levain/realism/bow_noise.rs` | τ = 5 ms, peak gain 0.25 × amount |
| Always-on continuous noise taps | `crates/daw-dsp/src/levain/realism/mod.rs` → `RealismEngine::tick` | `bow_noise.tick() + breath.tick()` every sample |
| Default CC11 = 127 | `crates/daw-dsp/src/levain/expression.rs:151` | Drives breath-noise `level` to 1.0 at startup |
| Per-family `amount` presets | `crates/daw-dsp/src/levain/realism/mod.rs` → `configure` | Bowed strings: bow 0.5; winds: breath 0.55 |

## Proposed fix (for a follow-up task — not implemented here)

### Fix 1 — stop should not produce release bursts

Add a silent `all_notes_off()` to `LevainEngine` that iterates `voice_pool.voices` and releases active voices **without** calling `self.realism.note_off(note)`, then wire:

- a `{type:'allNotesOff'}` message in `levainProcessor.ts` → `inst.all_notes_off()`
- an `allNotesOff()` method on `LevainNodeResult` in `LevainNode.ts`
- `stopAllScheduled` calls `dn.levainControls.allNotesOff()` instead of the 128-iteration loop

Mirror the same pattern for Fermenter / Toaster / GrandBoule to keep `stopAllScheduled` consistent, even though they don't have the burst problem today.

### Fix 2 — gate continuous realism noise on voice activity

In `RealismEngine::tick` (or its caller in `process_block`), skip `bow_noise.tick()` and `breath.tick()` **continuous** components when no voice is active. Two viable shapes:

- Pass a `has_active_voices: bool` into `tick` and early-return the continuous-only part of both noise generators when false.
- Keep the envelope-driven burst contribution running (so a note release still decays its tail) but mute the steady-state scrape/breath when `voice_pool.active_count() == 0`.

The body resonator, sympathetic bank, and damping filter are safe to keep running unconditionally because they only colour existing signal; they contribute nothing when `mono_in == 0`.

### Regression coverage

- Unit test in `realism/mod.rs`: `tick` with no active voices and `mono_in = 0` should return 0 for every preset across 1 s of samples.
- Integration test around `stopAllScheduled` asserting that the new `allNotesOff` path does not post 128 individual `noteOff` messages to Levain worklet ports.
- Preserve the existing `bow_noise_burst_rises_then_falls` test — the burst envelope must still fire when an actual MIDI noteOff arrives during playback.

## Build impact

Both fixes touch Rust (`crates/daw-dsp/src/levain/**`) and the TS worklet bridge. The WASM blob at `public/wasm/daw-dsp/daw_dsp_bg.wasm` must be rebuilt; the generated glue in `src/modules/AudioEngine/wasm/daw_dsp.js` and `public/wasm/daw-dsp/daw_dsp.js` will regenerate from the same build step.

Build command: `pnpm wasm:dsp` (invokes `wasm-pack build --target web --out-dir ../../public/wasm/daw-dsp --no-typescript` + `scripts/gen-daw-dsp-worklet.mjs`).

## Implementation log

### Status: fixed — awaiting manual audio verification

### Verification

| Check | Result |
| ----- | ------ |
| `cargo test --lib levain` | **9 passed**, including new `realism_is_silent_when_no_voices_active` regression test and preserved `bow_noise_burst_rises_then_falls` / `realism_is_finite_for_every_instrument`. |
| `pnpm wasm:dsp` | **OK** — WASM rebuilt at `public/wasm/daw-dsp/daw_dsp_bg.wasm`, generated glue regenerated at `src/modules/AudioEngine/wasm/daw_dsp.js`. |
| `pnpm typecheck` | **0 errors**. |
| `pnpm deps:validate` | **0 errors**, 462 pre-existing warnings (unchanged). |
| Targeted vitest (`LevainNode` / `processorQueues` / `stopPlayback` / `stopAllScheduled`) | **12 tests passed**. |

Not yet verified (needs a human ear):
- Load a violin / cello preset, press play, press stop — confirm no "ksshh".
- Load a flute preset, leave idle, listen on master — confirm no hiss floor.
- Play a legato phrase on a violin, release one note mid-phrase — confirm the bow-lift release burst **still fires** for the real note-off (this is the regression risk of fix 2; the block-level `voices_active` gate should remain true while any voice is in release).

### Adversarial review findings (post-hoc self-review)

Additional issues surfaced reviewing the patch as a PR reviewer, with resolution status.

**Fixed after initial implementation:**

1. **`all_notes_off` did not clear `pedal_deferred`.** If a user stopped while holding the sustain pedal and then resumed playing without lifting the pedal, each new note-off during that hold would append to the `pedal_deferred` queue on top of the stale entries from before the stop. Because the queue is fixed-size (`MAX_DEFERRED = 128`), once capacity was reached new genuine deferred note-offs would be silently dropped. Fix: added `PedalDeferredRelease::clear` and invoked it from `all_notes_off`. `expression.sustain_pedal` is intentionally **not** reset — the flag tracks the user's physical pedal state, which is still held after stop.

**Considered and rejected as non-issues:**

2. **Bandpass-filter state freezing during idle.** When `voices_active && burst_env == 0.0` we early-return from `BowNoise::tick` / `BreathNoise::tick` without ticking the bandpass, so its `z^-1` memory is frozen rather than decaying to zero under silence. Worry: on next activation, the stored state might produce a click or ring-out. Analysis: a stable biquad bandpass with frozen state of magnitude *O(1)* produces bounded output *O(1)* on the next tick — the same order as normal steady-state output. There is no step discontinuity because the filter processes each input sample atomically; it doesn't "care" that wall-clock time elapsed between ticks. No audible artifact.

3. **Sample-accurate noteOn queued past transport stop.** The processor's `_queue` holds `{noteOn, sampleFrame}` entries whose `sampleFrame` is in the future. An `allNotesOff` dispatched immediately releases current voices, but queued future noteOns will still trigger at their scheduled frame in the next `process()` block, producing a stray note after stop. This bug is **pre-existing** — the old 128-iter `noteOff` loop had the same defect — and is orthogonal to the hi-hat / noise-floor symptoms. Not fixed in this patch; logged here for a follow-up.

4. **Stale `AutoArticulation.recent_note_times` after stop.** The 8-slot ring of recent note-on times persists across stop. After resume, `calculate_recent_speed` can see an ancient timestamp as "oldest" and a fresh one as "newest", producing very low speeds and biasing articulation selection toward non-runs. Effect is benign (worst case: first 3 notes after resume don't get runs-articulation auto-selection). Not worth complicating `all_notes_off` for.

5. **Fermenter / Toaster still use 128-iter / 16-iter loops.** Asymmetric with Levain. Not a regression and neither device has a per-noteOff noise-burst side effect, so the brute-force fan-out is correct (if inelegant) for them. Per AGENTS.md scope discipline, left alone.

6. **`fallback.release_all` uses `!voice.releasing` guard; `voice_pool.release_all` does not.** Inconsistent but both correct: `LevainVoice::release` → `amp_env.release` is idempotent (state transition to Release is a no-op if already there); `FallbackVoice::release` sets `releasing = true` (also idempotent). The guard matches `fallback.note_off`'s pre-existing pattern — keeping it aligns the new method with the module's existing style.

7. **`voices_active` computed once per block.** Voices that end mid-block keep the noise floor gated-on for the rest of that block (≤3 ms at typical block sizes). Acceptable; per-sample gating would add a per-voice check to the audio hot path for an imperceptible improvement.

### Plan of edits

| # | File | Change |
| - | ---- | ------ |
| 1 | `crates/daw-dsp/src/levain/voice.rs` | `VoicePool::release_all` already exists — no change. |
| 2 | `crates/daw-dsp/src/levain/fallback.rs` | Add `FallbackToneEngine::release_all`. |
| 3 | `crates/daw-dsp/src/levain/release.rs` | Add `ReleaseTracker::clear_all` (zero per-note start times). |
| 4 | `crates/daw-dsp/src/levain/engine.rs` | Add `LevainEngine::all_notes_off` — releases voice pool + fallback, clears legato / divisi / release-tracker; **does not** call `realism.note_off` (prevents bow-lift burst spam). |
| 5 | `crates/daw-dsp/src/levain/realism/bow_noise.rs` | `tick` takes `voices_active: bool`; continuous component gated, burst envelope still advances. |
| 6 | `crates/daw-dsp/src/levain/realism/breath_noise.rs` | `tick` takes `voices_active: bool`; returns `0.0` when no voices. |
| 7 | `crates/daw-dsp/src/levain/realism/mod.rs` | Propagate `voices_active` through `RealismEngine::tick`. Update test `realism_is_finite_for_every_instrument` to pass `voices_active: true`. |
| 8 | `crates/daw-dsp/src/levain/engine.rs` (`process_block`) | Compute `voices_active = voice_pool.active_count() + fallback.active_count() > 0` once per block, pass to realism. |
| 9 | `crates/daw-dsp/src/levain/mod.rs` | Export `all_notes_off()` on `LevainInstance` via wasm-bindgen. |
| 10 | `src/modules/AudioEngine/services/levainProcessor.ts` | Dispatch `{type:'allNotesOff'}` → `inst.all_notes_off()`. |
| 11 | `src/modules/AudioEngine/engine/LevainNode.ts` | Add `allNotesOff()` to `LevainNodeResult`. |
| 12 | `src/modules/AudioEngine/repositories/createWebAudioEngine.ts` | Replace 128-iter Levain noteOff loop with single `dn.levainControls.allNotesOff()` call. |

Fermenter / Toaster loops in `stopAllScheduled` are **left unchanged** — neither has a per-noteOff noise-burst side effect, so the brute-force loop is not misbehaving there and refactoring them is out of scope for this bug.

### Decisions

- **Gate granularity = block, not sample.** Voice activity only changes between blocks from the processor's perspective (MIDI events are drained at block start; voices go inactive when their release envelope reaches zero, detected at block boundaries by the block-level count). A ≤3 ms gate on an already-quiet noise floor is inaudible. Sample-level gating would need an extra `voice.active` check per voice per sample that the hot path shouldn't carry.
- **Hard gate, no ramp.** Bandpassed white noise has no phase coherence, so an instant amplitude step is not a click — it's a level change below the masking threshold of whatever signal the voice itself produces. A ramp would complicate the burst-envelope interaction (burst continues even when voices just ended).
- **Keep body / sympathetic / damping running unconditionally.** They are pass-through on zero input (they only colour existing signal), so gating them adds cost without benefit and risks freezing filter state at non-zero values.
- **Don't reset `realism` on `all_notes_off`.** The filters have their own stability and carry no "this note is pressed" state; resetting would cause a discontinuity if a voice is still ringing out.
- **Don't clear `articulation` state on `all_notes_off`.** Keyswitches persist across stop in every DAW convention — e.g. a user selected a `legato` keyswitch before hitting play, they expect it still selected after stop.

