/**
 * Use case: Render Kokoro TTS vocal preview.
 *
 * Pipeline (spec §12, §13):
 * 1. Load Kokoro ONNX model from OPFS into the inference worker session cache
 * 2. Fetch the per-voice style embedding from HuggingFace CDN (indexed by token count)
 * 3. Tokenize text: ARPAbet phonemizer → Kokoro IPA token IDs
 * 4. Run Kokoro ONNX inference in the worker (24 kHz output)
 * 5. Resample 24 kHz → 44.1 kHz
 * 6. Time-stretch to fit the target region duration (simple rate adjustment)
 * 7. Cache result with deterministic key
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import {
    KOKORO_MODEL_ARTIFACT,
    KOKORO_VOICE_ARTIFACTS,
    KOKORO_VOICE_BASE_URL,
    KOKORO_VOICE_SIZE_BYTES,
} from '../models/KokoroArtifactManifest';
import { type RenderProvenance } from '../models/RenderProgress';
import { computeRenderCacheKey } from '../repositories/computeRenderCacheKey';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { readRenderCache } from '../repositories/readRenderCache';
import { readVerifiedModel } from '../repositories/readVerifiedModel';
import { sha256ArrayBuffer } from '../repositories/sha256ArrayBuffer';
import { writeRenderCache } from '../repositories/writeRenderCache';
import { resampleTo44100, applyFades } from '../services/audioResampler';
import { textToKokoroInputIds } from '../services/kokoroTokenizer';
import { startActiveRender, clearActiveRender } from '../stores/inferenceProgressStore';
import { enqueueRender, markRenderComplete, updateRenderStatus } from '../stores/renderQueueStore';

const FADE_SAMPLES = 441; // 10 ms at 44.1 kHz
const KOKORO_MODEL_ID = KOKORO_MODEL_ARTIFACT.id;
const KOKORO_NATIVE_SAMPLE_RATE = 24000;

/** In-memory cache: voiceId → full float32 array (N × 256 floats, reshaped as flat) */
const voiceEmbeddingCache = new Map<string, Float32Array>();

/**
 * Fetch and cache the voice embedding file for a given voice.
 * Indexes into it at `tokenCount` to get the 256-dim style vector used by the model.
 *
 * The voice .bin files contain N different 256-dim embeddings, one per possible
 * sequence length. Using voices[tokenCount] conditions the prosody on sequence length
 * (the same convention used by the original Kokoro Python inference code).
 */
async function fetchVoiceStyle(
    voice: (typeof KOKORO_VOICE_ARTIFACTS)[number],
    tokenCount: number
): Promise<Float32Array> {
    let allEmbeddings = voiceEmbeddingCache.get(voice.id);

    if (!allEmbeddings) {
        const url = `${KOKORO_VOICE_BASE_URL}/${voice.id}.bin`;
        const response = await fetch(url, {
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch Kokoro voice embedding for "${voice.id}": ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== KOKORO_VOICE_SIZE_BYTES) {
            throw new Error(
                `Kokoro voice embedding "${voice.id}" has ${String(buffer.byteLength)} bytes; expected ${String(KOKORO_VOICE_SIZE_BYTES)}`
            );
        }
        const digest = await sha256ArrayBuffer(buffer);
        if (digest !== voice.sha256) {
            throw new Error(`Kokoro voice embedding "${voice.id}" failed SHA-256 verification`);
        }
        allEmbeddings = new Float32Array(buffer);
        voiceEmbeddingCache.set(voice.id, allEmbeddings);
    }

    // Each embedding is 256 floats; index by tokenCount (before padding)
    if (allEmbeddings.length < 256) {
        throw new Error(
            `Kokoro voice file for "${voice.id}" is empty or corrupted (${String(allEmbeddings.length)} floats). ` +
                'Re-download the voice from AI Settings.'
        );
    }
    const maxIdx = Math.floor(allEmbeddings.length / 256) - 1;
    const idx = Math.min(tokenCount, maxIdx);
    return allEmbeddings.slice(idx * 256, idx * 256 + 256);
}

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

export const renderKokoroTts = inject({ logger, readRenderCache, readVerifiedModel, writeRenderCache })(
    ({ logger, readRenderCache, readVerifiedModel, writeRenderCache }) =>
        async function renderKokoroTts({
            phraseId,
            text,
            speakerId,
            speed = 1.0,
            targetDurationSec,
        }: RenderKokoroTtsInput): RenderKokoroTtsOutput {
            if (!MODEL_RELEASE_ADMISSION.kokoro) {
                throw new Error('Kokoro model artifacts are not admitted in this release');
            }
            const requestId = crypto.randomUUID();
            const voice = KOKORO_VOICE_ARTIFACTS.find((candidate) => candidate.id === speakerId);
            if (!voice) {
                throw new Error(`Unknown Kokoro voice "${speakerId}"`);
            }

            // Deterministic cache key
            const textEncoder = new TextEncoder();
            const inputData = textEncoder.encode(`${text}:${speakerId}:${String(speed)}`).buffer;
            const cacheKey = await computeRenderCacheKey({
                modelId: KOKORO_MODEL_ID,
                inputData,
                qualityParams: 'kokoro-q8',
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

                // 1. Load Kokoro model from OPFS → worker session cache
                //    loadOnnxSession is idempotent — the worker caches by modelId.
                const modelDataPort = await readVerifiedModel({
                    family: 'kokoro',
                    modelId: KOKORO_MODEL_ID,
                    sha256: KOKORO_MODEL_ARTIFACT.sha256,
                    sizeBytes: KOKORO_MODEL_ARTIFACT.sizeBytes,
                });
                if (!modelDataPort) {
                    throw new Error('Kokoro model is absent or failed verification; download it in AI Settings');
                }
                await inferenceWorkerBridge.loadOnnxSession({ modelId: KOKORO_MODEL_ID, modelDataPort });

                // 2. Tokenize text on the main thread
                const { inputIds, tokenCount } = textToKokoroInputIds(text);

                // 3. Fetch voice embedding (CDN, cached in memory)
                const style = await fetchVoiceStyle(voice, tokenCount);

                // 4. Run Kokoro ONNX inference in the worker
                //    inputIds and style buffers are transferred (zero-copy) — do not use after this call.
                const result = await inferenceWorkerBridge.runKokoroTts({
                    requestId,
                    inputIds,
                    style,
                    speed,
                });

                if (result.audio.length === 0) {
                    throw new Error(
                        'Kokoro inference produced no audio — model may have received an invalid input sequence'
                    );
                }

                // 5. Resample 24 kHz → 44.1 kHz
                const resampled = await resampleTo44100({
                    audio: result.audio,
                    fromSampleRate: KOKORO_NATIVE_SAMPLE_RATE,
                });

                // 6. Time-stretch to target duration if requested
                let finalAudio = resampled;
                if (targetDurationSec !== undefined && targetDurationSec > 0) {
                    const currentDuration = resampled.length / 44100;
                    const stretchRatio = currentDuration / targetDurationSec;
                    if (Math.abs(stretchRatio - 1) > 0.01) {
                        // Simple resample-based time-stretch (quality: low but fast for scratch tracks)
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
