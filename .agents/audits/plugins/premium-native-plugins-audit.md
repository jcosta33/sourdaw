# Premium Native Plugins (Rust/WASM) Audit

This document audits the premium Native DSP plugins (Fermenter, Toaster, Levain, Grinder, Bacteria, Gluten, Proof, ProofChamber, Scoring).

## 🌟 Architectural Positives

1. **Isolated Audio Processing**: All premium plugins successfully execute their heavy DSP in Rust/WASM via an `AudioWorkletNode`, perfectly adhering to the browser's real-time audio constraints and keeping the main thread free.
2. **Unified Descriptor Format**: The plugins all export `PluginDescriptor` objects mapping parameters to their UI.

## 🚨 Critical Bugs & Architecture Issues

1. [OPEN — architectural] **Jittery MIDI Scheduling (Main Thread Blocked)**:
    - **Issue**: Native plugins like Fermenter, Levain, and Toaster rely on `setTimeout` inside `scheduleMidiNotes.ts` to trigger their `noteOn`/`noteOff` events.
    - **Impact**: As noted in the transport audit, `setTimeout` suffers from severe timing jitter (up to 10-20ms) because it is subject to main-thread UI blockages, garbage collection, and React renders. This fundamentally destroys the musical timing/groove of the premium synths.
    - **Fix**: The Rust `AudioWorklet` must implement a lock-free `SharedArrayBuffer` ring-buffer queue. The main thread should push timestamped MIDI events into this SAB ahead of time, and the Rust loop should pull and execute them at the exact sample frame.

2. [OPEN — architectural] **Garbage Collection Avalanche via `postMessage` Telemetry**:
    - **Issue**: The plugins currently send high-frequency telemetry (LUFS, RMS, Spectral Data) back to the UI via `this.port.postMessage({})` 85 times per second.
    - **Impact**: This creates massive GC pressure (allocating thousands of objects per second), eventually starving the React thread and causing stuttering.
    - **Fix**: Telemetry must be offloaded to a globally tracked `SharedArrayBuffer`. The worklet writes float values to a fixed index, and the UI (`requestAnimationFrame`) reads from that index with zero allocations.

3. [OPEN — architectural] **Zipper Noise on Parameter Automation**:
    - **Issue**: Automation values are sent to the Native plugins via instantaneous `setParam` calls over `postMessage` at ~100Hz.
    - **Impact**: Stepping parameters instantly causes audible zipper noise/clicks, especially on filters and gain stages.
    - **Fix**: Implement parameter smoothing (1-pole lowpass) inside the Rust DSP code for all continuous parameters, or transition `setParam` to use an `AudioParam` array that natively supports `linearRampToValueAtTime`.

## 🐛 UI/UX Issues

1. [FIXED] **Missing Logarithmic Scaling in UI**:
    - **Issue**: The `DeviceParameterControl` was updated to support `scaling: 'log'`, but the Native DSP plugin descriptors (like `FERMENTER_PARAMS` or `NATIVE_DSP_DESCRIPTORS`) do not currently pass `scaling: 'log'` for frequency (Hz) and time (s) parameters.
    - **Impact**: Sweeping a filter cutoff on Fermenter feels entirely unnatural because it is linear.
    - **Fix**: Update the `ParamDef` types across all premium plugins to include `scaling?: 'log' | 'linear'` and apply it to their respective frequency and time constants.

2. [WRONG] **Collapsible Abuse in Layouts**:
    - **Issue**: Like the old Faust layouts, the premium plugin UI layouts (`FermenterLayout`, `ToasterLayout`, etc.) may still be hiding essential parameters inside `<Collapsible>` components, creating friction in the vertical Device Inspector.
    - **Fix**: Flatten the layouts and use `SectionHeader`s to group parameters without hiding them.

## Summary

The Rust/WASM DSP layer is extremely powerful and memory-efficient, but its communication bridge to the JavaScript main thread (using `postMessage` and `setTimeout`) is causing critical timing jitter and UI performance degradation. Moving all high-frequency I/O (MIDI events, parameter automation, telemetry) to `SharedArrayBuffer` is the absolute highest priority for these premium devices.
