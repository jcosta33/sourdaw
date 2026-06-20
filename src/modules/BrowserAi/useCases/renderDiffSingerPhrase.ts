/**
 * Use case: Render a DiffSinger browser SVS phrase.
 *
 * Full pipeline (spec §19):
 * 1. Phonemize lyrics → token IDs
 * 2. Build input tensors (MIDI, durations, speaker embed)
 * 3. Load variance, acoustic, vocoder ONNX sessions
 * 4. Run full pipeline in ONNX Worker (linguistic → pitch → variance → acoustic → vocoder)
 * 5. Post-process and cache
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isTauri } from '#/utils/tauriBridge';

import { DEFAULT_EN_PHONEME_MAP } from '../models/phonemeMap';
import { type RenderProvenance, type RenderQuality, RENDER_QUALITY_STEPS } from '../models/RenderProgress';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { readModel, readRenderCache, writeRenderCache, computeRenderCacheKey } from '../repositories/storageManager';
import { applyFades, normalizePeak } from '../services/audioResampler';
import { type MidiNote } from '../services/midiToDdspInput';
import { phonemize } from '../services/phonemizer';
import { capabilityStore } from '../stores/capabilityStore';
import { startActiveRender, clearActiveRender } from '../stores/inferenceProgressStore';
import { enqueueRender, markRenderComplete, updateRenderStatus } from '../stores/renderQueueStore';

const FADE_SAMPLES = 441;
const HOP_SIZE = 512;
const SAMPLE_RATE = 44100;
const FRAMES_PER_SECOND = SAMPLE_RATE / HOP_SIZE; // ~86.13
const VOCODER_MODEL_ID = 'nsf-hifigan-44k';
const VOCODER_FAMILY = 'diffsinger/vocoder';

type RenderDiffSingerPhraseInput = {
    phraseId: string;
    voicebankId: string;
    lyrics: string;
    notes: MidiNote[];
    /** Phoneme → token ID map from the voicebank's phonemes.txt (defaults to standard English ARPAbet map) */
    phonemeToId?: Record<string, number>;
    renderQuality?: RenderQuality;
    /** Shallow diffusion depth from dsconfig (default 0.6) */
    depth?: number;
    /** Speaker embedding weights for blending (256 float32 values) */
    speakerEmbed?: Float32Array;
    seed?: number;
};

type RenderDiffSingerPhraseOutput = Promise<{
    audio: Float32Array;
    sampleRate: number;
    provenance: RenderProvenance;
}>;

