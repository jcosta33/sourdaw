# Faust Instruments & Effects: Depth and Quality of Implementation

## Overview
The DAW currently includes a substantial collection of built-in DSP modules authored in Faust. These are compiled to WebAssembly (WAM 2.0) at runtime or build time, providing cross-platform, high-performance audio generation and processing.

## 1. Instruments

### Included Models
- **Hammond B3:** 9 drawbars, percussion, key click, and Leslie simulation.
- **Rhodes:** 2-operator FM architecture (body + bell envelopes).
- **Minimoog Lead:** 3 detuned oscillators through a Moog ladder filter with self-oscillation.
- **Acid Bass 303:** Sawtooth through a Diode ladder filter with slide and accent envelopes.
- **FM Synth:** Basic 2-operator FM (carrier + modulator with ratio and index).
- **Supersaw Unison:** 7 detuned sawtooth oscillators summed and filtered.
- **Wavetable Synth:** Morphing crossfade across 4 basic waveforms (sine → triangle → saw → square).
- **Additive Synth:** Sum of 16 harmonics with controllable rolloff.
- **Physical Model String:** Karplus-Strong string synthesis with excitation, damping, and body controls.

### Depth Analysis
- **Strengths:** The Hammond B3 and Acid Bass 303 models have good depth, modeling the specific quirks of their analog counterparts (e.g., tonewheel leakage, Leslie crossover, diode filter squelch). 
- **Weaknesses:** 
  - **FM Synth:** Limited to 2 operators. While useful for simple bells and E-Pianos, it cannot achieve the complex textures of 4-op or 6-op FM synthesizers (like the DX7).
  - **Wavetable Synth:** "Wavetable" is a slight misnomer here; it's effectively a wave-morphing oscillator between 4 standard analog shapes rather than a true wavetable engine reading complex single-cycle frames.
  - **Modulation:** Almost all synths (Minimoog, Acid, Supersaw, etc.) completely lack dedicated LFOs. There is no built-in way to add vibrato, tremolo, or rhythmic filter sweeps without relying on external DAW automation.

## 2. Effects

### Included Models
- Zita-Rev1 Reverb, 1176 Compressor, Multiband Compressor, Pro Parametric EQ, Tape Delay, Brick-Wall Limiter, Spring Reverb, Noise Gate, Gain Utility, LUFS Meter, Stereo Widener, De-esser.

### Depth & Quality Analysis
- **Strengths:** High-quality algorithms are utilized from `stdfaust.lib`. The Zita-Rev1 is a renowned algorithmic reverb. The 1176 and Moog/Diode filters are solid, proven implementations. The inclusion of professional utilities like a LUFS meter and Multiband Compressor elevates the non-premium tier.
- **Weaknesses:** The parameters mapped to the UI are sometimes overly literal to the DSP math rather than musically scaled (though most do use reasonable min/max bounds). For example, compressor attack times are linear sliders between 0.0001s and 0.1s, which can be finicky to dial in without a logarithmic/skewed slider response.
