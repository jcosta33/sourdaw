type ComputeRenderCacheKeyInput = {
    modelId: string;
    inputData: ArrayBuffer;
    qualityParams: string;
    seed?: number;
};

/**
 * Compute a deterministic SHA256 cache key for a render.
 */
export async function computeRenderCacheKey(input: ComputeRenderCacheKeyInput): Promise<string> {
    const encoded = new TextEncoder().encode(`${input.modelId}:${input.qualityParams}:${String(input.seed ?? 0)}`);
    const combined = new Uint8Array(encoded.byteLength + input.inputData.byteLength);
    combined.set(encoded);
    combined.set(new Uint8Array(input.inputData), encoded.byteLength);

    const hashBuffer = await crypto.subtle.digest('SHA-256', combined.buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
