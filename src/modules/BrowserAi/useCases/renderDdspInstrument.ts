/**
 * Use case: Render DDSP instrument audio from MIDI.
 *
 * Pipeline:
 * 1. Convert MIDI notes to pitch/loudness frame sequences (250 Hz)
 * 2. Generate synthesis parameters from instrument profile
 * 3. Run pure-JS DSP synthesis → audio at 16 kHz
 * 4. Resample to 44.1 kHz, normalize, apply fades
 * 5. Cache result and return
 *
 * Synthesis parameters come from handcrafted instrument profiles
 * (ddspParameterGenerator.ts) — no model download required. Each instrument
 * has a characteristic harmonic spectrum and noise profile based on acoustic
 * research. The DSP synthesizer (ddspSynthesizer.ts) implements additive +
 * subtractive synthesis in pure TypeScript.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { readRenderCache, writeRenderCache, computeRenderCacheKey } from '../repositories/storageManager';
import { enqueueRender, markRenderComplete, updateRenderStatus } from '../stores/renderQueueStore';
import { startActiveRender, clearActiveRender } from '../stores/inferenceProgressStore';
import { midiToDdspInput, type MidiNote } from '../services/midiToDdspInput';
import { generateDdspParams, N_HARMONICS, N_NOISE_BANDS } from '../services/ddspParameterGenerator';
import { ddspSynthesize } from '../services/ddspSynthesizer';
import { resampleTo44100, applyFades, normalizePeak } from '../services/audioResampler';
import { type RenderProvenance } from '../models/RenderProgress';

const FADE_SAMPLES = 441; // 10 ms at 44.1 kHz
const DDSP_SAMPLE_RATE = 16000;
const DDSP_FRAME_RATE = 250;
const DDSP_SAMPLES_PER_FRAME = DDSP_SAMPLE_RATE / DDSP_FRAME_RATE; // 64

type RenderDdspInstrumentInput = {
    phraseId: string;
    /** Instrument index (0-12) matching DDSP_INSTRUMENT_INDEX */
    instrumentId: number;
    /** Instrument name for provenance metadata */
    instrumentName: string;
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
            instrumentId,
            instrumentName,
            notes,
            durationSec,
        }: RenderDdspInstrumentInput): RenderDdspInstrumentOutput {
            const requestId = crypto.randomUUID();

            // Build MIDI frame data
            const { pitchHz, loudnessDb, nFrames } = midiToDdspInput({ notes, durationSec });

            // Cache key
            const inputData = new ArrayBuffer(pitchHz.byteLength + loudnessDb.byteLength + 4);
            new Float32Array(inputData, 0, pitchHz.length).set(pitchHz);
            new Float32Array(inputData, pitchHz.byteLength, loudnessDb.length).set(loudnessDb);
            new DataView(inputData).setInt32(pitchHz.byteLength + loudnessDb.byteLength, instrumentId);
            const cacheKey = await computeRenderCacheKey({
                modelId: `ddsp-${instrumentName}`,
                inputData,
                qualityParams: `ddsp-${String(nFrames)}`,
            });

            // Check cache
            const cached = await readRenderCache({ cacheKey });
            if (cached) {
                logger.info(`[BrowserAi] DDSP cache hit: ${phraseId}`);
                markRenderComplete(phraseId, cacheKey);
                return {
                    audio: cached,
                    sampleRate: 44100,
                    provenance: { modelId: `ddsp-${instrumentName}`, renderQuality: 'standard', renderedAt: Date.now(), tier: 'browser-preview' },
                };
            }

            enqueueRender({ phraseId, requestId, pipeline: 'ddsp', status: 'preparing', queuedAt: Date.now() });
            startActiveRender({
                requestId,
                phraseId,
                pipeline: 'ddsp',
                status: 'rendering-browser',
                stage: `Synthesizing ${instrumentName}`,
                progress: 0,
                startedAt: Date.now(),
            });

            try {
                updateRenderStatus(phraseId, 'rendering-browser');

                // 1. Generate synthesis parameters from instrument profile
                const params = generateDdspParams({
                    f0Hz: pitchHz,
                    loudnessDb,
                    instrumentId,
                    nFrames,
                });

                // 2. Run pure-JS DSP synthesis → audio at 16 kHz
                const audio = ddspSynthesize({
                    f0Hz: pitchHz,
                    amplitudes: params.amplitudes,
                    harmonicDistribution: params.harmonicDistribution,
                    noiseMagnitudes: params.noiseMagnitudes,
                    nHarmonics: N_HARMONICS,
                    nNoiseBands: N_NOISE_BANDS,
                    nFrames,
                    sampleRate: DDSP_SAMPLE_RATE,
                    samplesPerFrame: DDSP_SAMPLES_PER_FRAME,
                });

                // 3. Resample 16 kHz → 44.1 kHz
                const resampled = await resampleTo44100({
                    audio,
                    fromSampleRate: DDSP_SAMPLE_RATE,
                });

                // 4. Post-process
                normalizePeak(resampled);
                applyFades(resampled, FADE_SAMPLES);

                await writeRenderCache({ cacheKey, audio: resampled });
                markRenderComplete(phraseId, cacheKey);

                const provenance: RenderProvenance = {
                    modelId: `ddsp-${instrumentName}`,
                    voiceId: instrumentName,
                    renderQuality: 'standard',
                    renderedAt: Date.now(),
                    tier: 'browser-preview',
                };

                logger.info(`[BrowserAi] DDSP render complete: ${phraseId} (${String(resampled.length / 44100)}s, ${instrumentName})`);
                return { audio: resampled, sampleRate: 44100, provenance };
            } catch (error) {
                updateRenderStatus(phraseId, 'error');
                throw error;
            } finally {
                clearActiveRender(requestId);
            }
        }
);
