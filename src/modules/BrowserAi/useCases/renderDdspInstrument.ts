/**
 * Use case: Render DDSP instrument audio from MIDI.
 *
 * Pipeline (spec §10):
 * 1. Convert MIDI notes to pitch/loudness frame sequences
 * 2. Load instrument model (from OPFS cache or download)
 * 3. Run DDSP inference in TF.js Worker
 * 4. Resample output to 44.1 kHz
 * 5. Apply post-processing (normalize, fade)
 * 6. Cache result with deterministic key
 * 7. Return Float32Array at 44.1 kHz and update stores
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type RenderProvenance } from '../models/RenderProgress';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { readRenderCache, writeRenderCache, computeRenderCacheKey } from '../repositories/storageManager';
import { resampleTo44100, applyFades, normalizePeak } from '../services/audioResampler';
import { midiToDdspInput, type MidiNote } from '../services/midiToDdspInput';
import { startActiveRender, clearActiveRender } from '../stores/inferenceProgressStore';
import { enqueueRender, markRenderComplete, updateRenderStatus } from '../stores/renderQueueStore';

const FADE_SAMPLES = 441; // 10 ms at 44.1 kHz

type RenderDdspInstrumentInput = {
    phraseId: string;
    modelId: string;
    /** CDN directory URL for the TF.js GraphModel (e.g. magentadata.../ddsp/violin) */
    modelUrl: string;
    notes: MidiNote[];
    /** Total duration of the phrase in seconds */
    durationSec: number;
};

type RenderDdspInstrumentOutput = Promise<{
    audio: Float32Array;
    sampleRate: number;
    provenance: RenderProvenance;
}>;

export const renderDdspInstrument = inject({ logger, readRenderCache, writeRenderCache })(
    ({ logger, readRenderCache, writeRenderCache }) =>
        async function renderDdspInstrument({
            phraseId,
            modelId,
            modelUrl,
            notes,
            durationSec,
        }: RenderDdspInstrumentInput): RenderDdspInstrumentOutput {
            const requestId = crypto.randomUUID();

            // Build MIDI frame data for cache key
            const { pitchHz, loudnessDb, nFrames } = midiToDdspInput({ notes, durationSec });
            const inputData = new ArrayBuffer(pitchHz.byteLength + loudnessDb.byteLength);
            new Float32Array(inputData).set(pitchHz);
            new Float32Array(inputData, pitchHz.byteLength).set(loudnessDb);
            const cacheKey = await computeRenderCacheKey({
                modelId,
                inputData,
                qualityParams: `ddsp-${String(nFrames)}`,
            });

            // Check render cache first
            const cached = await readRenderCache({ cacheKey });
            if (cached) {
                logger.info(`[BrowserAi] DDSP cache hit: ${phraseId}`);
                const provenance: RenderProvenance = {
                    modelId,
                    renderQuality: 'standard',
                    renderedAt: Date.now(),
                    tier: 'browser-preview',
                };
                markRenderComplete(phraseId, cacheKey);
                return { audio: cached, sampleRate: 44100, provenance };
            }

            // Enqueue render
            enqueueRender({ phraseId, requestId, pipeline: 'ddsp', status: 'preparing', queuedAt: Date.now() });
            startActiveRender({
                requestId,
                phraseId,
                pipeline: 'ddsp',
                status: 'rendering-browser',
                stage: 'Preparing DDSP model',
                progress: 0,
                startedAt: Date.now(),
            });

            try {
                updateRenderStatus(phraseId, 'rendering-browser');

                // Load DDSP GraphModel from CDN URL (TF.js caches via IndexedDB)
                await inferenceWorkerBridge.loadDdspSession({ modelId, modelUrl });

                // Run DDSP inference
                const result = await inferenceWorkerBridge.runDdspInference({
                    type: 'run-ddsp-inference',
                    requestId,
                    modelId,
                    pitchHz,
                    loudnessDb,
                    frameRate: 250,
                });

                // Resample to 44.1 kHz
                const resampled = await resampleTo44100({
                    audio: result.audio,
                    fromSampleRate: result.nativeSampleRate,
                });

                // Post-process
                normalizePeak(resampled);
                applyFades(resampled, FADE_SAMPLES);

                // Cache the result
                await writeRenderCache({ cacheKey, audio: resampled });
                markRenderComplete(phraseId, cacheKey);

                const provenance: RenderProvenance = {
                    modelId,
                    renderQuality: 'standard',
                    renderedAt: Date.now(),
                    tier: 'browser-preview',
                };

                logger.info(`[BrowserAi] DDSP render complete: ${phraseId} (${String(resampled.length / 44100)}s)`);
                return { audio: resampled, sampleRate: 44100, provenance };
            } catch (error) {
                updateRenderStatus(phraseId, 'error');
                throw error;
            } finally {
                clearActiveRender(requestId);
            }
        }
);
