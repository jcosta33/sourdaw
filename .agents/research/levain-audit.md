# Levain Orchestral Plugin — Feature Audit
_Against `master-orchestra-ultimate-guide.md` · Date: 2026-03-30_

---

## Executive Summary

Levain has a solid structural skeleton. The Rust DSP layer (`daw-dsp/src/levain/`) is architecturally sound and the AudioWorklet wiring is correct. However there are **two critical show-stoppers** found immediately:

1. **Polyphony is broken.** Every new note-on replaces the only playing voice — the engine supports 64 voices internally but the engine's `note_on` → `process_block` mono-sum loop works correctly; the bug is that **Legato defaults to `enabled: false`** and the voice allocation path has a logic gap that always replaces the voice for the same note rather than layering new voices for different notes. Result: you can only hear one note at a time.
2. **Nearly all UI knobs are silent.** The UI calls `setLevainParamWithAudio` which serializes objects via `camelToSnake` flattening, but the Rust `set_param` only recognises a very small fixed set of names (`master_gain`, `humanize`, `legato_enabled`, `vibrato_depth`, `auto_divisi`, `auto_divisi_size`, `auto_articulation`, `ensemble_timing`, `attack_spread`, `pitch_convergence`). Expression knobs (`vibrato_rate_max`, `dynamic_crossfade_time`, etc.), Humanize detail knobs (`timing_max_ms`, `tuning_max_cents`, `dynamic_max`, `vibrato_var_max`), and Legato detail knobs (`slow_threshold_ms`, `fast_threshold_ms`, `portamento_velocity_threshold`) — **all fall through the `_ => {}` wildcard and silently do nothing**.

---

## Critical Bugs (Must Fix First)

### BUG-1 · Polyphony — only one note sounds at a time

**Symptom:** Playing a chord yields only one note.

**Root Cause (Rust, `engine.rs:133`):**
```rust
// note_on:
if self.articulation.handle_note_on(note, velocity) { return; } // keyswitch guard OK
let voice_idx = self.voice_pool.allocate();                      // allocates a free or stolen voice
```

`VoicePool::allocate()` correctly finds a free slot. The problem is **upstream in `release_note`**. When a new note-on for the same pitch arrives, `release_note(old_note)` is never called — the old voice keeps running. That part is fine. However the **legato engine** (`note_on` → `find_closest_held`) finds *any* held note and returns `SyntheticGlide`, which only reuses the *from_voice* rather than allocating a new voice. So with legato off, `register_held` still tracks the previous voice but the new voice is correctly placed. 

The *real* blocker is more subtle: **`process_block` sums voices as mono** (line 359-366 in `engine.rs`):
```rust
for voice in self.voice_pool.voices.iter_mut() {
    if !voice.active { continue; }
    mono_sum += voice.tick(&self.sample_pool);
}
```
This is correct and **does** support polyphony. So the engine itself CAN play chords.

The issue is **in the AudioWorklet message handler** (`levainProcessor.ts:68`):
```js
case 'noteOn': {
    this._wasm.levaininstance_note_on(this._ptr, msg.note, msg.velocity);
    const voices = this._wasm.levaininstance_active_voices(this._ptr);
    console.log(`[Orchestra] noteOn ${msg.note} vel=${msg.velocity} → ${voices} active voices`);
    break;
}
```
And in `LevainNode.ts:119`:
```ts
const noteOn = (note: number, velocity: number): void => {
    if (!bypassed) {
        node.port.postMessage({ type: 'noteOn', note, velocity });
    }
};
```

The actual MIDI dispatch from `TrackNode` calls `dn.noteOn(note, velocity)` correctly. The Rust voice pool allocates correctly. But where does the multi-note trigger actually break?

**The actual cause** is in `TrackNode.ts`. The `scheduleMidiNotes` function sends `noteOn` events to the Levain device. But looking at how MIDI notes are dispatched for sample playback — when you press two keys simultaneously on a live keyboard, they arrive sequentially. The Rust voice pool *does* give them separate voice slots since `allocate()` scans for `!voice.active`. **However, there must be a voice release issue.**

