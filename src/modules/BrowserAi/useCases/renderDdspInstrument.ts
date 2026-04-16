/**
 * Use case: Render DDSP instrument audio from MIDI.
 *
 * Pipeline:
 * 1. Convert MIDI notes to pitch/loudness frame sequences (250 Hz)
 * 2. Load DDSP decoder ONNX model (small MLP, ~3-8 MB)
 * 3. Run ONNX inference → synthesis parameters (amplitudes, harmonics, noise)
 * 4. Run pure-JS DSP synthesis → audio at 16 kHz
 * 5. Resample to 44.1 kHz, normalize, apply fades
 * 6. Cache result and return
 *
 * The ONNX model contains only the learned parameter prediction MLP.
 * The actual audio synthesis is deterministic DSP (additive + subtractive)
 * implemented in TypeScript (ddspSynthesizer.ts). This avoids the TF.js
 * dependency which cannot be bundled by Rolldown.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { readModel, readRenderCache, writeRenderCache, computeRenderCacheKey } from '../repositories/storageManager';
import { enqueueRender, markRenderComplete, updateRenderStatus } from '../stores/renderQueueStore';
import { startActiveRender, clearActiveRender } from '../stores/inferenceProgressStore';
import { midiToDdspInput, type MidiNote } from '../services/midiToDdspInput';
import { ddspSynthesize } from '../services/ddspSynthesizer';
import { resampleTo44100, applyFades, normalizePeak } from '../services/audioResampler';
import { type RenderProvenance } from '../models/RenderProgress';

const FADE_SAMPLES = 441; // 10 ms at 44.1 kHz
const DDSP_SAMPLE_RATE = 16000;
const DDSP_FRAME_RATE = 250;
const DDSP_SAMPLES_PER_FRAME = DDSP_SAMPLE_RATE / DDSP_FRAME_RATE; // 64
const DDSP_MODEL_ID = 'ddsp-decoder';
const N_HARMONICS = 100;
const N_NOISE_BANDS = 65;

type RenderDdspInstrumentInput = {
    phraseId: string;
    /** Instrument index (0-12) matching the MIDI-DDSP multi-instrument model */
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

export const renderDdspInstrument = inject({ logger, readModel, readRenderCache, writeRenderCache })(
    ({ logger, readModel, readRenderCache, writeRenderCache }) =>
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

            // Cache key includes instrument ID
            const inputData = new ArrayBuffer(pitchHz.byteLength + loudnessDb.byteLength + 4);
            const view = new DataView(inputData);
            new Float32Array(inputData, 0, pitchHz.length).set(pitchHz);
            new Float32Array(inputData, pitchHz.byteLength, loudnessDb.length).set(loudnessDb);
            view.setInt32(pitchHz.byteLength + loudnessDb.byteLength, instrumentId);
            const cacheKey = await computeRenderCacheKey({
                modelId: DDSP_MODEL_ID,
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
                    provenance: { modelId: DDSP_MODEL_ID, renderQuality: 'standard', renderedAt: Date.now(), tier: 'browser-preview' },
                };
            }

            enqueueRender({ phraseId, requestId, pipeline: 'ddsp', status: 'preparing', queuedAt: Date.now() });
            startActiveRender({
                requestId,
                phraseId,
                pipeline: 'ddsp',
                status: 'rendering-browser',
                stage: `Loading ${instrumentName} model`,
                progress: 0,
                startedAt: Date.now(),
            });

            try {
                updateRenderStatus(phraseId, 'rendering-browser');

                // 1. Load DDSP decoder model from OPFS
                const modelData = await readModel({ family: 'ddsp', modelId: DDSP_MODEL_ID });
                if (!modelData) {
                    throw new Error(
                        'DDSP instrument model not downloaded. Download it from the AI section in the clip inspector.'
                    );
                }
                await inferenceWorkerBridge.loadOnnxSession({ modelId: DDSP_MODEL_ID, modelData });

                // 2. Run ONNX inference — MLP predicts synthesis parameters
                const result = await inferenceWorkerBridge.runGenericInference({
                    modelId: DDSP_MODEL_ID,
                    requestId,
                    inputs: {
                        f0_hz: { data: pitchHz, dims: [1, nFrames], type: 'float32' },
                        loudness_db: { data: loudnessDb, dims: [1, nFrames], type: 'float32' },
                        instrument_id: {
                            data: new Int32Array([instrumentId]),
                            dims: [1],
                            type: 'int32',
                        },
                    },
                });

                // 3. Extract synthesis parameters from ONNX output
                const amplitudesOut = result.outputs['amplitudes'] ?? result.outputs['amps'];
                const harmonicsOut = result.outputs['harmonic_distribution'] ?? result.outputs['harmonics'];
                const noiseOut = result.outputs['noise_magnitudes'] ?? result.outputs['noise'];

                if (!amplitudesOut || !harmonicsOut || !noiseOut) {
                    const keys = Object.keys(result.outputs).join(', ');
                    throw new Error(`DDSP model output missing expected tensors. Got: ${keys}`);
                }

                // 4. Run pure-JS DSP synthesis → audio at 16 kHz
                const audio = ddspSynthesize({
                    f0Hz: pitchHz,
                    amplitudes: new Float32Array(amplitudesOut.data as Float32Array),
                    harmonicDistribution: new Float32Array(harmonicsOut.data as Float32Array),
                    noiseMagnitudes: new Float32Array(noiseOut.data as Float32Array),
                    nHarmonics: N_HARMONICS,
                    nNoiseBands: N_NOISE_BANDS,
                    nFrames,
                    sampleRate: DDSP_SAMPLE_RATE,
                    samplesPerFrame: DDSP_SAMPLES_PER_FRAME,
                });

                // 5. Resample 16 kHz → 44.1 kHz
                const resampled = await resampleTo44100({
                    audio,
                    fromSampleRate: DDSP_SAMPLE_RATE,
                });

                // 6. Post-process
                normalizePeak(resampled);
                applyFades(resampled, FADE_SAMPLES);

                await writeRenderCache({ cacheKey, audio: resampled });
                markRenderComplete(phraseId, cacheKey);

                const provenance: RenderProvenance = {
                    modelId: DDSP_MODEL_ID,
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
