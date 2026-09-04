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

/**
 * Lazy-load the generated `daw-wasm-decoder` public asset.
 *
 * Constructing the URL at runtime keeps Vite from treating the public asset as a
 * source import and preserves deployments under a relative base path.
 */
export async function loadWasmDecoderModule(): Promise<WasmDecoderModule> {
    const wasmDecoderUrl = new URL('wasm/daw-wasm-decoder/daw_wasm_decoder.js', globalThis.location.href).href;
    return (await import(/* @vite-ignore */ wasmDecoderUrl)) as WasmDecoderModule;
}