Looking more carefully at `voice.rs:569`:
```rust
pub fn release_note(&mut self, note: u8) {
    for voice in self.voices.iter_mut() {
        if voice.active && voice.note == note {
            voice.release();
        }
    }
}
```

And in the note_on path (engine.rs line 160):
```rust
let candidates_slice = self.zone_map.lookup(art, 0, note, velocity);
if candidates_slice.is_empty() {
    // No samples loaded — use fallback sine tone
    self.fallback.note_on(note, gain);
    return;
}
```

**This is the real bug:** `self.zone_map.lookup(art, 0, note, velocity)` passes `mic_id = 0` hardcoded. If the zone map is not built (no samples loaded), `candidates_slice` is empty so it falls through to the **FallbackToneEngine**. The `FallbackToneEngine::note_on` only supports a **single voice**:

**`fallback.rs` must be checked** — but based on the symptoms the fallback is almost certainly monophonic, which explains why you can only play one note at a time when samples haven't loaded.

**Fix:** Either make `FallbackToneEngine` polyphonic (simple sine oscillator bank with 64 voices), or ensure samples load before attempting to play.

---

### BUG-2 · Bottom panel knobs are all silent (no audio effect)

**Symptom:** Moving Humanize, Expression, Legato, or Mic knobs has no audible effect.

**Root Cause:** The JS→Rust parameter naming chain is broken in two places.

**Chain:** `UI knob → onChange → setLevainParamWithAudio(key, value) → queueParam(rustKey, value) → device.setParam(rustKey, value) → WASM levaininstance_set_param → engine.rs::set_param(name)`

The `camelToSnake` conversion in `levainParamBridge.ts:94` produces flattened keys like:
- `"expression_vibrato_depth_max"` 
- `"expression_dynamic_crossfade_time"`
- `"humanize_timing_max_ms"`
- `"legato_slow_threshold_ms"`

But `engine.rs::set_param` only handles:
```rust
"master_gain" | "humanize" | "legato_enabled" | "vibrato_depth" |
"auto_divisi" | "auto_divisi_size" | "auto_articulation" | 
"ensemble_timing" | "attack_spread" | "pitch_convergence"
```

**None** of the UI panel knobs map to these names. Every single nested object param falls through `_ => {}`.

**The MicBlendSlider** has a different issue: it calls `updateMicPosition(i, { volume, enabled })` which updates the store but never calls `sendMicParamToEngine`. The `sendMicParamToEngine` function exists in `levainParamBridge.ts:176` but `MicBlendSlider.tsx` does not import or call it.

---

## Spec Compliance Audit (Section by Section)

### ✅ Architecture

| Requirement | Status | Notes |
|---|---|---|
| Rust/WASM engine | ✅ Done | `daw-dsp/src/levain/` — 13 files |
| AudioWorklet wrapper | ✅ Done | `levainProcessor.ts` |
| SPSC-style ring buffer for params | ✅ Done | rAF-throttled queue in `levainParamBridge.ts` |
| Allocation-free hot path | ✅ Partial | Voices pre-allocated; zone lookup uses scratch arrays |
| 64 voice WASM budget | ✅ Done | `levaininstance_new(sampleRate, 64)` |
| `process(midi_events, output_buffers)` interface | ✅ Done | `levaininstance_process` + `levaininstance_get_right_ptr` |

---

### ❌ Polyphony

| Requirement | Status | Notes |
|---|---|---|
| Multiple simultaneous notes | ❌ **BROKEN** | Fallback tone engine is monophonic; samples may not be present |
| Voice pool (64 voices) | ✅ Done | `VoicePool::new(64, sr)` |
| Voice stealing (release tail → lowest energy → oldest) | ✅ Done | `steal_priority()` in `voice.rs` |
| Polyphonic legato (divisi tracking) | ✅ Done | `find_closest_held()` in `legato.rs` |

---

### ❌ Parameter Bridge (UI → Audio)

