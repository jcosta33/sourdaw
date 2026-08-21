import { type DdspStoredArtifact, type WorkerRequest, type WorkerResponse } from '../models/InferenceRequest';

export type TfjsWorkerTensor = {
    data: () => Promise<ArrayLike<number>>;
    dispose: () => void;
};

export type TfjsWorkerModel = {
    dispose: () => void;
    predict: (
        feeds: Record<string, TfjsWorkerTensor>
    ) => TfjsWorkerTensor | TfjsWorkerTensor[] | Record<string, TfjsWorkerTensor>;
};

export type TfjsWorkerRuntime = {
    getBackend: () => string;
    loadGraphModel: (handler: { load: () => Promise<unknown> }) => Promise<TfjsWorkerModel>;
    tensor1d: (values: Float32Array) => TfjsWorkerTensor;
};

type CreateTfjsInferenceRequestHandlerInput = {
    idleMs: number;
    initializeTfjs: () => Promise<TfjsWorkerRuntime>;
    postResponse: (response: WorkerResponse, transfer?: Transferable[]) => void;
};

type DdspSession = {
    model: TfjsWorkerModel;
    settings: DdspSettings;
};

export type DdspSettings = {
    averageMaxLoudness: number;
    loudnessThreshold: number;
    meanLoudness: number;
    meanPitch: number;
    postGain: number;
    modelMaxFrameLength: number;
};

type SessionLoad = {
    artifacts: DdspStoredArtifact[];
    controller: AbortController;
    modelId: string;
    promise: Promise<DdspSession>;
    subscribers: Set<string>;
};

type ActiveRequest = {
    controller: AbortController;
    modelId: string;
    settled: Promise<void>;
    settle: () => void;
};

type WeightSpec = {
    dtype: 'float32' | 'int32' | 'bool' | 'complex64' | 'string';
    name: string;
    quantization?: { dtype: 'uint8' | 'uint16'; min: number; scale: number };
    shape: number[];
};

type ModelJson = {
    convertedBy?: string;
    format?: string;
    generatedBy?: string;
    modelTopology: Record<string, unknown>;
    weightsManifest: Array<{ weights: WeightSpec[] }>;
};

const DDSP_NATIVE_SAMPLE_RATE = 16_000;
const SILENT_LOUDNESS_DB = -120;
const LOUDNESS_CONFIDENCE_REDUCTION_DB = -25;
const CONFIDENCE_SMOOTH_FRAMES = 100;
const CONFIDENCE_THRESHOLD = 0.7;
const HIGHEST_DDSP_PITCH_HZ = 440 * 2 ** ((110 - 69) / 12);

// Conditioning constants and operation order follow Magenta's admitted DDSP
// implementation at immutable revision 0692eb2b79681f062c6b6dd53a0361967f298caa:
// https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/music/src/ddsp/ddsp.ts
// https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/music/src/ddsp/constants.ts
// Magenta DDSP overlaps adjacent fixed-duration predictions by one second and
// linearly crossfades them before trimming to the original requested duration.
// Chunking and post-gain source:
// https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/music/src/ddsp/model.ts
// Crossfade source:
// https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/music/src/ddsp/audio_utils.ts
const DDSP_CROSSFADE_SECONDS = 1;

function abortError(): Error {
    const error = new Error('DDSP request cancelled');
    error.name = 'AbortError';
    return error;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw abortError();
    }
}

function settingsNumber(
    settings: Record<string, unknown>,
    field: keyof DdspSettings,
    minimum: number,
    maximum: number,
    options: { integer?: boolean; minimumExclusive?: boolean } = {}
): number {
    const value = settings[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`DDSP settings omit a valid ${field}`);
    }
    const minimumValid = options.minimumExclusive ? value > minimum : value >= minimum;
    if (!minimumValid || value > maximum || (options.integer === true && !Number.isInteger(value))) {
        throw new Error(`DDSP settings omit a valid ${field}`);
    }
    return value;
}

