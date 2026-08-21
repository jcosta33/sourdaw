import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type DdspInstrumentId, resolveDdspInstrument } from '../models/DdspInstrumentCatalog';
import { type RenderProvenance } from '../models/RenderProgress';
import { checkDdspInstrumentReady } from '../repositories/checkDdspInstrumentReady';
import { computeRenderCacheKey } from '../repositories/computeRenderCacheKey';
import { inferenceWorkerBridge } from '../repositories/inferenceWorkerBridge';
import { readRenderCache } from '../repositories/readRenderCache';
import { withDdspInstrumentLock } from '../repositories/withDdspInstrumentLock';
import { writeRenderCache } from '../repositories/writeRenderCache';
import { applyFades, resampleTo44100 } from '../services/audioResampler';
import {
    conditionDdspInput,
    createDdspInferenceChunks,
    finalizeDdspAudio,
    joinDdspChunkAudio,
} from '../services/ddspRenderPipeline';
import { type MidiNote, midiToDdspInput } from '../services/midiToDdspInput';
import { clearActiveRender, startActiveRender } from '../stores/inferenceProgressStore';
import {
    cancelQueuedRender,
    enqueueRender,
    isCurrentRenderRequest,
    markRenderComplete,
    updateRenderStatus,
} from '../stores/renderQueueStore';

const OUTPUT_SAMPLE_RATE = 44_100;
const CROSSFADE_SECONDS = 1;
const FADE_SAMPLES = 441;
const DDSP_RENDER_REVISION = 'magenta-ddsp-midi-v1';

type RenderDdspInstrumentInput = {
    phraseId: string;
    instrumentId: DdspInstrumentId;
    notes: MidiNote[];
    durationSec: number;
    signal?: AbortSignal;
};

type RenderDdspInstrumentOutput = Promise<{
    audio: Float32Array;
    backend: 'webgpu';
    sampleRate: number;
    provenance: RenderProvenance;
}>;

function targetSampleCount(durationSec: number, sampleRate: number): number {
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
        throw new TypeError('DDSP render duration must be positive and finite');
    }
    const samples = Math.round(durationSec * sampleRate);
    if (!Number.isSafeInteger(samples) || samples <= 0) {
        throw new RangeError('DDSP render duration must produce a positive safe sample count');
    }
    return samples;
}

function abortError(): DOMException {
    return new DOMException('Render cancelled or superseded', 'AbortError');
}

