// @ts-ignore
import { KneadInstance, getFloat32ArrayMemory0 } from '../../wasm/daw_dsp';
import { getBufferForClip } from '#/modules/Arrangement/useCases';
import { ingestDspAnalysis } from '#/modules/Knead';
import { kneadStore } from '#/modules/Knead';

/**
 * Runs the offline WASM pitch analysis on a full audio clip.
 * Uses chunked processing to keep UI responsive.
 */
export async function analyzePitchForClip(clipId: string): Promise<void> {
    const result = getBufferForClip(clipId);
    if (!result) {return;}

    const { buffer } = result;
    const sampleRate = buffer.sampleRate;
    const leftChannel = buffer.getChannelData(0);
    
    // Initialize Knead WASM instance
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
        const wasmMemory = getFloat32ArrayMemory0();
        const inputPtr = knead.get_input_left_ptr() / 4;

        let lastYieldTime = performance.now();

        for (let i = 0; i < leftChannel.length; i += blockSize) {
            const currentBlockSize = Math.min(blockSize, leftChannel.length - i);
            
            // Write samples to WASM memory
            wasmMemory.set(leftChannel.subarray(i, i + currentBlockSize), inputPtr);
            
            // Process in WASM
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
}
