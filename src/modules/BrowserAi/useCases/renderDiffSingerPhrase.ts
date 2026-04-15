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
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { readModel, readRenderCache, writeRenderCache, computeRenderCacheKey } from '../repositories/storageManager';
import { isTauri } from '#/utils/tauriBridge';
import { enqueueRender, markRenderComplete, updateRenderStatus } from '../stores/renderQueueStore';
import { startActiveRender, clearActiveRender } from '../stores/inferenceProgressStore';
import { phonemize } from '../services/phonemizer';
import { applyFades, normalizePeak } from '../services/audioResampler';
import { type RenderProvenance, type RenderQuality, RENDER_QUALITY_STEPS } from '../models/RenderProgress';
import { type MidiNote } from '../services/midiToDdspInput';
import { DEFAULT_EN_PHONEME_MAP } from '../models/phonemeMap';

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
            const totalDurationSec = notes.reduce((acc, n) => Math.max(acc, n.startSec + n.durationSec), 0);
            const durationFrames = Math.ceil(totalDurationSec * FRAMES_PER_SECOND);

            const noteMidiArr = new Float32Array(notes.map((n) => n.pitch));
            const noteDurArr = BigInt64Array.from(
                notes.map((n) => BigInt(Math.round(n.durationSec * FRAMES_PER_SECOND)))
            );

            // Derive word durations from actual note durations.
            // SP word-units get 1 frame (minimal separator). Content words are mapped to
            // notes in order; if there are more words than notes, surplus words share the
            // last note's duration evenly.
            const noteFrames = notes.map((n) => Math.max(1, Math.round(n.durationSec * FRAMES_PER_SECOND)));
            let noteIdx = 0;
            const wordDur = wordDiv.map((_, i) => {
                if (wordIsSp[i]) return 1;
                const frames = noteFrames[noteIdx] ?? noteFrames[noteFrames.length - 1] ?? 1;
                noteIdx++;
                return frames;
            });

            // Compute cache key — must include pitch, timing, and depth so that
            // different note sequences with the same pitches don't collide.
            const inputData = new TextEncoder().encode(
                `${lyrics}:${voicebankId}:${JSON.stringify(notes.map((n) => ({
                    p: n.pitch,
                    s: Math.round(n.startSec * 1000),
                    d: Math.round(n.durationSec * 1000),
                })))}:${String(depth)}`
            ).buffer as ArrayBuffer;
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

                // Check Tauri non-Chrome platform — should have been caught at UI level
                if (isTauri() && typeof navigator !== 'undefined' && !('gpu' in navigator)) {
                    throw new Error('DiffSinger browser rendering not available on this platform. Use native rendering.');
                }

                // Load all ONNX sessions for this voicebank.
                // Storage key (modelId in OPFS) must match what the download manager used when extracting
                // the voicebank ZIP. Session key is what the ONNX worker indexes by.
                const voicebankModels: Array<{ key: string; sessionKey: string }> = [
                    { key: 'linguistic', sessionKey: `${voicebankId}/linguistic` },
                    { key: 'dur', sessionKey: `${voicebankId}/dur` },
                    { key: 'pitch', sessionKey: `${voicebankId}/pitch` },
                    { key: 'variance', sessionKey: `${voicebankId}/variance` },
                    { key: 'acoustic', sessionKey: `${voicebankId}/acoustic` },
                ];

                for (const { key, sessionKey } of voicebankModels) {
                    const modelData = await readModel({ family: `diffsinger/${voicebankId}`, modelId: key });
                    if (!modelData) {
                        throw new Error(
                            `DiffSinger model "${key}" not found in OPFS for voicebank "${voicebankId}". ` +
                            'Re-download the voicebank in AI Settings.'
                        );
                    }
                    await inferenceWorkerBridge.loadOnnxSession({ modelId: sessionKey, modelData });
                }

                // Load shared vocoder
                const vocoderData = await readModel({ family: VOCODER_FAMILY, modelId: VOCODER_MODEL_ID });
                if (!vocoderData) {
                    throw new Error(
                        'Singing vocoder not downloaded. Download it from the AI section in the clip inspector.'
                    );
                }
                await inferenceWorkerBridge.loadOnnxSession({ modelId: 'shared/vocoder', modelData: vocoderData });

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

                logger.info(`[BrowserAi] DiffSinger render complete: ${phraseId} (${String(audio.length / SAMPLE_RATE)}s)`);
                return { audio, sampleRate: SAMPLE_RATE, provenance };
            } catch (error) {
                updateRenderStatus(phraseId, 'error');
                throw error;
            } finally {
                clearActiveRender(requestId);
            }
        }
);
