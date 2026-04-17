// @ts-ignore — daw_dsp.js is wasm-bindgen-generated JS without a sibling .d.ts;
// tsconfig runs with allowJs disabled. Types for KneadInstance / init live in
// public/wasm/daw-dsp/daw_dsp.d.ts (out of the TS include path).
import init, { KneadInstance } from '../../wasm/daw_dsp';
import { getBufferForClip } from '#/modules/Arrangement/useCases';
import { ingestDspAnalysis } from '#/modules/Knead';
import { kneadStore } from '#/modules/Knead';
import { logger } from '#/infra/logger/appLogger';

// Discriminated return so callers can surface a UI toast when the buffer
// resolution fails (non-audio clip, unresolved audioBufferId, missing track)
// instead of treating a silent no-op as "not wired up yet".
type AnalyzePitchForClipOutput =
    | { status: 'analyzed' }
    | { status: 'no-buffer'; reason: 'missing-clip-or-buffer' };

/**
 * Runs the offline WASM pitch analysis on a full audio clip.
 * Uses chunked processing to keep UI responsive.
 */
export async function analyzePitchForClip(clipId: string): Promise<AnalyzePitchForClipOutput> {
    const result = getBufferForClip(clipId);
    if (!result) {
        // Non-audio clip / missing track / unresolved audioBufferId. This is an expected
        // condition (e.g. MIDI clip opened in KneadEditor); keep it at info-level so it
        // shows up in dev consoles without being escalated to a warning.
        logger.info(`[analyzePitchForClip] no buffer resolved for clipId=${clipId}`);
        return { status: 'no-buffer', reason: 'missing-clip-or-buffer' };
    }

    const { buffer } = result;
    const sampleRate = buffer.sampleRate;
    const leftChannel = buffer.getChannelData(0);

    // Ensure the wasm-bindgen module is initialized before constructing any
    // wasm-backed instance. `init` is idempotent: subsequent calls short-circuit
    // to the already-loaded exports. We keep a handle to the exports so we can
    // access `memory.buffer` directly for zero-copy writes into the Knead input
    // buffer — the same pattern used by the worklet-side processors.
    const wasmExports = await init();
    const knead = new KneadInstance(sampleRate);

    const blockSize = 4096;
    const CHUNKS_PER_YIELD = 16; // Process ~1.5s per yield at 44.1k
    const frames: { time: number; f0: number | null; periodicity: number }[] = [];
    
    // Set analyzing state in store
    const currentStore = kneadStore.value;
    if (currentStore) {
        kneadStore.set({
            ...currentStore,
            isAnalyzing: true,
            analysisProgress: 0,
        });
    }

    try {
        const inputFloatOffset = knead.get_input_left_ptr() / 4;

        let lastYieldTime = performance.now();

        for (let i = 0; i < leftChannel.length; i += blockSize) {
            const currentBlockSize = Math.min(blockSize, leftChannel.length - i);

            // Rebuild the Float32 view per block. If linear memory grew between
            // iterations the previous ArrayBuffer would be detached; reconstructing
            // the view here is cheap (header-only) and always correct. Knead's
            // process path does not allocate, so growth is not expected — but the
            // cost of defensive correctness is negligible at 4096-frame blocks.
            const wasmMemory = new Float32Array(wasmExports.memory.buffer);

            wasmMemory.set(leftChannel.subarray(i, i + currentBlockSize), inputFloatOffset);

            knead.process(currentBlockSize);
            
            // Extract results
            frames.push({
                time: i / sampleRate,
                f0: knead.is_voiced() ? knead.get_f0() : null,
                periodicity: knead.get_periodicity(),
            });
            
            // Periodically yield to UI thread
            if (Math.floor(i / blockSize) % CHUNKS_PER_YIELD === 0) {
                // Update progress
                const updatedStore = kneadStore.value;
                if (updatedStore) {
                    kneadStore.set({
                        ...updatedStore,
                        analysisProgress: i / leftChannel.length,
                    });
                }

                // Small delay to allow UI to breathe if we've been working too long
                if (performance.now() - lastYieldTime > 16) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                    lastYieldTime = performance.now();
                }
            }
        }

        // Finalize
        ingestDspAnalysis(clipId, frames);
    } catch (err) {
        throw err;
    } finally {
        const finalStore = kneadStore.value;
        if (finalStore) {
            kneadStore.set({
                ...finalStore,
                isAnalyzing: false,
                analysisProgress: 1,
            });
        }
        knead.free();
    }

    return { status: 'analyzed' };
}