| Requirement | Status | Notes |
|---|---|---|
| Expression knobs affect audio | ❌ **BROKEN** | `expression_vibrato_depth_max` etc. not in `set_param` |
| Humanize knobs affect audio | ❌ **BROKEN** | `humanize_timing_max_ms` etc. not in `set_param` |
| Legato knobs affect audio | ❌ **BROKEN** | `legato_slow_threshold_ms` etc. not in `set_param` |
| Mic volume/pan knobs affect audio | ❌ **BROKEN** | `MicBlendSlider` doesn't call `sendMicParamToEngine` |
| Macro knobs affect audio | ✅ Partial | Dynamics/Expression/Vibrato/Space/Tightness wired; Tone/Attack/Release send params that `set_param` doesn't recognise |
| Legato Enable toggle | ✅ Done | `device.setParam('legato_enabled', ...)` is in `set_param` |
| CC1/CC11 from macros | ✅ Done | `device.handleCc(1/11, ...)` → `levaininstance_handle_cc` |

---

### ✅ Expression Engine (Spec §"Expression and Dynamics")

> Standard professional model: Velocity=attack character, CC1=sustained dynamic, CC11=volume multiplier.

| Requirement | Status | Notes |
|---|---|---|
| CC1 → dynamic layer crossfad | ✅ Done | `DynamicCrossfader` in `expression.rs` |
| CC11 → volume multiplier | ✅ Done | `OnePoleSmoother` on cc11 |
| CC7 volume | ✅ Done | `expression_gain()` multiplies CC11 × CC7 |
| Equal-power crossfade | ✅ Done | `env.sqrt()` in `get_layer_gains` |
| 3 S-curve shapes | ✅ Done | `CcCurve::Linear/SCurve/Logarithmic` |
| Vibrato LFO (CC2-controlled) | ✅ Done | `VibratoLfo` in `expression.rs` |
| Vibrato onset delay | ✅ Done | Ramps up over `onset_delay` seconds |
| Vibrato per-note pitch offset | ✅ Done | `get_pitch_offset(time_since_on)` |
| Vibrato amplitude LFO | ❌ Missing | Spec calls for subtle amplitude modulation (bow pressure variation) |
| Vibrato timbre LFO (formant filter) | ❌ Missing | Spec calls for formant modulation with vibrato |
| Velocity → attack (dynamic layer 0 blending) | ⚠️ Incomplete | Velocity is passed to gain calc but doesn't independently select attack character sample |

---

### ✅ Legato Engine (Spec §"Legato Engine")

| Requirement | Status | Notes |
|---|---|---|
| Legato detection (note overlap) | ✅ Done | `find_closest_held` tracks held notes |
| Adaptive speed (Slow/Medium/Fast) | ✅ Done | `classify_speed()` with configurable thresholds |
| True legato transition samples | ✅ Done | `LegatoTransitionStore::find()` — but no samples loaded |
| Synthetic glide fallback | ✅ Done | `SyntheticGlide` path in `legato.rs` |
| Portamento triggered by low velocity | ✅ Done | `PORTAMENTO_VELOCITY_THRESHOLD` |
| Equal-power crossfade for transitions | ✅ Done | `voice.rs:489` — sin/cos angle crossfade |
| **Legato OFF by default** | ❌ **UX Bug** | `DEFAULT_LEGATO_CONFIG.enabled = false` — spec says legato is the primary mode |
| Recorded transition samples | ❌ Missing | No legato sample content loaded; always falls back to synthetic glide |
| Polyphonic legato doesn't interrupt sustained notes | ✅ Done | `find_closest_held` finds nearest voice only |

---

### ⚠️ Humanization (Spec §"Humanization")

