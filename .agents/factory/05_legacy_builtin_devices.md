# Legacy Built-in Devices (Web Audio API)

## Overview

In addition to the high-performance Faust DSP modules, the DAW contains a suite of basic built-in devices prefixed with `builtin-` (e.g., `builtin-synth`, `builtin-reverb`). These appear to be older or more fundamental implementations using standard Web Audio API nodes rather than compiled WASM DSP.

While they serve as functional placeholders or lightweight alternatives, they represent a separate tier of factory content from the Faust ecosystem.

## 1. Instruments

### `builtin-synth`

- **Implementation:** A basic Web Audio API subtractive synthesizer.
- **Controls:** Includes 2 oscillators (Sine, Triangle, Sawtooth, Square), a sub-oscillator, noise generator, ADSR amplitude envelope, and a resonant multimode filter (Lowpass, Highpass, Bandpass) with its own envelope amount.
- **Features:** It includes a simple vibrato LFO (rate, depth, delay).
- **Depth & Quality:** It is functional and lightweight, but lacks the character, aliasing-reduction, and analog-modeling depth of the Faust instruments (like the Moog Ladder or Diode Ladder filters).
- **Variants:** It acts as a base for several "preset" variations mapped as distinct device IDs: `builtin-synth-mellotron`, `builtin-synth-strings`, `builtin-synth-808bass`, and `builtin-synth-brass`.

### `builtin-drum-kit`

- **Implementation:** A basic sample-playback or synthesized drum trigger device.
- **Controls:** Very rudimentary. It only exposes a `kit` selector (808, Analog, Electronic, Acoustic, Lo-fi Vinyl, Trap) and a `gain` control.
- **Depth & Quality:** Highly limited. It lacks individual drum voice editing (tuning, decay, pan, levels per drum), multi-out routing, or velocity layering. It acts as a black box rather than a tweakable drum machine.

## 2. Effects

The `builtinEffectDescriptors.ts` file defines a wide array of standard Web Audio effects:

- **Dynamics:** `builtin-compressor`, `builtin-limiter`, `builtin-sidechain-compressor`, `builtin-gain`
- **EQ & Filters:** `builtin-eq`, `builtin-filter`
- **Time & Space:** `builtin-reverb`, `builtin-convolution-reverb`, `builtin-delay`
- **Modulation:** `builtin-chorus`, `builtin-phaser`, `builtin-flanger`, `builtin-tremolo`, `builtin-autopan`
- **Distortion:** `builtin-distortion`, `builtin-bitcrusher`

### Depth & Quality Analysis

- **Strengths:** They cover all the essential bases for music production. They are extremely CPU-efficient since they rely on browser-native Web Audio nodes (like `BiquadFilterNode`, `DynamicsCompressorNode`, `ConvolverNode`).
- **Weaknesses:**
    - They lack the analog modeling and warmth of the Faust equivalents. For instance, the Web Audio `DynamicsCompressorNode` has hardcoded attack/release curves that don't sound as musical as the Faust `1176 Compressor`.
    - The UI for these often relies on generic slider layouts without the specialized visualizations that could make them more intuitive.
    - The `builtin-convolution-reverb` relies on impulse response files which need to be loaded into memory, whereas the Faust algorithmic reverbs compute on the fly.

## Conclusion and UX Recommendations

The codebase currently has a "split brain" between the `builtin-` Web Audio devices and the `faust-` WASM devices.

1. **Redundancy:** Many effects overlap (e.g., `builtin-reverb` vs. `faust-zita-rev1-reverb`, `builtin-eq` vs. `faust-pro-parametric-eq`).
2. **Preset Inconsistency:** As noted in the presets audit, many factory presets default to the inferior `builtin-reverb` and `builtin-delay` instead of the superior Faust effects.
3. **Recommendation:** To unify the DAW's architecture and improve audio quality, the `builtin-` Web Audio effects should ideally be deprecated or hidden from the user-facing browser, completely replaced by their Faust equivalents as the standard non-premium tier. The `builtin-synth` should either be ported to Faust or explicitly labeled as a "Basic Synth" to distinguish it from the Pro synths.
