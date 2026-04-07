# Bug: GlutenProcessor — `LinkError`: wasm import `__wbindgen_copy_to_typed_array` not callable

## Status

**Open**

## Symptom

Console / worklet error when Gluten’s `AudioWorkletProcessor` initializes WASM:

```text
GlutenProcessor error: LinkError: WebAssembly.Instance(): Import #1 "./daw_dsp_bg.js" "__wbg___wbindgen_copy_to_typed_array_…": function import requires a callable
    at initSync (daw_dsp.js:1259:22)
    at GlutenProcessor._initWasm (glutenProcessor.ts:96:29)
    at GlutenProcessor.port.onmessage (glutenProcessor.ts:79:26)
```

(Exact hash suffix on `__wbg___wbindgen_copy_to_typed_array_*` may differ per wasm-bindgen version.)

## Root cause (technical)

`initSync` in `src/modules/AudioEngine/wasm/daw_dsp.js` builds an import object via `__wbg_get_imports()` and instantiates a `WebAssembly.Module` with the **bytes** passed from the main thread (`msg.wasmBytes` in `glutenProcessor.ts`).

The **`.wasm` binary’s import table** must match the **wasm-bindgen-generated JS glue** bundled in `daw_dsp.js`:

- If the **`.wasm`** was built with a **newer** `wasm-pack` / Rust / wasm-bindgen that emits extra imports (e.g. `__wbg___wbindgen_copy_to_typed_array_*` under the `"./daw_dsp_bg.js"` module namespace),
- but **`daw_dsp.js`** was **not** regenerated from the same output, then `__wbg_get_imports()` may only expose **fewer** functions (e.g. only throw + `externref` init in a minimal glue).

The engine then fails at `new WebAssembly.Instance(module, imports)` because a required import is **missing or not a function** → “function import requires a callable”.

This is almost always **glue/WASM skew**, not a logic bug inside Gluten DSP code.

## Typical triggers

1. **`daw_dsp_bg.wasm` updated** (e.g. `pnpm wasm:dsp` or CI build) **without** re-running the step that regenerates **`src/modules/AudioEngine/wasm/daw_dsp.js`** from `public/wasm/daw-dsp/daw_dsp.js` (see `scripts/gen-daw-dsp-worklet.mjs`).
2. **Cached or mixed** `wasmBytes` on the main thread (different URL or stale `public/` asset) vs the bundled `daw_dsp.js` in the Vite bundle.
3. **Partial copy** of wasm-pack output — only `.wasm` replaced, not the companion `daw_dsp.js` from the same build.

## Suggested fix

1. **Rebuild the pair together:**  
   Run the documented **wasm:dsp** pipeline end-to-end so `public/wasm/daw-dsp/daw_dsp.js` + `daw_dsp_bg.wasm` and **`src/modules/AudioEngine/wasm/daw_dsp.js`** stay in lockstep (`scripts/gen-daw-dsp-worklet.mjs`).
2. **Verify** byte source in the Gluten node: the same `fetch` / URL used for `wasmBytes` should correspond to the **same** build as the generated glue.
3. **Hard refresh** / clear service worker cache if a stale `daw_dsp_bg.wasm` was served.

## Verification

- Load Gluten on a track; worklet should reach `ready` with no `LinkError`.
- After any Rust change under `crates/daw-dsp` (or wasm-bindgen upgrade), confirm **one** `wasm:dsp` run updates both wasm and `src/.../daw_dsp.js`.

## References

- `src/modules/AudioEngine/services/glutenProcessor.ts` — `_initWasm`, `initSync({ module: new WebAssembly.Module(wasmBytes) })`.
- `src/modules/AudioEngine/wasm/daw_dsp.js` — `__wbg_get_imports()`, `initSync` (~1259–1260).
- `scripts/gen-daw-dsp-worklet.mjs` — copies `public/wasm/daw-dsp/daw_dsp.js` → `src/modules/AudioEngine/wasm/daw_dsp.js`.
