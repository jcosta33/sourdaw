# Factory Content Status & Recommendations

This document consolidates and replaces previous factory audits (01-06).

## 1. Instrument Depth & Features

**What is Missing/Recommended:**

- **Custom Drawbar UI:** The Hammond B3 is a flagship model, but still uses standard horizontal sliders mapped under a generic `Drawbars` category.
    - _Recommendation:_ Implement a custom UI component for the 9 drawbars (vertical orientation, pull down to increase) to provide an authentic, tactile experience in `FaustInstrumentLayout.tsx`.

## 2. Presets and Content

**What is Missing/Recommended:**

- **Quantity of Presets:** Currently, there are 44 instrument presets across 9 synths and 10 effect presets. This averages out to ~5 presets per instrument, which is too sparse for a modern DAW.
    - _Recommendation:_ Aim for at least 10-15 presets per instrument. Include more experimental edge cases and rhythmic variations to demonstrate the new LFO capabilities.

## 3. Legacy Web Audio Devices

**Current State:**
The codebase still relies on a "split brain" architecture, retaining basic built-in devices prefixed with `builtin-` (e.g., `builtin-synth`, `builtin-reverb`, `builtin-drum-kit`).

**What is Missing/Recommended:**

- **Deprecate Legacy Redundancy:** These Web Audio effects overlap significantly with the high-quality `faust-` WASM devices.
    - _Recommendation:_ The `builtin-` Web Audio effects should eventually be deprecated or hidden from the user-facing browser, establishing the Faust equivalents as the standard non-premium tier. The `builtin-synth` should either be ported to Faust or explicitly labeled as a "Basic Synth".
- **Flagship Drum Machine vs `builtin-drum-kit`:** The current DAW only features a rudimentary `builtin-drum-kit` with no individual voice editing or multi-out routing. The comprehensive Drum Machine defined in `.agents/specs/factory/drum-machine.md` remains largely unimplemented and must be built according to that spec and its consolidated research (`.agents/research/factory/advanced-instruments.md`, `.agents/research/factory/active/drum-machine-realism.md`). _(Earlier audits referenced a removed working filename `master-drum-machine-ultimate-guide.md`.)_

## 4. Software Patterns

**What is Missing/Recommended:**

- **Phase 4: WAM 2.0 Descriptor Unification (Pending):** Currently, descriptors are still scattered across multiple files (`faustEffectDescriptors.ts`, `builtinEffectDescriptors.ts`).
    - _Recommendation:_ Consolidate these into a unified WAM 2.0 registry structure, so the UI only interacts with one generic slider component format based on the WAM spec.

## 5. Implementation Divergences & Improvements (Completed)

The following items from the original specs were implemented differently than suggested, resulting in a superior architectural outcome:

- **Flexible `DeviceFactoryRegistry` Matchers:** The spec (`06_factory_content_software_patterns.md`) suggested matching device types to factories using a strict string prefix (e.g. `'faust'`). The implementation (`AudioDeviceStrategy.ts`) diverged by supporting flexible regex-like testing functions or string prefixes via an array of matchers. This provides much more power for intercepting or overriding specific device creations without rigid string parsing.
- **Enhanced `AudioDeviceStrategy` Context:** The spec proposed passing just the string ID to the device creator. The implementation passes the entire `Device` data model into the creator, giving the factory full access to device state, bypassing flags, and configuration at instantiation time.
- **Extended Strategy Methods:** The implemented strategy includes `setBypass` and separates `noteOrPad` and `midiNote` mapping for the `noteOn` method to better handle the distinction between generic MIDI notes and specific drum machine pads, which was completely overlooked in the original spec.

## 6. Incomplete / Lesser Implementations (Needs Fixing)

The following items were implemented, but in a way that chose an "easy way out" rather than the optimal engineering solution dictated by the specifications:

- **Wavetable Synth / Morphing Synth Shortcut:** The original specification strongly recommended implementing a true wavetable lookup oscillator in Faust to bring the synthesizer up to modern industry standards. It noted that as a fallback, the current instrument (which is merely a 4-shape static crossfader) could be renamed to "Morphing Synth" to set accurate user expectations. The implementation simply opted for the rename and updated the parameter mappings to `/wt/morph`. While technically compliant, it completely bypasses the engineering goal of providing a flagship true wavetable oscillator module for sound design.

## 7. Massive Factory-Content Expansion

**What is Missing/Recommended:**

- **Content Volume & Usability:** The current ~44 presets are insufficient. To rival paid DAWs (like Bitwig or Ableton), Sourdaw needs to feel "bottomless" before third-party plugins matter. It is not just about more devices, but immediately usable material.
    - _Recommendation:_ Build bread-and-butter sounds (pianos, EPs, basses, plucks, pads, leads, strings, brass, organs).
    - _Recommendation:_ Modern drum kits across multiple genres.
    - _Recommendation:_ Mix-ready starter chains and genre starter packs.
    - _Recommendation:_ Artist/demo sessions to showcase capabilities.
    - _Recommendation:_ Macro-ed factory racks, not just naked presets.
    - _Recommendation:_ A truly good browser-first search/tag/favorite experience.