export const renderDiffSingerPhrase = inject({
    logger,
    readModel,
    readRenderCache,
    writeRenderCache,
})(
    ({ logger, readModel, readRenderCache, writeRenderCache }) =>
        async function renderDiffSingerPhrase({
            phraseId,
            voicebankId,
            lyrics,
            notes,
            phonemeToId = DEFAULT_EN_PHONEME_MAP,
            renderQuality = 'standard',
            depth = 0.6,
            speakerEmbed,
            seed,
        }: RenderDiffSingerPhraseInput): RenderDiffSingerPhraseOutput {
            const requestId = crypto.randomUUID();
            const steps = RENDER_QUALITY_STEPS[renderQuality];

            // Phonemize lyrics
            const { tokenIds, wordDiv, wordIsSp } = phonemize({ lyrics, phonemeToId });

            // Build MIDI tensors
            const totalDurationSec = notes.reduce((acc, node) => Math.max(acc, node.startSec + node.durationSec), 0);
            const durationFrames = Math.ceil(totalDurationSec * FRAMES_PER_SECOND);

            const noteMidiArr = new Float32Array(notes.map((node) => node.pitch));
            const noteDurArr = BigInt64Array.from(
                notes.map((node) => BigInt(Math.round(node.durationSec * FRAMES_PER_SECOND)))
            );

            // Derive word durations from actual note durations.
            // SP word-units get 1 frame (minimal separator). Content words are mapped to
            // notes in order; if there are more words than notes, surplus words share the
            // last note's duration evenly.
            const noteFrames = notes.map((node) => Math.max(1, Math.round(node.durationSec * FRAMES_PER_SECOND)));
            let noteIdx = 0;
            const wordDur = wordDiv.map((_, index) => {
                if (wordIsSp[index]) {
                    return 1;
                }
                const frames = noteFrames[noteIdx] ?? noteFrames[noteFrames.length - 1] ?? 1;
                noteIdx++;
                return frames;
            });

            // Compute cache key — must include pitch, timing, and depth so that
            // different note sequences with the same pitches don't collide.
            // Hash full-precision timing: rounding to whole milliseconds let two
            // edits differing by <0.5 ms hash to the same key, so a sub-millisecond
            // nudge silently reused the stale render instead of invalidating it.
            const inputData = new TextEncoder().encode(
                `${lyrics}:${voicebankId}:${JSON.stringify(
                    notes.map((node) => ({
                        p: node.pitch,
                        s: node.startSec,
                        d: node.durationSec,
                    }))
                )}:${String(depth)}`
            ).buffer;
            const cacheKey = await computeRenderCacheKey({
                modelId: voicebankId,
                inputData,
                qualityParams: `diffsinger-${renderQuality}-${String(steps)}`,
                seed,
            });

            // Cache hit
            const cached = await readRenderCache({ cacheKey });
            if (cached) {
                logger.info(`[BrowserAi] DiffSinger cache hit: ${phraseId}`);
                const provenance: RenderProvenance = {
                    modelId: voicebankId,
                    voiceId: voicebankId,
                    steps,
                    seed,
                    renderQuality,
                    renderedAt: Date.now(),
                    tier: 'browser-preview',
                };
                markRenderComplete(phraseId, cacheKey);
                return { audio: cached, sampleRate: SAMPLE_RATE, provenance };
            }

            enqueueRender({ phraseId, requestId, pipeline: 'diffsinger', status: 'preparing', queuedAt: Date.now() });
            startActiveRender({
                requestId,
                phraseId,
                pipeline: 'diffsinger',
                status: 'rendering-browser',
                stage: 'Loading DiffSinger models',
                progress: 0,
                startedAt: Date.now(),
            });

            try {
                updateRenderStatus(phraseId, 'rendering-browser');

                // Check Tauri non-Chrome platform — should have been caught at UI level.
                // Consult the capability store (the single source of truth populated by
                // capability detection at init) rather than re-probing navigator.gpu, which
                // would duplicate and drift from that decision.
                const capabilityState = capabilityStore.value;
                const platformUnsupported =
                    capabilityState?.phase === 'done' && capabilityState.report.capability === 'unsupported-platform';
                if (isTauri() && platformUnsupported) {
                    throw new Error(
                        'DiffSinger browser rendering not available on this platform. Use native rendering.'
                    );
                }

                // Load all ONNX sessions for this voicebank (+ shared vocoder).
                // Storage key (modelId in OPFS) must match what the download manager used when extracting
                // the voicebank ZIP. Session key is what the ONNX worker indexes by.
                //
                // Each voicebank model is 15–30 MB and the vocoder ~30 MB, so an
                // unconditional read+transfer of all six is 115–160 MB moved across
                // the worker boundary on every phrase render. The worker already keeps
                // these sessions in an LRU cache, so first query which session ids it
                // LIVE-holds and skip the read + transfer for those. The query reflects
                // eviction — a key dropped by LRU will be absent and is re-loaded below.
                const loadedSessionKeys = new Set(await inferenceWorkerBridge.getLoadedOnnxSessions());

                const onnxModels: Array<{
                    family: string;
                    modelId: string;
                    sessionKey: string;
                    missingMessage: string;
                }> = [
                    ...(['linguistic', 'dur', 'pitch', 'variance', 'acoustic'] as const).map((key) => ({
                        family: `diffsinger/${voicebankId}`,
                        modelId: key,
                        sessionKey: `${voicebankId}/${key}`,
                        missingMessage:
                            `DiffSinger model "${key}" not found in OPFS for voicebank "${voicebankId}". ` +
                            'Re-download the voicebank in AI Settings.',
                    })),
                    {
                        family: VOCODER_FAMILY,
                        modelId: VOCODER_MODEL_ID,
                        sessionKey: 'shared/vocoder',
                        missingMessage:
                            'Singing vocoder not downloaded. Download it from the AI section in the clip inspector.',
                    },
                ];

                for (const { family, modelId, sessionKey, missingMessage } of onnxModels) {
                    // Worker already holds this session live — skip the OPFS read and the
                    // multi-MB transfer; the cached session is reused as-is.
                    if (loadedSessionKeys.has(sessionKey)) {
                        continue;
                    }
                    const modelData = await readModel({ family, modelId });
                    if (!modelData) {
                        throw new Error(missingMessage);
                    }
                    await inferenceWorkerBridge.loadOnnxSession({ modelId: sessionKey, modelData });
                }

                // Run full pipeline in ONNX worker
                const result = await inferenceWorkerBridge.runDiffSingerPhrase({
                    type: 'run-diffsinger-phrase',
                    requestId,
                    voicebankId,
                    tokenIds,
                    wordDiv,
                    wordDur,
                    noteMidi: noteMidiArr,
                    noteDur: noteDurArr,
                    durationFrames,
                    speakerEmbed,
                    steps,
                    depth,
                });

                // Post-process
                const audio = result.audio;
                normalizePeak(audio);
                applyFades(audio, FADE_SAMPLES);

                await writeRenderCache({ cacheKey, audio });
                markRenderComplete(phraseId, cacheKey);

                const provenance: RenderProvenance = {
                    modelId: voicebankId,
                    voiceId: voicebankId,
                    steps,
                    seed,
                    renderQuality,
                    renderedAt: Date.now(),
                    tier: 'browser-preview',
                };

                logger.info(
                    `[BrowserAi] DiffSinger render complete: ${phraseId} (${String(audio.length / SAMPLE_RATE)}s)`
                );
                return { audio, sampleRate: SAMPLE_RATE, provenance };
            } catch (error) {
                updateRenderStatus(phraseId, 'error');
                throw error;
            } finally {
                clearActiveRender(requestId);
            }
        }
);
