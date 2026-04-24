/** TypeScript declarations for scoring.js (wasm-bindgen generated). */

export type InitSyncInput = BufferSource | WebAssembly.Module;

export type InitSyncModule = { module: InitSyncInput };

export type WasmExports = {
    memory: WebAssembly.Memory;
};

export declare function initSync(input: InitSyncInput | InitSyncModule): WasmExports;
export declare function default_init(
    module_or_path?:
        | InitSyncInput
        | string
        | URL
        | Response
        | { module_or_path?: InitSyncInput | string | URL | Response }
): Promise<WasmExports>;

export declare class ScoringInstance {
    constructor(sample_rate: number);
    free(): void;
    [Symbol.dispose](): void;
    get_cents(): number;
    get_confidence(): number;
    get_frequency(): number;
    get_midi_note(): number;
    get_note_index(): number;
    get_octave(): number;
    get_poly_string_cents(idx: number): number;
    get_poly_string_confidence(idx: number): number;
    get_poly_string_count(): number;
    get_right_ptr(): number;
    import_scala(scl_text: string): void;
    import_tun(tun_text: string): void;
    is_active(): boolean;
    is_poly_string_active(idx: number): boolean;
    process(left_in: Float32Array, right_in: Float32Array, frames: number): number;
    set_param(name: string, value: number): void;
}