function assertRequestOwner(phraseId: string, requestId: string, signal?: AbortSignal): void {
    if (signal?.aborted || !isCurrentRenderRequest(phraseId, requestId)) {
        throw abortError();
    }
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function cacheInput(f0Hz: Float32Array, loudnessDb: Float32Array): ArrayBuffer {
    const bytes = new Uint8Array(f0Hz.byteLength + loudnessDb.byteLength);
    bytes.set(new Uint8Array(f0Hz.buffer, f0Hz.byteOffset, f0Hz.byteLength));
    bytes.set(new Uint8Array(loudnessDb.buffer, loudnessDb.byteOffset, loudnessDb.byteLength), f0Hz.byteLength);
    return bytes.buffer;
}

export const renderDdspInstrument = inject({
    applyFades,
    checkDdspInstrumentReady,
    computeRenderCacheKey,
    inferenceWorkerBridge,
    logger,
    readRenderCache,
    resampleTo44100,
    withDdspInstrumentLock,
    writeRenderCache,
})(
    ({
        applyFades,
        checkDdspInstrumentReady,
        computeRenderCacheKey,
        inferenceWorkerBridge,
        logger,
        readRenderCache,
        resampleTo44100,
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
            const targetSamples = targetSampleCount(durationSec, OUTPUT_SAMPLE_RATE);
            const instrument = resolveDdspInstrument(instrumentId);
            const nativeTargetSamples = targetSampleCount(durationSec, instrument.nativeSampleRate);
            const requestId = crypto.randomUUID();
            enqueueRender({ phraseId, requestId, pipeline: 'ddsp', status: 'preparing', queuedAt: Date.now() });

            try {
                const renderWithLock = async (): RenderDdspInstrumentOutput => {
                    assertRequestOwner(phraseId, requestId, signal);
                    const generation = {
                        id: instrument.id,
                        version: instrument.artifactVersion,
                        artifacts: instrument.artifacts,
                    };
                    if (!(await checkDdspInstrumentReady(generation))) {
                        throw new Error(`DDSP instrument generation is not ready: ${instrument.id}`);
                    }
                    assertRequestOwner(phraseId, requestId, signal);

                    startActiveRender({
                        requestId,
                        phraseId,
                        pipeline: 'ddsp',
                        status: 'rendering-browser',
                        stage: 'Synthesizing instrument',
                        progress: 0,
                        startedAt: Date.now(),
                    });
                    updateRenderStatus(phraseId, requestId, 'rendering-browser');
                    const session = await inferenceWorkerBridge.loadDdspSession(
                        {
                            requestId,
                            instrumentId: instrument.id,
                            artifactVersion: instrument.artifactVersion,
                            artifacts: instrument.artifacts,
                        },
                        signal
                    );
                    assertRequestOwner(phraseId, requestId, signal);
                    if (session.backend !== 'webgpu') {
                        throw new Error(`DDSP requires WebGPU; received ${session.backend}`);
                    }

                    const raw = midiToDdspInput({ notes, durationSec, frameRate: instrument.frameRate });
                    const conditioned = conditionDdspInput({
                        pitchHz: raw.pitchHz,
                        loudnessDb: raw.loudnessDb,
                        settings: session.settings,
                    });
                    const cacheKey = await computeRenderCacheKey({
                        modelId: session.sessionKey,
                        inputData: cacheInput(conditioned.f0Hz, conditioned.loudnessDb),
                        qualityParams:
                            `${DDSP_RENDER_REVISION}:frames=${String(raw.nFrames)}` +
                            `:samples44100=${String(targetSamples)}`,
                    });
                    assertRequestOwner(phraseId, requestId, signal);
                    const cached = await readRenderCache({ cacheKey });
                    assertRequestOwner(phraseId, requestId, signal);
                    if (cached?.length === targetSamples && cached.every(Number.isFinite)) {
                        markRenderComplete(phraseId, requestId, cacheKey);
                        return {
                            audio: cached,
                            backend: session.backend,
                            sampleRate: OUTPUT_SAMPLE_RATE,
                            provenance: {
                                modelId: instrument.id,
                                renderQuality: 'standard',
                                renderedAt: Date.now(),
                                tier: 'browser-preview',
                            },
                        };
                    }
                    if (cached !== null) {
                        logger.warn(`[BrowserAi] Ignoring invalid DDSP cache entry: ${cacheKey}`);
                    }

                    const chunks = createDdspInferenceChunks({
                        ...conditioned,
                        frameRate: instrument.frameRate,
                        modelFrameLength: session.modelFrameLength,
                    });
                    const expectedChunkSamples = Math.round(
                        (session.modelFrameLength / instrument.frameRate) * instrument.nativeSampleRate
                    );
                    const audioChunks: Float32Array[] = [];
                    for (const chunk of chunks) {
                        assertRequestOwner(phraseId, requestId, signal);
                        const result = await inferenceWorkerBridge.runDdspInference(
                            {
                                type: 'run-ddsp-inference',
                                requestId,
                                sessionKey: session.sessionKey,
                                f0Hz: chunk.f0Hz,
                                loudnessDb: chunk.loudnessDb,
                            },
                            signal
                        );
                        assertRequestOwner(phraseId, requestId, signal);
                        if (
                            result.backend !== session.backend ||
                            result.nativeSampleRate !== instrument.nativeSampleRate ||
                            result.audio.length !== expectedChunkSamples
                        ) {
                            throw new Error('DDSP worker returned incompatible chunk metadata');
                        }
                        audioChunks.push(result.audio);
                    }

                    const joined = joinDdspChunkAudio(
                        audioChunks,
                        Math.round(CROSSFADE_SECONDS * instrument.nativeSampleRate)
                    );
                    const nativeAudio = finalizeDdspAudio({
                        audio: joined,
                        postGain: session.settings.postGain,
                        targetSamples: nativeTargetSamples,
                    });
                    const resampled = await resampleTo44100({
                        audio: nativeAudio,
                        fromSampleRate: instrument.nativeSampleRate,
                    });
                    assertRequestOwner(phraseId, requestId, signal);
                    const audio = finalizeDdspAudio({ audio: resampled, postGain: 1, targetSamples });
                    applyFades(audio, FADE_SAMPLES);
                    await writeRenderCache({ cacheKey, audio });
                    assertRequestOwner(phraseId, requestId, signal);
                    markRenderComplete(phraseId, requestId, cacheKey);
                    return {
                        audio,
                        backend: session.backend,
                        sampleRate: OUTPUT_SAMPLE_RATE,
                        provenance: {
                            modelId: instrument.id,
                            renderQuality: 'standard',
                            renderedAt: Date.now(),
                            tier: 'browser-preview',
                        },
                    };
                };
                return await withDdspInstrumentLock(instrument.id, 'shared', renderWithLock, signal);
            } catch (error) {
                if (signal?.aborted || isAbortError(error)) {
                    cancelQueuedRender(phraseId, requestId, true);
                } else {
                    updateRenderStatus(phraseId, requestId, 'error');
                }
                throw error;
            } finally {
                clearActiveRender(requestId);
            }
        }
);
