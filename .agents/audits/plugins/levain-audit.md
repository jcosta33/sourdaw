# Levain Plugin Audit Report

Based on a code-level audit of the **Levain** sample playback engine (both the Rust backend in `crates/daw-dsp/src/levain/` and the TypeScript AudioWorklet glue code), here is the comprehensive audit report:

### 🌟 Architectural Positives
The Levain engine **successfully avoids the critical real-time DSP violations** that plagued other plugins. The architecture follows best practices for real-time audio:
*   **Zero Audio-Thread Allocations:** In `engine.rs`, candidate lookups use stack-allocated arrays (`let mut candidates_buf = [0u32; 16];`) instead of `Vec`. 
*   **No Per-Sample Allocations:** The cubic Hermite interpolation and crossfading math in `voice.rs` is entirely scalar and lock-free.
*   **Smart Crossfading:** Instead of copying buffers, `LevainVoice::start_crossfade` correctly clones the lightweight `SamplePlayback` state struct and interpolates seamlessly.

### 🚨 Critical Bugs
Despite the clean Rust code, the WASM/JS integration layer has two severe bugs that will crash the DAW:

1. **WASM Heap Memory Leak (Audio Thread OOM) in `LevainProcessor.ts`**
   *   **Issue:** To bypass the JS glue code and run natively in the AudioWorklet, `_setParam` manually allocates memory for string parameter names: `const strPtr = w.__wbindgen_malloc(len, 1)`. However, it **never frees it** (`__wbindgen_free`). Because Rust treats the string as a borrowed `&str`, Rust doesn't free it either.
   *   **Impact:** Every single time the user moves a knob, tweaks a macro, or an automation curve fires, memory leaks in the WASM heap. The audio thread will eventually run Out-Of-Memory (OOM) and hard crash.
   *   **Fix:** Add `w.__wbindgen_free(strPtr, len, 1);` immediately after calling `levaininstance_set_param`.

2. [x] **Buffer Over-Read Risk (Out-of-Bounds Memory) in `mod.rs` & `LevainProcessor.ts`**
   *   **Issue:** In `mod.rs`, `LevainInstance::process` defensively clamps the block size to 1024 (`let size = size.min(1024);`) to fit in its pre-allocated array. However, the JS side (`LevainProcessor.ts`) ignores this and blindly reads `frames = output[0].length` floats from the returned pointer.
   *   **Impact:** If the browser requests a block size greater than 1024 (which is common during OfflineAudioContext rendering for exports, or on certain Safari/Bluetooth setups), the JS will read past the end of `left_buf` into random WASM memory, resulting in harsh digital noise/static.
   *   **Fix:** The JS side must read `Math.min(frames, 1024)` or the Rust side must allow dynamic buffer sizing up to a safe maximum (e.g., 4096).

### ⚠️ Minor DSP Logic Issues
1. **Sample-Rate Dependent Voice Stealing (`voice.rs`)**
   *   **Issue:** Inside `LevainVoice::tick`, the energy tracker used to determine which voice to steal uses a hardcoded decay coefficient: `self.energy = self.energy * 0.999 + abs_sample * 0.001;`.
   *   **Impact:** The energy envelope falls faster at 96kHz than at 44.1kHz. This means voice stealing will behave slightly differently (stealing notes prematurely) depending on the user's audio interface settings.
   *   **Fix:** Calculate the `0.999` decay factor dynamically using `self.sample_rate`.

**Summary:** The core Rust DSP code in Levain is excellently written and real-time safe. However, the manual WASM-binding implementation in the TypeScript AudioWorklet is leaking memory and risks buffer overflows.
ws.
