import { logger } from '#/infra/logger/appLogger';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { persistSamples } from '../repositories/libraryPersistence/persistSamples';
import { performMusicalAnalysis } from '../services/analysisService';
import { libraryStore } from '../stores/libraryStore';

/**
 * Trigger musical analysis for a sample record.
 *
 * R-G1: Musical analysis. The current implementation runs a synchronous
 * main-thread spectral heuristic (see {@link performMusicalAnalysis}); it is not
 * yet offloaded to a Web Worker.
 */
export async function analyzeSample(sampleId: string): Promise<void> {
    const state = libraryStore.value;
    if (!state) {
        return;
    }
    const sample = state.samples.find((s) => s.id === sampleId);
    if (!sample) {
        return;
    }

    // Skip if already analyzed
    if (sample.sync.status === 'analyzed') {
        return;
    }

    try {
        // Only analyze if the audio buffer is actually available in cache.
        // A silent dummy buffer would produce meaningless analysis results.
        const buffer = getCachedAudioBuffer({ bufferId: sample.id });
        if (!buffer) {
            return;
        }

        // 2. Perform background analysis
        const result = await performMusicalAnalysis(buffer);

        // 3. Update store
        const currentState = libraryStore.value;
        if (!currentState) {
            return;
        }

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
        await persistSamples();
    } catch (error) {
        logger.error(
            error instanceof Error ? error : new Error(`Failed to analyze sample ${sampleId}: ${String(error)}`)
        );
    }
}
