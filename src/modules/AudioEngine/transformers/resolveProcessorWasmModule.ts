export function resolveProcessorWasmModule(options: unknown): WebAssembly.Module | null {
    if (typeof options !== 'object' || options === null || !('processorOptions' in options)) {
        return null;
    }
    const processorOptions = options.processorOptions;
    if (typeof processorOptions !== 'object' || processorOptions === null || !('wasmModule' in processorOptions)) {
        return null;
    }
    const candidate = processorOptions.wasmModule;
    if (candidate instanceof WebAssembly.Module) {
        return candidate;
    }
    return null;
}
