# Toaster Drum Machine: Deep Audit & Diagnostics 

I have performed a fine-tooth comb analysis from the React frontend, down through the TypeScript AudioWorklet bridges, and into the raw WASM compilation pipeline and Rust DSP math. 

Here are the root causes of the timbral anomalies, the unresponsive presets, and why "barely anything has changed."

## 1. THE SMOKING GUN: You Are Running an Ancient WASM Engine
The most catastrophic bug is in the build and loading pipeline.
When the project's folder architecture was consolidated into `daw-dsp` (as part of the 5-crate rule), the `package.json` command was updated to combine all synthesizers into one compilation target:
`"wasm:dsp": "cd crates/daw-dsp && wasm-pack build --target web --out-dir ../../public/wasm/daw-dsp"`
This successfully generates a single new binary named **`daw_dsp_bg.wasm`**.

However, **the React Audio Engine never loads it.**
- `ToasterNode.ts` is still hardcoded to fetch `const DEFAULT_WASM_URL = '/wasm/toaster/toaster_bg.wasm';`
- `ToasterProcessor.ts` checks for `imp.module === './toaster_bg.js'`, which would crash on the new binary anyway.
- **Worse yet:** `FermenterNode` and `LevainNode` suffer from *the exact same bug*. They fetch `/wasm/fermenter/fermenter_bg.wasm`.

**Conclusion:** The browser is loading pre-refactoring ghost files left over in your `/public` folder. All the new "analog" synthesis math, Loopback FM logic, and Rust bug fixes have **never actually been executed in your browser.** You are literally hearing an older version of the codebase.

## 2. The Broken React-to-Audio Thread Bridge
When manipulating knobs to change `drive`, `decay`, or `tone`, those values are routed through `src/modules/Toaster/useCases/toasterParamBridge.ts`. 
During a previous UI renaming pass, this file was missed:
```typescript
if (device.type === 'grinder') {  // <--- Bug: Should be 'toaster'
    refs.push({ trackId: track.id, deviceId: device.id });
}
const dn = strip.deviceNodes.find((d) => d.grinderControls?.ready); // <--- Bug
```
Because it searches for `grinder`, the bridge fails silently. Moving UI knobs on the front-end never transmits messages to the WASM audio thread. 

## 3. The DSP Bugs Waiting in the Dark
Once we fix the WASM pipeline (Step 1), the new DSP code *will* load... but it will immediately break across several drum models because the Rust parameters are mapped destructively against UI macros:

### The Snare (Sounds like a Kick Drum)
```rust
// Inside snare.rs `set_param`
"drive" => self.snappy = value.clamp(0.0, 10.0) / 10.0,
```
- Standard UI presets (like "Plain Bread") map `pad.drive` to `0`. 
- When `loadToasterKit.ts` pushes that `drive = 0` to the WASM, the new Rust code forces `self.snappy = 0`.
- Since `snappy` controls the volume of the snare wire noise, the entire noise layer is muted. You are left with only the underlying "body" sine waves, which mathematically sounds identical to a high-pitched kick drum.

### The Hi-Hat (Thin and Missing Harmonic Ratios)
- In `hihat.rs`, the documentation says it uses "six square oscillators at inharmonic metallic ratios". It even defines a generic constant for it: `const RATIOS: [f32; 6] = [1.0, 1.4, 1.68, 2.0, 2.4, 2.82];`.
- **The Bug:** `RATIOS` is permanently ignored/unused by the code. The tick function only actually calculates two oscillator phase accumulators, producing a very thin ring-mod-style chirp instead of a dense metallic cluster.

### Cowbell & Shaker (Missing Noise Exciter)
- In `perc.rs`, the shaker relies heavily on `noise_level`. However, `noise_level` is initialized to `0.0` inside `new()`.
- Because the limited 10-knob UI (volume, pan, tune, decay, tone, drive, cutoff, resonance, send_rev, send_dly) doesn't have a parameter for `noise_level`, it is never set. The Shaker and sections of the Rimshot are left starved of the noise floor they mathematically require to be audible.

## Resolution Recommendations (The Fix)

To solve all issues completely:

1. **Pipeline Restructuring (`ts` bridge)** 
    - Unify `FermenterNode`, `ToasterNode`, and `LevainNode` to all fetch and instantiate from `/wasm/daw-dsp/daw_dsp_bg.wasm`. 
    - Update their `Processor.ts` files to intercept `./daw_dsp_bg.js` imports instead of individual crate imports.
2. [x] **Bridge Repair (`toasterParamBridge.ts`)** 
    - Rename all internal `grinder` references to `toaster` so that live UI tweaking works.
3. **Decouple and Complete the DSP Math** 
    - **Snare/Percussion:** Remove the hardcoded bounds tying UI macros to basic internal constants. The instruments should load with robust, authentic default acoustic values (e.g. `snappy` is always high for a snare), and UI knobs like `drive` should just behave as secondary saturation stages.
    - **Hi-Hat:** Implement a loop iterating over the `RATIOS` array so that all 6 inharmonic bands are present.