export function parseDdspSettings(bytes: ArrayBuffer): DdspSettings {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new TypeError('DDSP settings must be an object');
    }
    const settingsRecord: Record<string, unknown> = Object.fromEntries(Object.entries(parsed));
    const settings: DdspSettings = {
        averageMaxLoudness: settingsNumber(settingsRecord, 'averageMaxLoudness', SILENT_LOUDNESS_DB, 0, {
            minimumExclusive: true,
        }),
        loudnessThreshold: settingsNumber(settingsRecord, 'loudnessThreshold', SILENT_LOUDNESS_DB, 0),
        meanLoudness: settingsNumber(settingsRecord, 'meanLoudness', SILENT_LOUDNESS_DB, 0, {
            minimumExclusive: true,
        }),
        meanPitch: settingsNumber(settingsRecord, 'meanPitch', 0, 110),
        postGain: settingsNumber(settingsRecord, 'postGain', 0, 16, { minimumExclusive: true }),
        modelMaxFrameLength: settingsNumber(settingsRecord, 'modelMaxFrameLength', 1, 250_000, {
            integer: true,
            minimumExclusive: true,
        }),
    };
    if (settings.loudnessThreshold >= settings.meanLoudness) {
        throw new Error('DDSP settings loudnessThreshold must be below meanLoudness');
    }
    if (settings.meanLoudness >= settings.averageMaxLoudness) {
        throw new Error('DDSP settings meanLoudness must be below averageMaxLoudness');
    }
    return settings;
}