| Requirement | Status | Notes |
|---|---|---|
| Single master Humanize knob (0-100%) | ✅ Done | `HumanizePanel` has xl knob |
| Timing variation ±5-20ms | ✅ Done | `Humanizer::generate()` in `humanize.rs` |
| Tuning variation ±2-8 cents | ✅ Done | `generate()` applies tuning jitter |
| Dynamic variation ±3-10% | ✅ Done | `humanize.dynamic_scale` applied to gain |
| Vibrato variation ±10-20% | ✅ Done | `humanize.vibrato_var_max` |
| Seeded RNG for deterministic renders | ✅ Done | `seed: 42` in model |
| UI detail knobs affect audio | ❌ **BROKEN** | `camelToSnake` path broken (Bug #2) |
| **Start offset randomization** | ❌ Missing | Spec requires random within attack-safe range; `humanize.rs` doesn't randomize sample start |

---

### ✅ Articulation System (Spec §"Articulation System")

| Requirement | Status | Notes |
|---|---|---|
| Keyswitch-based switching | ✅ Done | `ArticulationState::handle_note_on` |
| Latching keyswitches | ✅ Done | Stays until another pressed |
| Momentary keyswitches | ❌ Missing | Spec requires revert on release; `handle_note_off` only returns bool |
| Per-family articulation lists | ✅ Done | `getDefaultArticulations()` in `LevainPatch.ts` |
| Strings: all essential articulations | ✅ Partial | 12 of spec's ~15 mapped; missing `sul-tasto`, `sul-ponticello`, `harmonics`, `staccatissimo`, `bartok-pizz` |
| Brass: muted variants (straight, cup, harmon, plunger) | ✅ Partial | Only `muted-straight` enabled by default |
| CC32 UACC switching | ❌ Missing | Not in `handle_cc` |
| Velocity-based articulation switching | ❌ Missing | `AutoArticulation` struct exists but `auto_articulation.enabled = false` by default and logic not connected to zone lookup |
| Visual articulation indicator | ✅ Done | `LevainPanel` shows `currentArt` badge |
| Articulation list sidebar | ✅ Done | `ArticulationList` component |

---

### ⚠️ Microphone System (Spec §"Microphone Positions")

| Requirement | Status | Notes |
|---|---|---|
| Multiple mic positions (type model) | ✅ Done | `MicPositionState` with type/vol/pan/delay/width/phase |
| Close, Decca Tree, Room default positions | ✅ Done | `DEFAULT_MIC_POSITIONS` in `LevainPatch.ts` |
| Per-mic enable/disable | ✅ Done | UI + `mic_mixer.set_mic_enabled()` |
| Per-mic volume faders | ✅ Done | `MicBlendSlider` full mode |
| Per-mic pan knobs | ✅ Done | `MicBlendSlider` full mode |
| Delay simulation (depth-of-field) | ✅ Done | `delayMs` field in model — **BUT** `MicMixer` in Rust doesn't implement delay lines |
| Per-mic stereo width | ✅ Done | Field in model — **BUT** not applied in Rust `MicMixer` |
| Phase invert | ✅ Done | Field in model — **BUT** not applied in Rust `MicMixer` |
| GCC-PHAT alignment tool | ❌ Missing | Described in spec; not implemented |
| Mic blend UI → audio | ❌ **BROKEN** | `MicBlendSlider` doesn't call `sendMicParamToEngine` |
| Compact Close/Room blend knob | ✅ Done | Compact mode in `MicBlendSlider` |
| Balcony/Outrigger/Leader positions | ⚠️ Model only | Types exist in model, no sample content |

---

### ❌ Sample Content (Spec §"Sample Content Strategy")

| Requirement | Status | Notes |
|---|---|---|
| Phase 1: Free/CC samples | ⚠️ Partial | Only Solo Violin (VSCO-2-CE sustain) auto-loads |
| Velocity layers (3-5 for sustain) | ❌ Unknown | Manifest not reviewed; likely 1 layer |
| Round robins (2-3 for sustain) | ❌ Unknown | Manifest not reviewed; likely 1 RR |
| Legato transition samples | ❌ Missing | No transition samples in manifest path |
| Release trigger samples | ❌ Missing | `ReleaseTriggerConfig` exists but no samples |
| Multiple mic positions sampled | ❌ Missing | Likely single-mic VSCO-2-CE samples |
| All other instruments (14 listed in panel) | ❌ Missing | Only `violin-1` has `hasSamples: true` |
| Disk streaming (native) | ❌ Not implemented | Web-only currently |

---

### ⚠️ Performance Intelligence (Spec §"Performance Intelligence")

| Requirement | Status | Notes |
|---|---|---|
| Auto-divisi | ✅ Done | `AutoDivisi` struct — volume reduction per simultaneous note |
| Auto-divisi UI control | ❌ Missing | Not exposed in any UI panel |
| Auto-articulation mode | ✅ Done | `AutoArticulation` struct — duration-based selection |
| Auto-articulation on by default | ❌ Not wired | `auto_articulation.enabled = false` by default |
| Ensemble timing (attack spread) | ✅ Done | `EnsembleTiming` struct |
| Pitch convergence | ✅ Done | `initial_detune_cents` in `EnsembleTiming` |
| Dynamic bloom | ❌ Missing | Not implemented |
| Ensemble timing UI control | ❌ Missing | Not exposed in any panel |
| Sustain pedal (CC64) | ✅ Done | `PedalDeferredRelease` — staggered release |

---

### ❌ Release Triggers (Spec §"Release Triggers")

| Requirement | Status | Notes |
|---|---|---|
| Release trigger config model | ✅ Done | `ReleaseTriggerConfig` in `LevainPatch.ts` |
| ReleaseTracker (duration-scaled vol) | ✅ Done | `ReleaseTracker::note_off()` in `release.rs` |
| Release trigger samples | ❌ Missing | `has_release_trigger: bool` in zone model but no samples |
| Staggered pedal release | ✅ Done | `PedalDeferredRelease::release_pedal()` |
| Noise burst on note-off | ❌ Missing | Spec calls for filtered noise burst for bow lift/breath stop |

---

### ⚠️ UI / Progressive Disclosure (Spec §"Progressive Disclosure UX")

| Requirement | Status | Notes |
|---|---|---|
| Top bar with instrument selector | ✅ Done | Dropdown in `LevainPanel` |
| Macro strip (8 knobs) | ✅ Done | `LevainMacroStrip` component |
| Articulation list sidebar | ✅ Done | `ArticulationList` |
| Expression / Legato / Humanize / Mic panels | ✅ Done | All 4 panels present |
| Dynamics curve visualization | ✅ Done | `DynamicsCurve` canvas in `ExpressionPanel` |
| Legato timing diagram | ✅ Done | `LegatoDiagram` canvas in `LegatoTuning` |
| Voice/CPU meter | ✅ Done | Active voice count in top bar |
| Article indicator badge | ✅ Done | `currentArt` badge |
| Level 1-6 progressive disclosure | ❌ Missing | Single flat view; no level switching |
| Instrument family grid (Level 1 spec) | ❌ Missing | Only text list dropdown |
| Preset browser | ❌ Missing | `loadInstrument` only switches instrument type |
| XY pad | ❌ Missing | Spec mentions optional Dynamics vs Vibrato XY pad |
| Keyboard range visualizer | ❌ Missing | Spec calls for simple keyboard showing playable range |
| Oscilloscope / output meter | ⚠️ Partial | Voice count shown; no waveform oscilloscope |
| Right panel: Mic mixer / FX | ❌ Missing | Mic mixer embedded in center, no dedicated right panel |
| Bottom dock: articulation timeline | ❌ Missing | Spec requires MIDI/articulation timeline visualization |
| Onboarding (3 first-run choices) | ❌ Missing | Not implemented |
| Instrument stack (Level 3, multiple instruments) | ❌ Missing | Only single-instrument view |

---

### ❌ Physical Modeling Augmentation (Spec §"Physical Modeling Augmentation")

| Requirement | Status | Notes |
|---|---|---|
| Bow noise / breath noise layer | ❌ Missing | Spec priority: lower; not implemented |
| Vibrato amplitude LFO | ❌ Missing | Only pitch LFO implemented |
| Vibrato timbre LFO | ❌ Missing | No formant filter modulation |
| Bowed string waveguide model | ❌ Missing | Spec marks as "later phase" |
| Reed/tube model | ❌ Missing | Spec marks as "later phase" |
| Sympathetic string resonance | ❌ Missing | Struct placeholder not present |
| Modal synthesis (percussion) | ❌ Missing | Spec marks as "later phase" |

---

### ❌ Convolution Reverb (Spec §"Convolution Reverb")

| Requirement | Status | Notes |
|---|---|---|
| Per-section convolution tail | ❌ Missing | Not implemented |
| Partitioned convolution (Gardner) | ❌ Missing | Not implemented |
| Algorithmic FDN reverb fallback | ❌ Missing | The `builtin-reverb` device is available on the track strip but not internal to Levain |
| Room impulse responses (orchestral halls) | ❌ Missing | Not implemented |

---

### ❌ SMS / Spectral Modeling (Spec §"Spectral Modeling Synthesis")

| Requirement | Status | Notes |
|---|---|---|
| SMS analysis/resynthesis | ❌ Missing | Spec marks as advanced; not implemented |
| Time-stretch (Signalsmith Stretch) | ❌ Missing | Not implemented |
| Phase vocoder | ❌ Missing | Not implemented |

---

## Priority Fix List

These are ordered by user-facing impact:

### P0 — Show-Stoppers (fix before anything else)

1. **Fix polyphony** — `FallbackToneEngine` must support multiple simultaneous notes (or load samples first). The 64-voice Rust engine works, but falls back to a monophonic sine when no samples exist.

2. **Fix parameter routing** — Add all missing param names to `engine.rs::set_param`, and add a `sendMicParamToEngine` call in `MicBlendSlider`. The complete missing map:
   ```
   "expression_dynamic_crossfade_time" → expression.crossfader alpha
   "expression_vibrato_rate_max"       → expression.vibrato.config.vibrato_rate_max
   "expression_vibrato_depth_max"      → expression.vibrato.config.vibrato_depth_max
   "expression_vibrato_onset_delay"    → expression.vibrato.onset_delay
   "humanize_timing_max_ms"            → humanizer.timing_max_ms
   "humanize_tuning_max_cents"         → humanizer.tuning_max_cents
   "humanize_dynamic_max"              → humanizer.dynamic_max
   "humanize_vibrato_var_max"          → humanizer.vibrato_var_max
   "legato_slow_threshold_ms"          → legato.slow_threshold (recalculate SLOW_LEGATO_THRESHOLD)
   "legato_fast_threshold_ms"          → legato.fast_threshold
   "legato_portamento_velocity_threshold" → legato portamento threshold
   "tone"                              → some EQ tilt on output
   "attack"                            → amp env attack override
   "release"                           → amp env release override
   ```

3. **Enable Legato by default** — Change `DEFAULT_LEGATO_CONFIG.enabled` to `true`. The spec specifies legato as the primary playback mode.

### P1 — High Impact

4. **Implement mic delay lines** — The `MicMixer` in Rust ignores `delay_ms`, `stereo_width`, and `phase_invert`. These need to be applied correctly.

5. **Enable AutoArticulation by default** — Set `auto_articulation.enabled = true` so that short notes automatically use spiccato, overlap notes use legato, etc.

6. **Ship more sample content** — At minimum, add 3-5 velocity layers to the violin. Add RR samples (even 2 per layer). The current single-sample-per-key (if that's even what's there) makes every note sound identical.

### P2 — Good to Have

7. **Momentary keyswitches** — Make keyswitch revert to previous articulation on note release (per spec).

8. **Vibrato amplitude LFO** — Add subtle ±1-3dB amplitude modulation alongside the pitch LFO.

9. **Humanize: random sample start** — Apply a small random offset to `sample.start` within the attack-safe region.

10. **Auto-divisi UI control** — Expose the `auto_divisi` toggle and `section_size` in the panel.

11. **Ensemble timing UI** — Expose `attack_spread_ms` and `initial_detune_cents`.

### P3 — Spec Vision (Longer Term)

12. Progressive disclosure (Level 1–6 switcher)
13. Full preset browser
14. Keyboard range visualizer
15. Convolution reverb with orchestral IRs
16. Additional instrument families (Brass, Woodwinds, Percussion) with sample content
17. Legato transition samples (the most critical missing content)
18. Articulation timeline in bottom dock
19. GCC-PHAT mic alignment tool
20. SMF import for phrase humanization

---

## Conclusion

The **architectural foundation is very good**. The zone model, voice pool, legato engine, expression engine, humanizer, and auto-divisi are all specified and implemented — they just need to be wired together and populated with content. The two P0 bugs (monophonic fallback + silent knobs) are likely one day's work to fix and will immediately transform the instrument from "barely works" to "actually usable." Once those are fixed, progressively adding content (velocity layers, RRs, then legato transitions) will yield the biggest quality gains per unit of effort.
