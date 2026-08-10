/** One decoded instance produced by the `daw-wasm-decoder` crate. */
export type WasmDecoded = {
    readonly sample_rate: number;
    readonly channels: number;
    readonly total_frames: number;
    readonly decode_warning_count: number;
    readonly decode_warning_summary: string;
    /** Consumes the instance — do not call `.free()` or access getters after. */
    take_samples: () => Float32Array;
    free: () => void;
};

/** Public surface of the generated `daw_wasm_decoder.js` glue module. */
export type WasmDecoderModule = {
    default: () => Promise<unknown>;
    decode_audio_bytes: (bytes: Uint8Array) => WasmDecoded;
};

const WASM_JS_URL = '/wasm/daw-wasm-decoder/daw_wasm_decoder.js';

/**
 * Lazy-load the generated `daw-wasm-decoder` public asset.
 *
 * The specifier is a root-absolute path to a build-time-generated file under
 * `public/`; it is deliberately isolated here so the decoder repository depends
 * on a same-module seam instead of an unresolvable asset specifier. The exact
 * `/* @vite-ignore *\/` string reaches the browser unchanged in production.
 */
export async function loadWasmDecoderModule(): Promise<WasmDecoderModule> {
    return (await import(/* @vite-ignore */ WASM_JS_URL)) as WasmDecoderModule;
}
