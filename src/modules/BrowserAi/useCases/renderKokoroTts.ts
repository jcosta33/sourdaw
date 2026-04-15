/**
 * Use case: Render Kokoro TTS vocal preview.
 *
 * Pipeline (spec §12, §13):
 * 1. Run Kokoro TTS inference in ONNX Worker via Transformers.js
 * 2. Resample 24 kHz → 44.1 kHz
 * 3. Time-stretch to fit the target region duration (simple rate adjustment)
 * 4. Cache result with deterministic key
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { readRenderCache, writeRenderCache, computeRenderCacheKey } from '../repositories/storageManager';
import { enqueueRender, markRenderComplete, updateRenderStatus } from '../stores/renderQueueStore';
import { startActiveRender, clearActiveRender } from '../stores/inferenceProgressStore';
import { resampleTo44100, applyFades } from '../services/audioResampler';
import { type RenderProvenance } from '../models/RenderProgress';

const FADE_SAMPLES = 441; // 10 ms at 44.1 kHz
const KOKORO_MODEL_ID = 'kokoro-82m-q8';

type RenderKokoroTtsInput = {
    phraseId: string;
    text: string;
    speakerId: string;
    speed?: number;
    /** If provided, time-stretch output to fit this duration */
    targetDurationSec?: number;
};

type RenderKokoroTtsOutput = Promise<{
    audio: Float32Array;
    sampleRate: number;
    provenance: RenderProvenance;
}>;

export const renderKokoroTts = inject({ logger, readRenderCache, writeRenderCache })(
    ({ logger, readRenderCache, writeRenderCache }) =>
        async function renderKokoroTts({
            phraseId,
            text,
            speakerId,
            speed = 1.0,
            targetDurationSec,
        }: RenderKokoroTtsInput): RenderKokoroTtsOutput {
            const requestId = crypto.randomUUID();

            // Deterministic cache key
            const textEncoder = new TextEncoder();
            const inputData = textEncoder.encode(`${text}:${speakerId}:${String(speed)}`).buffer as ArrayBuffer;
            const cacheKey = await computeRenderCacheKey({
                modelId: KOKORO_MODEL_ID,
                inputData,
                qualityParams: `kokoro-q8`,
            });

            // Check render cache
            const cached = await readRenderCache({ cacheKey });
            if (cached) {
                logger.info(`[BrowserAi] Kokoro cache hit: ${phraseId}`);
                const provenance: RenderProvenance = {
                    modelId: KOKORO_MODEL_ID,
                    voiceId: speakerId,
                    renderQuality: 'standard',
                    renderedAt: Date.now(),
                    tier: 'browser-preview',
                };
                markRenderComplete(phraseId, cacheKey);
                return { audio: cached, sampleRate: 44100, provenance };
            }

            enqueueRender({ phraseId, requestId, pipeline: 'kokoro', status: 'preparing', queuedAt: Date.now() });
            startActiveRender({
                requestId,
                phraseId,
                pipeline: 'kokoro',
                status: 'rendering-browser',
                stage: 'Loading Kokoro TTS',
                progress: 0,
                startedAt: Date.now(),
            });

            try {
                updateRenderStatus(phraseId, 'rendering-browser');

                const result = await inferenceWorkerBridge.runKokoroTts({
                    requestId,
                    text,
                    voice: speakerId,
                    speed,
                });

                // Resample 24 kHz → 44.1 kHz
                const resampled = await resampleTo44100({
                    audio: result.audio,
                    fromSampleRate: result.samplingRate,
                });

                // Time-stretch to target duration if requested
                let finalAudio = resampled;
                if (targetDurationSec !== undefined && targetDurationSec > 0) {
                    const currentDuration = resampled.length / 44100;
                    const stretchRatio = currentDuration / targetDurationSec;
                    if (Math.abs(stretchRatio - 1) > 0.01) {
                        // Simple resample-based time-stretch (quality: low but fast)
                        finalAudio = await resampleTo44100({
                            audio: resampled,
                            fromSampleRate: Math.round(44100 * stretchRatio),
                        });
                    }
                }

                applyFades(finalAudio, FADE_SAMPLES);

                await writeRenderCache({ cacheKey, audio: finalAudio });
                markRenderComplete(phraseId, cacheKey);

                const provenance: RenderProvenance = {
                    modelId: KOKORO_MODEL_ID,
                    voiceId: speakerId,
                    renderQuality: 'standard',
                    renderedAt: Date.now(),
                    tier: 'browser-preview',
                };

                logger.info(`[BrowserAi] Kokoro TTS complete: ${phraseId} (${String(finalAudio.length / 44100)}s)`);
                return { audio: finalAudio, sampleRate: 44100, provenance };
            } catch (error) {
                updateRenderStatus(phraseId, 'error');
                throw error;
            } finally {
                clearActiveRender(requestId);
            }
        }
);