function average(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function smoothConfidences(confidences: Float32Array): Float32Array<ArrayBuffer> {
    const smoothed = new Float32Array(confidences.length);
    const prefixSums = new Float64Array(confidences.length + 1);
    for (let index = 0; index < confidences.length; index += 1) {
        prefixSums[index + 1] = prefixSums[index]! + confidences[index]!;
    }
    // TensorFlow SAME padding for an even 100-frame kernel uses 49 frames to
    // the left and 50 to the right, excluding padding from the average.
    for (let index = 0; index < confidences.length; index += 1) {
        const start = Math.max(0, index - (CONFIDENCE_SMOOTH_FRAMES / 2 - 1));
        const end = Math.min(confidences.length, index + CONFIDENCE_SMOOTH_FRAMES / 2 + 1);
        smoothed[index] = (prefixSums[end]! - prefixSums[start]!) / (end - start);
    }
    return smoothed;
}

function normalizeDdspAudioFeatures(
    pitchHz: Float32Array,
    loudnessDb: Float32Array,
    settings: DdspSettings
): { pitchHz: Float32Array<ArrayBuffer>; loudnessDb: Float32Array<ArrayBuffer> } {
    if (pitchHz.length === 0) {
        return { pitchHz: new Float32Array(), loudnessDb: new Float32Array() };
    }
    const confidences = new Float32Array(pitchHz.length);
    let maximumLoudness = -Infinity;
    for (let index = 0; index < pitchHz.length; index += 1) {
        const pitch = pitchHz[index]!;
        const loudness = loudnessDb[index]!;
        if (!Number.isFinite(pitch) || !Number.isFinite(loudness)) {
            throw new TypeError('DDSP input features must be finite');
        }
        confidences[index] = pitch > 0 && loudness > SILENT_LOUDNESS_DB ? 1 : 0;
        maximumLoudness = Math.max(maximumLoudness, loudness);
    }

    const shiftedLoudness = Array.from(
        loudnessDb,
        (loudness) => loudness + (settings.averageMaxLoudness - maximumLoudness)
    );
    const aboveThreshold = shiftedLoudness.filter((loudness) => loudness > settings.loudnessThreshold);
    const shiftedMean = average(aboveThreshold.length > 0 ? aboveThreshold : shiftedLoudness);
    const adjustedLoudness = shiftedLoudness.map((loudness) =>
        Math.min(
            settings.averageMaxLoudness,
            Math.max(SILENT_LOUDNESS_DB, loudness + (settings.meanLoudness - shiftedMean))
        )
    );
    const oldMinimum = adjustedLoudness.reduce((minimum, loudness) => Math.min(minimum, loudness), Infinity);
    const oldRange = shiftedMean - oldMinimum;
    if (!Number.isFinite(oldRange) || oldRange <= 0) {
        throw new Error('DDSP checkpoint conditioning produced an invalid loudness range');
    }
    const targetRange = settings.meanLoudness - SILENT_LOUDNESS_DB;
    const smoothedConfidences = smoothConfidences(confidences);
    const conditionedLoudness = adjustedLoudness.map(
        (loudness) => ((loudness - oldMinimum) / oldRange) * targetRange + SILENT_LOUDNESS_DB
    );
    const normalizedLoudness = Float32Array.from(conditionedLoudness, (loudness, index) => {
        const confidenceAdjustment =
            smoothedConfidences[index]! <= CONFIDENCE_THRESHOLD ? LOUDNESS_CONFIDENCE_REDUCTION_DB : 0;
        return Math.max(SILENT_LOUDNESS_DB, loudness + confidenceAdjustment);
    });

    const midiPitches = Array.from(pitchHz, (pitch) => (pitch > 0 ? 69 + 12 * Math.log2(pitch / 440) : 0));
    // Magenta's source mask admits low-confidence frames because SPICE carries a
    // pitch estimate through unvoiced audio. MIDI has the opposite contract:
    // rests are explicit pitch=0/confidence=0 frames. Including those zeros makes
    // phrase padding lower the mean and can shift a note several octaves. Select
    // only voiced MIDI frames here, using loudness before confidence attenuation
    // so rest-dependent smoothing cannot change the note's register.
    const selectedPitches = midiPitches.filter(
        (_pitch, index) =>
            Number.isFinite(pitchHz[index]) &&
            pitchHz[index]! > 0 &&
            confidences[index]! > CONFIDENCE_THRESHOLD &&
            conditionedLoudness[index]! > settings.loudnessThreshold
    );
    if (selectedPitches.length === 0) {
        return {
            pitchHz: Float32Array.from(pitchHz, (pitch) => (pitch > 0 ? Math.min(HIGHEST_DDSP_PITCH_HZ, pitch) : 0)),
            loudnessDb: normalizedLoudness,
        };
    }
    const pitchMean = average(selectedPitches);
    const octaveShift = Math.round((settings.meanPitch - pitchMean) / 12);
    const octaveMultiplier = 2 ** octaveShift;
    const normalizedPitch = Float32Array.from(pitchHz, (pitch) =>
        pitch > 0 ? Math.min(HIGHEST_DDSP_PITCH_HZ, pitch * octaveMultiplier) : 0
    );
    return { pitchHz: normalizedPitch, loudnessDb: normalizedLoudness };
}

function applyPostGain(audio: Float32Array, postGain: number): void {
    for (let index = 0; index < audio.length; index += 1) {
        const amplified = audio[index]! * postGain;
        if (!Number.isFinite(amplified)) {
            throw new TypeError('DDSP model returned non-finite audio');
        }
        audio[index] = amplified;
    }
}

function firstTensor(
    output: TfjsWorkerTensor | TfjsWorkerTensor[] | Record<string, TfjsWorkerTensor>
): TfjsWorkerTensor {
    if (Array.isArray(output)) {
        const tensor = output[0];
        if (!tensor) {
            throw new Error('DDSP model returned no output');
        }
        return tensor;
    }
    if (typeof Reflect.get(output, 'data') === 'function') {
        return output as TfjsWorkerTensor;
    }
    const outputMap = output as Record<string, TfjsWorkerTensor>;
    const tensor = outputMap['Identity:0'] ?? Object.values(outputMap)[0];
    if (!tensor) {
        throw new Error('DDSP model returned no output');
    }
    return tensor;
}

function modelFrameChunks(
    length: number,
    maxFrameLength: number,
    frameRate: number
): Array<{ end: number; start: number }> {
    if (length <= 0) {
        return [];
    }
    const overlapFrames = Math.min(Math.round(DDSP_CROSSFADE_SECONDS * frameRate), maxFrameLength - 1);
    const hopFrames = maxFrameLength - Math.max(0, overlapFrames);
    const chunks: Array<{ end: number; start: number }> = [];
    for (let start = 0; start < length; start += hopFrames) {
        chunks.push({ start, end: Math.min(start + maxFrameLength, length) });
        if (start + maxFrameLength >= length) {
            break;
        }
    }
    return chunks;
}

function paddedFrames(
    values: Float32Array,
    start: number,
    end: number,
    maxFrameLength: number,
    paddingValue: number
): Float32Array {
    const frames = new Float32Array(maxFrameLength).fill(paddingValue);
    frames.set(values.subarray(start, end));
    return frames;
}

function exactLength(values: ArrayLike<number>, length: number): Float32Array<ArrayBuffer> {
    const output = new Float32Array(length);
    const readableLength = Math.min(length, values.length);
    for (let index = 0; index < readableLength; index += 1) {
        output[index] = values[index] ?? 0;
    }
    return output;
}

function appendWithLinearCrossfade(
    accumulated: Float32Array,
    next: Float32Array,
    overlapSamples: number
): Float32Array<ArrayBuffer> {
    if (accumulated.length === 0 || next.length === 0 || overlapSamples <= 0) {
        const concatenated = new Float32Array(accumulated.length + next.length);
        concatenated.set(accumulated);
        concatenated.set(next, accumulated.length);
        return concatenated;
    }
    const overlap = Math.min(overlapSamples, accumulated.length, next.length);
    const output = new Float32Array(accumulated.length + next.length - overlap);
    output.set(accumulated);
    const overlapStart = accumulated.length - overlap;
    for (let index = 0; index < overlap; index += 1) {
        const ratio = index / overlap;
        output[overlapStart + index] = accumulated[overlapStart + index]! * (1 - ratio) + next[index]! * ratio;
    }
    output.set(next.subarray(overlap), accumulated.length);
    return output;
}

function closeArtifactPorts(artifacts: readonly DdspStoredArtifact[], closePort: (port: MessagePort) => void): void {
    for (const artifact of artifacts) {
        closePort(artifact.modelDataPort);
    }
}

export function createTfjsInferenceRequestHandler(input: CreateTfjsInferenceRequestHandlerInput): {
    dispose: () => Promise<void>;
    handleRequest: (request: WorkerRequest) => Promise<void>;
} {
    const sessions = new Map<string, DdspSession>();
    const sessionLoads = new Map<string, SessionLoad>();
    const requestLoads = new Map<string, SessionLoad>();
    const activeRequests = new Map<string, ActiveRequest>();
    const modelReleases = new Map<string, Promise<void>>();
    const disposedModels = new WeakSet<TfjsWorkerModel>();
    const closedPorts = new WeakSet<MessagePort>();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let tfPromise: Promise<TfjsWorkerRuntime> | undefined;
    let disposed = false;
    let disposePromise: Promise<void> | undefined;

    function closePort(port: MessagePort): void {
        if (closedPorts.has(port)) {
            return;
        }
        closedPorts.add(port);
        port.onmessage = null;
        port.onmessageerror = null;
        port.close();
    }

    function disposeModel(model: TfjsWorkerModel): void {
        if (disposedModels.has(model)) {
            return;
        }
        disposedModels.add(model);
        model.dispose();
    }

    function disposeSessions(): void {
        for (const session of sessions.values()) {
            disposeModel(session.model);
        }
        sessions.clear();
    }

    function cancelIdleCleanup(): void {
        if (idleTimer !== undefined) {
            clearTimeout(idleTimer);
            idleTimer = undefined;
        }
    }

    function scheduleIdleCleanup(): void {
        cancelIdleCleanup();
        if (disposed || activeRequests.size > 0) {
            return;
        }
        idleTimer = setTimeout(() => {
            idleTimer = undefined;
            if (disposed || activeRequests.size > 0) {
                return;
            }
            disposeSessions();
        }, input.idleMs);
    }

    async function getTfjs(): Promise<TfjsWorkerRuntime> {
        if (!tfPromise) {
            tfPromise = input.initializeTfjs().catch((error: unknown) => {
                tfPromise = undefined;
                throw error;
            });
        }
        return tfPromise;
    }

    function requireWebgpu(tf: TfjsWorkerRuntime): string {
        const backend = tf.getBackend();
        if (backend !== 'webgpu') {
            throw new Error(`DDSP requires the webgpu TF.js backend; runtime selected ${backend || 'none'}`);
        }
        return backend;
    }

    async function readArtifact(artifact: DdspStoredArtifact, signal: AbortSignal): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const port = artifact.modelDataPort;
            let settled = false;
            const finish = (result: { bytes: ArrayBuffer } | { error: unknown }): void => {
                if (settled) {
                    return;
                }
                settled = true;
                signal.removeEventListener('abort', onAbort);
                closePort(port);
                if ('bytes' in result) {
                    resolve(result.bytes);
                } else {
                    reject(result.error);
                }
            };
            const onAbort = (): void => finish({ error: abortError() });
            port.onmessage = (
                event: MessageEvent<{ message?: string; modelData?: ArrayBuffer; type?: string } | undefined>
            ) => {
                const message = event.data;
                if (message?.type === 'model-data' && message.modelData) {
                    finish({ bytes: message.modelData });
                    return;
                }
                finish({ error: new Error(message?.message ?? `Unable to read DDSP artifact: ${artifact.path}`) });
            };
            port.onmessageerror = () => {
                finish({ error: new Error(`DDSP artifact port is unreadable: ${artifact.path}`) });
            };
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) {
                onAbort();
                return;
            }
            try {
                port.start();
            } catch (error) {
                finish({ error });
            }
        });
    }

    function createSessionLoad(
        request: Extract<WorkerRequest, { type: 'create-session-from-model-storage' }>
    ): SessionLoad {
        const controller = new AbortController();
        const load: SessionLoad = {
            artifacts: request.artifacts,
            controller,
            modelId: request.modelId,
            promise: Promise.resolve().then(async () => {
                let loadedModel: TfjsWorkerModel | undefined;
                try {
                    const artifactMap = new Map(load.artifacts.map((artifact) => [artifact.path, artifact]));
                    const modelArtifact = artifactMap.get('model.json');
                    const shardArtifact = artifactMap.get('group1-shard1of1.bin');
                    const settingsArtifact = artifactMap.get('settings.json');
                    if (!modelArtifact || !shardArtifact || !settingsArtifact) {
                        throw new Error('DDSP manifest is incomplete');
                    }
                    const tf = await getTfjs();
                    requireWebgpu(tf);
                    throwIfAborted(controller.signal);
                    const modelJson = JSON.parse(
                        new TextDecoder().decode(await readArtifact(modelArtifact, controller.signal))
                    ) as ModelJson;
                    const weightData = await readArtifact(shardArtifact, controller.signal);
                    const settings = parseDdspSettings(await readArtifact(settingsArtifact, controller.signal));
                    throwIfAborted(controller.signal);
                    loadedModel = await tf.loadGraphModel({
                        load: async () => ({
                            convertedBy: modelJson.convertedBy,
                            format: modelJson.format,
                            generatedBy: modelJson.generatedBy,
                            modelTopology: modelJson.modelTopology,
                            weightData,
                            weightSpecs: modelJson.weightsManifest.flatMap((group) => group.weights),
                        }),
                    });
                    throwIfAborted(controller.signal);
                    requireWebgpu(tf);
                    if (disposed || load.subscribers.size === 0) {
                        throw abortError();
                    }
                    const session = { model: loadedModel, settings };
                    sessions.set(request.modelId, session);
                    loadedModel = undefined;
                    return session;
                } finally {
                    if (loadedModel) {
                        disposeModel(loadedModel);
                    }
                    closeArtifactPorts(load.artifacts, closePort);
                    sessionLoads.delete(request.modelId);
                }
            }),
            subscribers: new Set(),
        };
        sessionLoads.set(request.modelId, load);
        return load;
    }

    async function waitForSession(load: SessionLoad, requestId: string, signal: AbortSignal): Promise<DdspSession> {
        load.subscribers.add(requestId);
        requestLoads.set(requestId, load);
        try {
            return await new Promise<DdspSession>((resolve, reject) => {
                const onAbort = (): void => reject(abortError());
                signal.addEventListener('abort', onAbort, { once: true });
                void load.promise.then(
                    (session) => {
                        signal.removeEventListener('abort', onAbort);
                        resolve(session);
                    },
                    (error: unknown) => {
                        signal.removeEventListener('abort', onAbort);
                        reject(error);
                    }
                );
            });
        } finally {
            load.subscribers.delete(requestId);
            requestLoads.delete(requestId);
            if (load.subscribers.size === 0 && sessionLoads.get(load.modelId) === load) {
                load.controller.abort();
            }
        }
    }

    async function createSession(
        request: Extract<WorkerRequest, { type: 'create-session-from-model-storage' }>,
        signal: AbortSignal
    ): Promise<void> {
        const existing = sessions.get(request.modelId);
        if (existing) {
            closeArtifactPorts(request.artifacts, closePort);
            const tf = await getTfjs();
            throwIfAborted(signal);
            const backend = requireWebgpu(tf);
            input.postResponse({
                type: 'session-created',
                requestId: request.requestId,
                modelId: request.modelId,
                backend,
            });
            return;
        }
        let load = sessionLoads.get(request.modelId);
        if (load) {
            closeArtifactPorts(request.artifacts, closePort);
        } else {
            load = createSessionLoad(request);
        }
        await waitForSession(load, request.requestId, signal);
        throwIfAborted(signal);
        const tf = await getTfjs();
        const backend = requireWebgpu(tf);
        input.postResponse({
            type: 'session-created',
            requestId: request.requestId,
            modelId: request.modelId,
            backend,
        });
    }

    async function runInference(
        request: Extract<WorkerRequest, { type: 'run-ddsp-inference' }>,
        signal: AbortSignal
    ): Promise<void> {
        const session = sessions.get(request.modelId);
        if (!session) {
            throw new Error(`DDSP session not found: ${request.modelId}`);
        }
        if (request.frameRate <= 0 || !Number.isFinite(request.frameRate)) {
            throw new Error('DDSP frameRate must be positive');
        }
        if (request.pitchHz.length !== request.loudnessDb.length) {
            throw new Error('DDSP pitch and loudness frame counts must match');
        }
        const tf = await getTfjs();
        const backend = requireWebgpu(tf);
        const overlapSamples = Math.round(DDSP_CROSSFADE_SECONDS * DDSP_NATIVE_SAMPLE_RATE);
        const normalized = normalizeDdspAudioFeatures(request.pitchHz, request.loudnessDb, session.settings);
        let audio: Float32Array<ArrayBuffer> = new Float32Array();
        for (const { start, end } of modelFrameChunks(
            normalized.pitchHz.length,
            session.settings.modelMaxFrameLength,
            request.frameRate
        )) {
            throwIfAborted(signal);
            const pitch = tf.tensor1d(
                paddedFrames(normalized.pitchHz, start, end, session.settings.modelMaxFrameLength, -1)
            );
            const loudness = tf.tensor1d(
                paddedFrames(
                    normalized.loudnessDb,
                    start,
                    end,
                    session.settings.modelMaxFrameLength,
                    SILENT_LOUDNESS_DB
                )
            );
            let output: TfjsWorkerTensor | undefined;
            try {
                output = firstTensor(session.model.predict({ f0_hz: pitch, loudness_db: loudness }));
                const values = await output.data();
                throwIfAborted(signal);
                const requestedChunkSamples = Math.round(((end - start) / request.frameRate) * DDSP_NATIVE_SAMPLE_RATE);
                audio = appendWithLinearCrossfade(audio, exactLength(values, requestedChunkSamples), overlapSamples);
            } finally {
                pitch.dispose();
                loudness.dispose();
                output?.dispose();
            }
        }
        throwIfAborted(signal);
        const requestedSamples = Math.round((request.pitchHz.length / request.frameRate) * DDSP_NATIVE_SAMPLE_RATE);
        audio = exactLength(audio, requestedSamples);
        applyPostGain(audio, session.settings.postGain);
        throwIfAborted(signal);
        input.postResponse(
            {
                type: 'ddsp-result',
                requestId: request.requestId,
                audio,
                nativeSampleRate: DDSP_NATIVE_SAMPLE_RATE,
                backend,
            },
            [audio.buffer]
        );
    }

    function cancelRequest(requestId: string): void {
        activeRequests.get(requestId)?.controller.abort();
        const load = requestLoads.get(requestId);
        if (load) {
            load.subscribers.delete(requestId);
            requestLoads.delete(requestId);
            if (load.subscribers.size === 0) {
                load.controller.abort();
            }
        }
    }

    function releaseSession(modelId: string): Promise<void> {
        const existing = modelReleases.get(modelId);
        if (existing) {
            return existing;
        }
        cancelIdleCleanup();
        const load = sessionLoads.get(modelId);
        load?.controller.abort();
        const matching = [...activeRequests.values()].filter((request) => request.modelId === modelId);
        for (const request of matching) {
            request.controller.abort();
        }
        const release = (async (): Promise<void> => {
            await Promise.allSettled(matching.map((request) => request.settled));
            if (load) {
                await load.promise.catch(() => undefined);
            }
            const session = sessions.get(modelId);
            if (session) {
                disposeModel(session.model);
                sessions.delete(modelId);
            }
        })();
        const tracked = release.finally(() => {
            if (modelReleases.get(modelId) === tracked) {
                modelReleases.delete(modelId);
            }
        });
        modelReleases.set(modelId, tracked);
        return tracked;
    }

    function dispose(): Promise<void> {
        if (disposePromise) {
            return disposePromise;
        }
        disposed = true;
        cancelIdleCleanup();
        const requests = [...activeRequests.values()];
        for (const request of requests) {
            request.controller.abort();
        }
        const loads = [...sessionLoads.values()];
        for (const load of loads) {
            load.controller.abort();
            closeArtifactPorts(load.artifacts, closePort);
        }
        const pending = [
            ...requests.map((request) => request.settled),
            ...loads.map((load) => load.promise.catch(() => undefined)),
            ...modelReleases.values(),
        ];
        if (pending.length === 0) {
            sessionLoads.clear();
            requestLoads.clear();
            disposeSessions();
            disposePromise = Promise.resolve();
            return disposePromise;
        }
        disposePromise = Promise.allSettled(pending).then(() => {
            sessionLoads.clear();
            requestLoads.clear();
            disposeSessions();
        });
        return disposePromise;
    }

    async function handleRequest(request: WorkerRequest): Promise<void> {
        if (request.type === 'cancel-request') {
            cancelRequest(request.requestId);
            return;
        }
        if (request.type === 'dispose-worker') {
            await dispose();
            return;
        }
        if (request.type === 'release-session') {
            await releaseSession(request.modelId);
            if (request.requestId) {
                input.postResponse({
                    type: 'session-released',
                    requestId: request.requestId,
                    modelId: request.modelId,
                });
            }
            scheduleIdleCleanup();
            return;
        }
        if (request.type === 'get-status') {
            input.postResponse({
                type: 'status',
                requestId: request.requestId,
                loadedModels: [...sessions.keys()],
                memoryUsageBytes: 0,
            });
            return;
        }
        if (request.type !== 'create-session-from-model-storage' && request.type !== 'run-ddsp-inference') {
            if ('requestId' in request) {
                input.postResponse({
                    type: 'error',
                    requestId: request.requestId,
                    error: `Unsupported TF.js request: ${request.type}`,
                });
            }
            return;
        }
        const releasing = modelReleases.get(request.modelId);
        if (releasing) {
            await releasing;
        }
        if (disposed) {
            return;
        }
        cancelIdleCleanup();
        const controller = new AbortController();
        let settle = (): void => undefined;
        const settled = new Promise<void>((resolve) => {
            settle = resolve;
        });
        const activeRequest = { controller, modelId: request.modelId, settled, settle };
        activeRequests.set(request.requestId, activeRequest);
        try {
            if (request.type === 'create-session-from-model-storage') {
                await createSession(request, controller.signal);
            } else {
                await runInference(request, controller.signal);
            }
        } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted && !disposed) {
                input.postResponse({
                    type: 'error',
                    requestId: request.requestId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        } finally {
            if (activeRequests.get(request.requestId) === activeRequest) {
                activeRequests.delete(request.requestId);
            }
            activeRequest.settle();
            scheduleIdleCleanup();
        }
    }

    return { dispose, handleRequest };
}
