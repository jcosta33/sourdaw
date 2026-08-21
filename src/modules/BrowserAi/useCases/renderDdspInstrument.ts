import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { type DdspInstrument } from '../models/BrowserModel';
import { type RenderProvenance } from '../models/RenderProgress';
import { computeRenderCacheKey } from '../repositories/computeRenderCacheKey';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { readRenderCache } from '../repositories/readRenderCache';
import { writeRenderCache } from '../repositories/writeRenderCache';
import { applyFades, normalizePeak, resampleTo44100 } from '../services/audioResampler';
import { type MidiNote, midiToDdspInput } from '../services/midiToDdspInput';
import { clearActiveRender, startActiveRender } from '../stores/inferenceProgressStore';
import { enqueueRender, markRenderComplete, updateRenderStatus } from '../stores/renderQueueStore';

const FADE_SAMPLES = 441;

type RenderDdspInstrumentInput = {
    phraseId: string;
    instrument: Omit<DdspInstrument, 'status' | 'downloadProgress'>;
    notes: MidiNote[];
    durationSec: number;
};
type RenderDdspInstrumentOutput = Promise<{ audio: Float32Array; sampleRate: number; provenance: RenderProvenance }>;

export const renderDdspInstrument = inject({ logger, readRenderCache, writeRenderCache })(
    ({ logger, readRenderCache, writeRenderCache }) =>
        async function renderDdspInstrument({
            phraseId,
            instrument,
            notes,
            durationSec,
        }: RenderDdspInstrumentInput): RenderDdspInstrumentOutput {
            if (!MODEL_RELEASE_ADMISSION.ddsp || !instrument.artifacts || !instrument.artifactVersion) {
                throw new Error('DDSP model artifacts are not admitted in this release');
            }
            const requestId = crypto.randomUUID();
            const { pitchHz, loudnessDb, nFrames } = midiToDdspInput({ notes, durationSec });
            const inputData = new ArrayBuffer(pitchHz.byteLength + loudnessDb.byteLength);
            new Float32Array(inputData).set(pitchHz);
            new Float32Array(inputData, pitchHz.byteLength).set(loudnessDb);
            const cacheKey = await computeRenderCacheKey({
                modelId: `${instrument.id}:${instrument.artifactVersion}`,
                inputData,
                qualityParams: `ddsp-${String(nFrames)}`,
            });
            const cached = await readRenderCache({ cacheKey });
            if (cached) {
                markRenderComplete(phraseId, cacheKey);
                return {
                    audio: cached,
                    sampleRate: 44_100,
                    provenance: {
                        modelId: instrument.id,
                        renderQuality: 'standard',
                        renderedAt: Date.now(),
                        tier: 'browser-preview',
                    },
                };
            }
            enqueueRender({ phraseId, requestId, pipeline: 'ddsp', status: 'preparing', queuedAt: Date.now() });
            startActiveRender({
                requestId,
                phraseId,
                pipeline: 'ddsp',
                status: 'rendering-browser',
                stage: 'Loading verified DDSP model',
                progress: 0,
                startedAt: Date.now(),
            });
            try {
                updateRenderStatus(phraseId, 'rendering-browser');
                await inferenceWorkerBridge.loadDdspSession({
                    modelId: instrument.id,
                    artifacts: instrument.artifacts.map((artifact) => ({
                        modelId: `${instrument.id}/${artifact.path}`,
                        path: artifact.path,
                        sizeBytes: artifact.sizeBytes,
                        sha256: artifact.sha256,
                    })),
                });
                const result = await inferenceWorkerBridge.runDdspInference({
                    type: 'run-ddsp-inference',
                    requestId,
                    modelId: instrument.id,
                    pitchHz,
                    loudnessDb,
                    frameRate: instrument.frameRate,
                });
                if (result.audio.length === 0) {
                    throw new Error('DDSP inference produced no audio');
                }
                const audio = await resampleTo44100({ audio: result.audio, fromSampleRate: result.nativeSampleRate });
                normalizePeak(audio);
                applyFades(audio, FADE_SAMPLES);
                await writeRenderCache({ cacheKey, audio });
                markRenderComplete(phraseId, cacheKey);
                return {
                    audio,
                    sampleRate: 44_100,
                    provenance: {
                        modelId: instrument.id,
                        renderQuality: 'standard',
                        renderedAt: Date.now(),
                        tier: 'browser-preview',
                    },
                };
            } catch (error) {
                updateRenderStatus(phraseId, 'error');
                throw error;
            } finally {
                clearActiveRender(requestId);
                logger.info(`[BrowserAi] DDSP render finished: ${phraseId}`);
            }
        }
);
