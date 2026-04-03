# Bugs, Inconsistencies, and Recommendations

Based on the audit of the Faust instruments, presets, and UI, here is a consolidated list of actionable issues and recommendations.

## 1. Critical Bugs & Inconsistencies
*   **Preset Effect Chains Ignore Faust Effects:** The factory instrument presets (`faustInstrumentPresets.ts`) rely on generic placeholder effects (`type: 'builtin-reverb'`, `type: 'builtin-delay'`) rather than the high-quality Faust effects (`Zita-Rev1 Reverb`, `Tape Delay`) that have been implemented. 
    *   *Fix:* Update the helper functions in `faustInstrumentPresets.ts` to utilize the `faust-[effect-name]` identifiers and map the parameters correctly to showcase the best DSP available.
*   **Wavetable Visualizer Mismatch:** The Wavetable synth uses `/wt/morph`, but `FaustInstrumentLayout` looks for `waveform` or `wave` to mount the `OscillatorWaveform` visualizer.
    *   *Fix:* Update the layout detection logic to account for the Wavetable's `morph` parameter, and ensure the visualizer can adequately represent the morphing shape.

## 2. Missing Features & Lacking Depth
*   **LFOs / Modulation:** The analog-style synths (Minimoog, Acid, Supersaw) completely lack LFOs for vibrato, tremolo, or filter sweeps. 
    *   *Recommendation:* Add a basic LFO (Rate and Depth) to these DSP models in Faust to vastly increase sound design potential.
*   **FM Synth Limitations:** The current FM Synth is strictly 2-operator.
    *   *Recommendation:* Expand it to 4 operators with a few basic algorithms (routing options) to provide true FM versatility, rather than just simple bell/tine tones.
*   **Wavetable Synth Architecture:** The current implementation is a 4-shape crossfader. 
    *   *Recommendation:* Consider implementing a true wavetable lookup oscillator in Faust, or rename the current instrument to "Morphing Synth" to set accurate user expectations.

## 3. UI/UX Refinements
*   **Remove Unnecessary Collapsibles:** In `FaustInstrumentLayout.tsx`, stop hiding the "Modulation", "Resonance", and "Character" categories inside `<Collapsible>` components. In a vertical Device Inspector, scrolling a flat list of well-grouped parameters is significantly faster and more intuitive than hunting through collapsed accordions.
*   **Custom Drawbar UI:** The Hammond B3 is a flagship model, but uses standard horizontal sliders. 
    *   *Recommendation:* Implement a custom UI component for the 9 drawbars (vertical orientation, pull down to increase) to provide an authentic, tactile experience.
*   **Parameter Scaling:** Some parameters (like compressor attack times or filter envelope amounts) map linearly in the UI but control non-linear auditory concepts. Ensure `DeviceParameterControl` or the Faust descriptors employ logarithmic scaling where appropriate.

## 4. Preset Expansion
*   **Quantity:** 39 presets across 9 synths is too sparse. Aim for at least 10-15 presets per instrument to cover standard use cases and experimental edge cases.
*   **Effect Presets:** Add dedicated preset files for the Faust effects (e.g., `compressorPresets.ts`, `reverbPresets.ts`) providing starting points like "Vocal Plate", "Drum Bus Smash", or "Slapback Delay". Currently, only instrument presets exist.
