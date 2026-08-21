import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { type DdspInstrumentId, resolveDdspInstrument } from '../models/DdspInstrumentCatalog';
import { type RenderProvenance } from '../models/RenderProgress';
import { computeRenderCacheKey } from '../repositories/computeRenderCacheKey';
import { ddspModelStorage } from '../repositories/ddspModelStorage';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { readRenderCache } from '../repositories/readRenderCache';
import { withDdspInstrumentLock } from '../repositories/withDdspInstrumentLock';
import { writeRenderCache } from '../repositories/writeRenderCache';
import { applyFades, limitPeak, resampleTo44100 } from '../services/audioResampler';
import { type MidiNote, midiToDdspInput } from '../services/midiToDdspInput';
import { clearActiveRender, startActiveRender } from '../stores/inferenceProgressStore';
import { cancelQueuedRender, enqueueRender, markRenderComplete, updateRenderStatus } from '../stores/renderQueueStore';

const FADE_SAMPLES = 441;
const DDSP_OUTPUT_SAMPLE_RATE = 44_100;
const DDSP_RENDER_CACHE_REVISION = 'conditioned-v2';

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

function exactTargetSamples(durationSec: number): number {
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
        throw new TypeError('DDSP render duration must be positive and finite');
    }
    const targetSamples = Math.round(durationSec * DDSP_OUTPUT_SAMPLE_RATE);
    if (!Number.isSafeInteger(targetSamples) || targetSamples <= 0) {
        throw new RangeError('DDSP render duration must produce a positive safe sample count');
    }
    return targetSamples;
}

function fitExactLength(audio: Float32Array, targetSamples: number): Float32Array {
    if (audio.length === targetSamples) {
        return audio;
    }
    const exact = new Float32Array(targetSamples);
    exact.set(audio.subarray(0, targetSamples));
    return exact;
}

export const renderDdspInstrument = inject({
    computeRenderCacheKey,
    ddspModelStorage,
    inferenceWorkerBridge,
    logger,
    readRenderCache,
    withDdspInstrumentLock,
    writeRenderCache,
})(
    ({
        computeRenderCacheKey,
        ddspModelStorage,
        inferenceWorkerBridge,
        logger,
        readRenderCache,
        withDdspInstrumentLock,
        writeRenderCache,
    }) =>
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
            const targetSamples44k = exactTargetSamples(durationSec);
            throwIfAborted(signal);
            const requestId = crypto.randomUUID();
            const modelId = `${instrument.id}:${instrument.artifactVersion}`;
            const { pitchHz, loudnessDb, nFrames } = midiToDdspInput({ notes, durationSec });
            const inputData = new ArrayBuffer(pitchHz.byteLength + loudnessDb.byteLength);
            new Float32Array(inputData).set(pitchHz);
            new Float32Array(inputData, pitchHz.byteLength).set(loudnessDb);
            enqueueRender({ phraseId, requestId, pipeline: 'ddsp', status: 'preparing', queuedAt: Date.now() });
            try {
                return await withDdspInstrumentLock(instrument.id, 'shared', async () => {
                    const storage = {
                        id: instrument.id,
                        version: instrument.artifactVersion,
                        artifacts: instrument.artifacts,
                    };
                    throwIfAborted(signal);
                    if (!(await ddspModelStorage.checkDdspInstrumentReady(storage))) {
                        throw new Error(
                            `DDSP instrument generation is not ready: ${instrument.id}:${instrument.artifactVersion}`
                        );
                    }
                    throwIfAborted(signal);
                    const cacheKey = await computeRenderCacheKey({
                        modelId,
                        inputData,
                        qualityParams: `ddsp-${DDSP_RENDER_CACHE_REVISION}-${String(nFrames)}-samples44100-${String(targetSamples44k)}`,
                    });
                    throwIfAborted(signal);
                    const cachedCandidate = await readRenderCache({ cacheKey });
                    const cached = cachedCandidate?.length === targetSamples44k ? cachedCandidate : null;
                    if (cachedCandidate !== null && cached === null) {
                        logger.warn(
                            `[BrowserAi] Ignoring DDSP cache with wrong duration: ${String(cachedCandidate.length)} != ${String(targetSamples44k)}`
                        );
                    }
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
                            sampleRate: DDSP_OUTPUT_SAMPLE_RATE,
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
                    const resampled = await resampleTo44100({
                        audio: result.audio,
                        fromSampleRate: result.nativeSampleRate,
                    });
                    throwIfAborted(signal);
                    const audio = fitExactLength(resampled, targetSamples44k);
                    limitPeak(audio);
                    applyFades(audio, FADE_SAMPLES);
                    await writeRenderCache({ cacheKey, audio });
                    throwIfAborted(signal);
                    markRenderComplete(phraseId, requestId, cacheKey);
                    return {
                        audio,
                        backend: result.backend,
                        sampleRate: DDSP_OUTPUT_SAMPLE_RATE,
                        provenance: {
                            modelId: instrument.id,
                            renderQuality: 'standard',
                            renderedAt: Date.now(),
                            tier: 'browser-preview',
                        },
                    };
                });
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
