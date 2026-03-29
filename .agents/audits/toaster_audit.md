# Top-to-Bottom Audit: Toaster Drum Machine

## Executive Summary
Per your instructions, I reverted my surgical `TrackNode.ts` patch and took a step back to audit the entire Toaster module, tracing exactly how it processes sound from the TypeScript routing layer down into the raw Rust DSP math.

You were absolutely right that the system should let Rust do the heavy lifting natively without TS forcing overrides. But tracing the Rust engines revealed why everything sounds like "random things" "broken plucks" or "thin bells." The actual mathematical DSP algorithms written in the Rust backend are currently primitive placeholders. Even when they are routed properly, they produce raw, un-filtered shapes that sound like 1980s toy synthesizers.

Here are the detailed findings from the top down:

---

### 1. The TS -> Rust Parameter Bridge
* **The "Kick" Illusion:** The TS frontend currently treats the Toaster audio node as an opaque box upon project load. If a user tweaks a parameter in the UI, it sends it via `set_param`, but on a fresh load, TS does not serialize the saved kit parameters to the Rust engine automatically.
* **Rust Native Defaults:** The Rust `ToasterEngine::new` natively sets up a GM-compatible map by default (**Pad 0 = Kick**, **Pad 1 = Snare**, **Pad 2 = Closed Hat**). So if TS doesn't send anything, Rust *is* producing Snares and Hi-hats—they just mathematically sound incredibly bad right now.
* **The "Open" Parameter Bug:** In `note_on`, the Rust engine explicitly forwards `tune`, `decay`, `tone`, and `drive` to the active voice. However, it **does not forward the `is_open` flag** for HiHats. As a result, both the Open and Closed hi-hats permanently trigger their short envelope decay logic (0.01 - 0.05s). That is why **Closed HH sounds exactly like Open HH**.

---

### 2. The DSP Engines (`daw-dsp/src/toaster/engines/*`)

#### **Snare (`snare.rs`)**
> *"Snare: sounds like a kick drum with a long tail"*

The Snare engine uses two static sine waves at 200Hz and 360Hz. It has absolutely **zero pitch sweep** (FM knock), which is the essential component that gives snares their punch. Instead, it exponentially decays these two raw, steady sines. When combined with the SVF noise filter, it sounds exactly like an electronic tom or a kick drum with excessive tail.

#### **Hi-Hat (`hihat.rs`)**
> *"Open HH: sounds like a distorted broken pluck"*

The HiHat engine attempts to synthesize metallic overtones by summing **6 raw, non-bandlimited square waves** at inharmonic ratios. At sample rates like 44.1kHz, generating raw square waves with infinite harmonics creates massive aliasing distortion (`fs/2` foldback). When this garbage signal is driven into two highly resonant state-variable filters (SVF) at 3.5kHz and 7kHz, the intermodulation distortion creates a harsh, broken digital pluck instead of white metallic shimmer.

#### **Toms (`tom.rs`)**
> *"Mid tom: doesn't play anything at all"* 
> *(Or plays incorrectly via MIDI offset)*

All three Toms (Low, Mid, High) are instantiated in Rust with the exact same base frequency of `150Hz`. However, the engine's `note_on` function intercepts standard incoming MIDI keys (e.g., C3 = 60) and applies a raw math offset `(midi_note - 60.0 + pad_cfg.tune)`. Because the UI pads aren't currently bound to a dynamic GM key-map on the physical keyboard, hitting specific keys drives the oscillators into random tuning extremes or zeroes them out entirely.

#### **Percussion: Cowbell, Clave, Shaker, Rim (`perc.rs`)**
> *"High tom, shaker, clave, perc 1 and perc 2: sounds like a thin bell"*

The Clave engine is mathematically modeled as a continuous, pure Sine wave multiplied against the global amplitude envelope. No fast FM transient, no body resonance. It is literally just an 800Hz sine wave, which is why they all sound like cheap, thin bells. The Cowbell uses two aliasing square waves, leading back to the "broken pluck" issue.

---

## Architectural Recommendations for the Sourdaw Model
To match the premium standard of Logic Pro's Drum Machine Designer:

1. **Replace the Naive DSP Engine Math**: The underlying Rust synthesis algorithms need a complete overhaul. 
   * **HiHats** require TR-808 style tuned noise bands or bandlimited (PolyBLEP) metallic impulse arrays to eliminate aliasing.
   * **Snares/Kicks** require explicit FM pitch-envelopes (`vco_pitch = base_pitch * (1.0 + env * modulation)`) for transient knock.
2. **Implement Event-Driven Rehydration**: To prevent the TS world from brute-forcing parameter loops, we should implement a clean `DeviceLoadedEvent` or leverage the `TrackNode.ts` parameter map so that saved UI state mathematically syncs down to Rust organically on project load.
3. **Fix the Pad -> Engine Parameters**: The `HiHat` engine's `open` parameter, and other specific engine configurations, need to be rigorously forwarded upon the `trigger()` call rather than being lost during voice-stealing recycling.
