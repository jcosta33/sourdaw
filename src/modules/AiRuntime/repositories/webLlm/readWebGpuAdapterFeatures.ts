/**
 * The features the high-performance WebGPU adapter exposes, requested with the options web-llm's
 * own device detection uses, or `null` when the browser offers no adapter.
 */
export async function readWebGpuAdapterFeatures(): Promise<ReadonlySet<string> | null> {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    return adapter === null ? null : new Set<string>(adapter.features);
}
