import { libraryStore } from '../stores/libraryStore';
import { performMusicalAnalysis } from '../services/analysisService';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

/**
 * Trigger asynchronous musical analysis for a sample record.
 * R-G1: Musical analysis in Web Workers.
 */
export async function analyzeSample(sampleId: string): Promise<void> {
    const state = libraryStore.value;
    if (!state) return;
    const sample = state.samples.find((s) => s.id === sampleId);
    if (!sample) return;

    // Skip if already analyzed
    if (sample.sync.status === 'analyzed') return;

    try {
        // 1. Fetch and decode audio (assuming it's in cache or accessible)
        let buffer = audioBufferCache.get(sample.id);

        if (!buffer) {
            // Mock buffer for analysis demo if not in cache
            const ctx = new AudioContext();
            try {
                buffer = ctx.createBuffer(1, 44100, 44100);
            } finally {
                if (ctx.close) {
                    await ctx.close();
                }
            }
        }

        // 2. Perform background analysis
        const result = await performMusicalAnalysis(buffer);

        // 3. Update store
        const currentState = libraryStore.value;
        if (!currentState) return;

        libraryStore.set({
            ...currentState,
            samples: currentState.samples.map((s) =>
                s.id === sampleId
                    ? {
                          ...s,
                          sync: { ...s.sync, status: 'analyzed' },
                          analysis: {
                              bpm: result.bpm,
                              key: result.key,
                              descriptors: result.descriptors,
                          },
                      }
                    : s
            ),
        });
    } catch (e) {
        console.error(`Failed to analyze sample ${sampleId}:`, e);
    }
}
