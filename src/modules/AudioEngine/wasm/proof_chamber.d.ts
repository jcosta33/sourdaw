/** TypeScript declarations for proof_chamber.js (wasm-bindgen generated). */

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

export declare class ProofChamberInstance {
    constructor(sample_rate: number);
    free(): void;
    [Symbol.dispose](): void;
    get_latency(): number;
    get_param_names(): string;
    get_right_ptr(): number;
    load_ir(ir_data: Float32Array, channels: number): void;
    process(left_in: Float32Array, right_in: Float32Array, frames: number): number;
    set_param(name: string, value: number): void;
}
