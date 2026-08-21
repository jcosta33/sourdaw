import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { type DdspInstrumentId, resolveDdspInstrument } from '../models/DdspInstrumentCatalog';
import { type RenderProvenance } from '../models/RenderProgress';
import { computeRenderCacheKey } from '../repositories/computeRenderCacheKey';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { readRenderCache } from '../repositories/readRenderCache';
import { writeRenderCache } from '../repositories/writeRenderCache';
import { applyFades, normalizePeak, resampleTo44100 } from '../services/audioResampler';
import { type MidiNote, midiToDdspInput } from '../services/midiToDdspInput';
import { clearActiveRender, startActiveRender } from '../stores/inferenceProgressStore';
import { cancelQueuedRender, enqueueRender, markRenderComplete, updateRenderStatus } from '../stores/renderQueueStore';

const FADE_SAMPLES = 441;

type RenderDdspInstrumentInput = {
    phraseId: string;
    instrumentId: DdspInstrumentId;
    notes: MidiNote[];
    durationSec: number;
    signal?: AbortSignal;
};
type RenderDdspInstrumentOutput = Promise<{
    audio: Float32Array;
    backend: string;
    sampleRate: number;
    provenance: RenderProvenance;
}>;

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw new DOMException('Render cancelled', 'AbortError');
    }
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

export const renderDdspInstrument = inject({ logger, readRenderCache, writeRenderCache })(
    ({ logger, readRenderCache, writeRenderCache }) =>
        async function renderDdspInstrument({
            phraseId,
            instrumentId,
            notes,
            durationSec,
            signal,
        }: RenderDdspInstrumentInput): RenderDdspInstrumentOutput {
            const instrument = resolveDdspInstrument(instrumentId);
            if (!MODEL_RELEASE_ADMISSION.ddsp) {
                throw new Error('DDSP model artifacts are not admitted in this release');
            }
            throwIfAborted(signal);
            const requestId = crypto.randomUUID();
            const modelId = `${instrument.id}:${instrument.artifactVersion}`;
            const { pitchHz, loudnessDb, nFrames } = midiToDdspInput({ notes, durationSec });
            const inputData = new ArrayBuffer(pitchHz.byteLength + loudnessDb.byteLength);
            new Float32Array(inputData).set(pitchHz);
            new Float32Array(inputData, pitchHz.byteLength).set(loudnessDb);
            enqueueRender({ phraseId, requestId, pipeline: 'ddsp', status: 'preparing', queuedAt: Date.now() });
            try {
                const cacheKey = await computeRenderCacheKey({
                    modelId,
                    inputData,
                    qualityParams: `ddsp-${String(nFrames)}`,
                });
                throwIfAborted(signal);
                const cached = await readRenderCache({ cacheKey });
                throwIfAborted(signal);
                startActiveRender({
                    requestId,
                    phraseId,
                    pipeline: 'ddsp',
                    status: 'rendering-browser',
                    stage: 'Loading verified DDSP model',
                    progress: 0,
                    startedAt: Date.now(),
                });
                updateRenderStatus(phraseId, requestId, 'rendering-browser');
                const backend = await inferenceWorkerBridge.loadDdspSession(
                    {
                        modelId,
                        artifacts: instrument.artifacts.map((artifact) => ({
                            modelId: `${instrument.id}/${instrument.artifactVersion}/${artifact.path}`,
                            path: artifact.path,
                            sizeBytes: artifact.sizeBytes,
                            sha256: artifact.sha256,
                        })),
                    },
                    signal
                );
                throwIfAborted(signal);
                if (cached) {
                    markRenderComplete(phraseId, requestId, cacheKey);
                    return {
                        audio: cached,
                        backend,
                        sampleRate: 44_100,
                        provenance: {
                            modelId: instrument.id,
                            renderQuality: 'standard',
                            renderedAt: Date.now(),
                            tier: 'browser-preview',
                        },
                    };
                }
                const result = await inferenceWorkerBridge.runDdspInference(
                    {
                        type: 'run-ddsp-inference',
                        requestId,
                        modelId,
                        pitchHz,
                        loudnessDb,
                        frameRate: instrument.frameRate,
                    },
                    signal
                );
                throwIfAborted(signal);
                if (result.backend !== backend) {
                    throw new Error(`DDSP backend changed during render: ${backend} -> ${result.backend}`);
                }
                if (result.audio.length === 0) {
                    throw new Error('DDSP inference produced no audio');
                }
                const audio = await resampleTo44100({ audio: result.audio, fromSampleRate: result.nativeSampleRate });
                throwIfAborted(signal);
                normalizePeak(audio);
                applyFades(audio, FADE_SAMPLES);
                await writeRenderCache({ cacheKey, audio });
                throwIfAborted(signal);
                markRenderComplete(phraseId, requestId, cacheKey);
                return {
                    audio,
                    backend: result.backend,
                    sampleRate: 44_100,
                    provenance: {
                        modelId: instrument.id,
                        renderQuality: 'standard',
                        renderedAt: Date.now(),
                        tier: 'browser-preview',
                    },
                };
            } catch (error) {
                if (signal?.aborted || isAbortError(error)) {
                    cancelQueuedRender(phraseId, requestId);
                } else {
                    updateRenderStatus(phraseId, requestId, 'error');
                }
                throw error;
            } finally {
                clearActiveRender(requestId);
                logger.info(`[BrowserAi] DDSP render finished: ${phraseId}`);
            }
        }
);
