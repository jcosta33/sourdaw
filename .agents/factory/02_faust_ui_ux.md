# Faust UI/UX Audit

## Overview
The UI for Faust instruments is primarily handled by `FaustInstrumentLayout.tsx`, which dynamically renders controls based on the Faust parameter descriptors and attempts to provide semantic groupings and visual feedback.

## 1. Vertical Optimization and Collapsible Elements
- **Current State:** `FaustInstrumentLayout` categorizes parameters based on regex matching (e.g., Tone, Envelope, Output, Modulation). Categories marked as `primary` are always visible. Non-primary categories (Modulation, Resonance, Character) are wrapped in a `<Collapsible>` component.
- **UX Issue:** The prompt specifically notes the "avoidance of many collapsible elements where possible." In a vertical Devices Inspector, users generally prefer scrolling over clicking multiple tiny arrows to hunt for a parameter. Hiding character-defining parameters (like "Drive" or "Click" for the Hammond B3) inside a collapsed "Character" accordion adds unnecessary friction.
- **Recommendation:** Flatten the UI. Render all categories sequentially as standard grouped sections with clear headers. Only use collapsibles for truly advanced/rarely-touched configuration panels.

## 2. Interactive Visualizations
- **Current State:** The layout intelligently detects if an instrument has an Envelope, Filter, Compressor, or Oscillator, and injects interactive visualizers (`ADSREnvelope`, `FilterResponse`, `CompressorCurve`, `OscillatorWaveform`).
- **Strengths:** This is a massive win for UX, turning generic sliders into an intuitive, modern DAW experience. The visualizers provide at-a-glance feedback of the state.
- **Bugs/Inconsistencies:**
  - **Fragile Detection:** The layout checks for `pv['cutoff']` or `pv['Cutoff']` or `pv['frequency']` to mount the `FilterResponse`. If a Faust module names its parameter `/synth/filter_freq`, the visualizer won't appear.
  - **Wavetable Mismatch:** `hasOscillator` looks for a parameter named `waveform` or `wave`. However, the Wavetable synth in `proSynthInstruments.ts` uses a slider named `morph` (`/wt/morph`). Therefore, the `OscillatorWaveform` visualizer fails to render for the Wavetable synth, leaving a generic slider.
  - **Parameter Linking:** While the visualizers exist, they need to ensure perfectly synchronized bi-directional updates with the underlying Faust parameter addresses.

## 3. Granular Control
- **Strengths:** Parameters use `DeviceParameterControl`, providing uniform, standard DAW slider inputs.
- **Missing Controls:** 
  - The **Hammond B3** uses 9 standard horizontal sliders for drawbars. A specialized "Drawbar" UI component (vertical, inverted logic where pulling down increases volume) would drastically improve the authenticity and UX.
  - Toggles/Switches (like the Phase Invert on the Gain Utility) use standard checkboxes, which is functional but perhaps lacks a polished "hardware" aesthetic if the rest of the UI aims for high fidelity.
