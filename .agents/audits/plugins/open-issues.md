# Plugin Open Issues

All items verified against the current codebase. Fixed/phantom issues removed.

---

## Architecture (needs design before touching code)

### VST3/CLAP hosting — async audio path causes unbounded queue growth
**Status: VERIFIED LEGITIMATE** (Verified in `public/audio/worklets/native-plugin-bridge-processor.js`)

`src/modules/AudioEngine/engine/NativePluginBridgeNode.ts` + `public/audio/worklets/native-plugin-bridge-processor.js`

The worklet sends every 128-sample block to the main thread via `postMessage`, which forwards to Rust via async Tauri IPC. The worklet has no guard — it unconditionally posts a new block every `process()` call regardless of whether the previous round-trip completed. Under any load the message queue grows unbounded, causing ever-increasing latency and eventual stutter. Note: this is the same underlying issue as the global RT-5 item but affects CLAP/VST3 plugin hosts specifically (separate code path from WASM plugins).

**Required architecture:** Allocate a SAB ring buffer at plugin init. AudioWorkletProcessor writes input blocks and signals via `Atomics.notify`. Dedicated Rust RT thread reads, processes VST3/CLAP DSP, writes output. Worklet reads output on next quantum. Zero promises, zero JSON, zero main-thread involvement in the audio path.

---

## Recommended sequence

1. **VST3 async** — large architectural change, coordinate with RT-5 in global issues
