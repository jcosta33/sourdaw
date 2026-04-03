# Presets and Content Audit

## Overview
Presets for the built-in Faust instruments are defined in `src/modules/Arrangement/repositories/presets/faustInstrumentPresets.ts`. They demonstrate the sonic capabilities by combining the Faust generator with various effect chains.

## 1. Quantity and Variation
- **Current Count:** There are exactly 39 factory presets spanning 9 Faust instrument types.
  - Hammond B3: 5 presets
  - Rhodes: 5 presets
  - Minimoog Lead: 5 presets
  - FM Synth: 6 presets
  - Acid Bass: 5 presets
  - Supersaw: 4 presets
  - Wavetable: 3 presets
  - Additive: 3 presets
  - Physical Model: 3 presets
- **Critique:** While 39 presets cover the basics, the quantity is lacking for a modern DAW. The "Wavetable", "Additive", and "Physical Model" categories feel like afterthoughts with only 3 presets each. 
- **Missing Variation:** 
  - There are very few arpeggiated or rhythmic presets (likely due to the lack of built-in LFOs/arpeggiators).
  - The presets mostly stick to traditional roles (e.g., Moog = Bass/Lead, Hammond = Rock/Jazz). There is a lack of experimental, modern electronic, or sound-design-heavy presets utilizing these engines in unconventional ways.

## 2. The Effects Inconsistency
A critical inconsistency was found in how the presets are constructed. 
The preset file uses helper functions to attach effect chains to the instruments (e.g., `reverb()`, `delay()`, `distortion()`).

**The Bug:**
These helpers are instantiating basic placeholder devices (`builtin-reverb`, `builtin-delay`, `builtin-distortion`) instead of the high-quality Faust effect DSPs defined in `builtinDSP.ts` (`Zita-Rev1 Reverb`, `Tape Delay`, `1176 Compressor`).

**Impact:**
- The DAW possesses a world-class "Zita-Rev1 Reverb" and a lush "Tape Delay", but the factory instrument presets are entirely ignoring them, relying instead on assumed `builtin-` placeholders.
- The factory presets do not sound as good as they could.
- The Faust effects themselves lack standalone preset definitions (e.g., no "Drum Crush" preset for the 1176 Compressor, no "Space Echo" preset for the Tape Delay).

## 3. Depth of Content
Because the underlying synthesizers lack LFOs and mod matrices, the presets rely heavily on static tones plus spatial effects (Chorus, Delay, Reverb). To achieve greater depth in the preset library, the core DSPs must first be updated to support basic cyclic modulation.
