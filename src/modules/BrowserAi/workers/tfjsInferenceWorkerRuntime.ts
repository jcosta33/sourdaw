import {
    type DdspSettings,
    type DdspStoredArtifact,
    type WorkerRequest,
    type WorkerResponse,
} from '../models/InferenceRequest';

export type TfjsWorkerTensor = {
    data: () => Promise<ArrayLike<number>>;
    dispose: () => void;
    dtype: string;
    shape: readonly number[];
};

export type TfjsWorkerModel = {
    dispose: () => void;
    predict: (
        feeds: Record<string, TfjsWorkerTensor>
    ) => TfjsWorkerTensor | TfjsWorkerTensor[] | Record<string, TfjsWorkerTensor>;
};

type TfjsModelArtifacts = {
    convertedBy?: string;
    format?: string;
    generatedBy?: string;
    modelTopology: Record<string, unknown>;
    weightData: ArrayBuffer;
    weightSpecs: WeightSpec[];
};

export type TfjsWorkerRuntime = {
    getBackend: () => string;
    loadGraphModel: (handler: { load: () => Promise<TfjsModelArtifacts> }) => Promise<TfjsWorkerModel>;
    tensor1d: (values: Float32Array) => TfjsWorkerTensor;
};

type CreateTfjsInferenceRequestHandlerInput = {
    initializeTfjs: () => Promise<TfjsWorkerRuntime>;
    postResponse: (response: WorkerResponse, transfer?: Transferable[]) => void;
};

type DdspSession = {
    model: TfjsWorkerModel;
    settings: DdspSettings;
};

type SessionLoad = {
    artifacts: DdspStoredArtifact[];
    controller: AbortController;
    promise: Promise<DdspSession>;
    sessionKey: string;
    subscribers: Set<string>;
};

type ActiveRequest = {
    controller: AbortController;
    sessionKey: string;
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
    weightsManifest: Array<{ paths: string[]; weights: WeightSpec[] }>;
};

const DDSP_NATIVE_SAMPLE_RATE = 16_000;
const REQUIRED_ARTIFACT_PATHS = ['model.json', 'group1-shard1of1.bin', 'settings.json'] as const;

export type VerifiedWebGpuDevice = {
    adapter: GPUAdapter;
    device: GPUDevice;
};

/** Fail closed unless Chrome exposes a core adapter proven not to be a software fallback. */
export async function requireHardwareWebGpu(gpu: GPU | undefined): Promise<VerifiedWebGpuDevice> {
    if (gpu === undefined) {
        throw new Error('DDSP requires hardware WebGPU');
    }
    let adapter: GPUAdapter | null;
    try {
        adapter = await gpu.requestAdapter({
            powerPreference: 'high-performance',
            featureLevel: 'core',
            forceFallbackAdapter: false,
        });
    } catch (error) {
        throw new Error('DDSP requires hardware WebGPU', { cause: error });
    }
    if (adapter === null) {
        throw new Error('DDSP requires hardware WebGPU');
    }
    let isFallbackAdapter: unknown;
    try {
        isFallbackAdapter = Reflect.get(adapter.info, 'isFallbackAdapter');
    } catch (error) {
        throw new Error('DDSP requires hardware WebGPU', { cause: error });
    }
    if (isFallbackAdapter !== false) {
        throw new Error('DDSP requires hardware WebGPU');
    }
    const requiredFeatures: GPUFeatureName[] = [];
    if (adapter.features.has('timestamp-query')) {
        requiredFeatures.push('timestamp-query');
    }
    if (adapter.features.has('bgra8unorm-storage')) {
        requiredFeatures.push('bgra8unorm-storage');
    }
    const requiredLimits = {
        maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
        maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
        maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
    };
    try {
        const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
        return { adapter, device };
    } catch (error) {
        throw new Error('DDSP requires hardware WebGPU', { cause: error });
    }
}

function abortError(): Error {
    const error = new Error('DDSP request cancelled');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw abortError();
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeJson(bytes: ArrayBuffer, label: string): unknown {
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch (error) {
        throw new Error(`DDSP ${label} is not valid UTF-8 JSON`, { cause: error });
    }
}

function finiteNumber(record: Record<string, unknown>, field: keyof DdspSettings): number {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`DDSP settings omit a finite ${field}`);
    }
    return value;
}

function parseSettings(bytes: ArrayBuffer): DdspSettings {
    const value = decodeJson(bytes, 'settings.json');
    if (!isRecord(value)) {
        throw new TypeError('DDSP settings.json must contain an object');
    }
    const settings: DdspSettings = {
        averageMaxLoudness: finiteNumber(value, 'averageMaxLoudness'),
        loudnessThreshold: finiteNumber(value, 'loudnessThreshold'),
        meanLoudness: finiteNumber(value, 'meanLoudness'),
        meanPitch: finiteNumber(value, 'meanPitch'),
        modelMaxFrameLength: finiteNumber(value, 'modelMaxFrameLength'),
        postGain: finiteNumber(value, 'postGain'),
    };
    if (!Number.isSafeInteger(settings.modelMaxFrameLength) || settings.modelMaxFrameLength <= 0) {
        throw new Error('DDSP settings omit a positive integer modelMaxFrameLength');
    }
    if (settings.postGain <= 0) {
        throw new Error('DDSP settings omit a positive postGain');
    }
    return settings;
}

function parseWeightSpec(value: unknown): WeightSpec {
    if (!isRecord(value) || typeof value.name !== 'string' || value.name.length === 0 || !Array.isArray(value.shape)) {
        throw new Error('DDSP model.json contains an invalid weight specification');
    }
    const allowedDtypes = new Set(['float32', 'int32', 'bool', 'complex64', 'string']);
    if (typeof value.dtype !== 'string' || !allowedDtypes.has(value.dtype)) {
        throw new Error(`DDSP model.json contains an unsupported weight dtype: ${String(value.dtype)}`);
    }
    const shape: number[] = [];
    for (const dimension of value.shape) {
        if (typeof dimension !== 'number' || !Number.isSafeInteger(dimension) || dimension < 0) {
            throw new Error('DDSP model.json contains an invalid weight shape');
        }
        shape.push(dimension);
    }
    let quantization: WeightSpec['quantization'];
    if (value.quantization !== undefined) {
        if (
            !isRecord(value.quantization) ||
            (value.quantization.dtype !== 'uint8' && value.quantization.dtype !== 'uint16') ||
            typeof value.quantization.min !== 'number' ||
            !Number.isFinite(value.quantization.min) ||
            typeof value.quantization.scale !== 'number' ||
            !Number.isFinite(value.quantization.scale)
        ) {
            throw new Error('DDSP model.json contains invalid weight quantization');
        }
        quantization = {
            dtype: value.quantization.dtype,
            min: value.quantization.min,
            scale: value.quantization.scale,
        };
    }
    return {
        name: value.name,
        dtype: value.dtype as WeightSpec['dtype'],
        shape,
        ...(quantization && { quantization }),
    };
}

function parseModelJson(bytes: ArrayBuffer): ModelJson {
    const value = decodeJson(bytes, 'model.json');
    if (!isRecord(value) || !isRecord(value.modelTopology) || !Array.isArray(value.weightsManifest)) {
        throw new Error('DDSP model.json omits GraphModel topology or weights');
    }
    const weightsManifest = value.weightsManifest.map((group) => {
        if (
            !isRecord(group) ||
            !Array.isArray(group.paths) ||
            !group.paths.every((path) => typeof path === 'string') ||
            !Array.isArray(group.weights)
        ) {
            throw new Error('DDSP model.json contains an invalid weights manifest');
        }
        return { paths: [...group.paths], weights: group.weights.map(parseWeightSpec) };
    });
    const shardPaths = weightsManifest.flatMap(({ paths }) => paths);
    if (shardPaths.length !== 1 || shardPaths[0] !== 'group1-shard1of1.bin') {
        throw new Error('DDSP model.json does not reference the pinned weight shard');
    }
    const optionalString = (field: 'convertedBy' | 'format' | 'generatedBy'): string | undefined => {
        const candidate = value[field];
        if (candidate !== undefined && typeof candidate !== 'string') {
            throw new Error(`DDSP model.json contains an invalid ${field}`);
        }
        return candidate;
    };
    return {
        modelTopology: value.modelTopology,
        weightsManifest,
        ...(optionalString('convertedBy') !== undefined && { convertedBy: optionalString('convertedBy') }),
        ...(optionalString('format') !== undefined && { format: optionalString('format') }),
        ...(optionalString('generatedBy') !== undefined && { generatedBy: optionalString('generatedBy') }),
    };
}

function validateArtifactSet(artifacts: readonly DdspStoredArtifact[]): void {
    const paths = artifacts.map(({ path }) => path);
    if (
        paths.length !== REQUIRED_ARTIFACT_PATHS.length ||
        new Set(paths).size !== paths.length ||
        !REQUIRED_ARTIFACT_PATHS.every((path) => paths.includes(path))
    ) {
        throw new Error('DDSP artifact manifest is incomplete');
    }
    for (const artifact of artifacts) {
        if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
            throw new Error(`DDSP artifact size is invalid: ${artifact.path}`);
        }
        if (!/^[0-9a-f]{64}$/u.test(artifact.sha256)) {
            throw new Error(`DDSP artifact digest is invalid: ${artifact.path}`);
        }
    }
}

function collectPredictionTensors(
    prediction: TfjsWorkerTensor | TfjsWorkerTensor[] | Record<string, TfjsWorkerTensor>
): { tensors: TfjsWorkerTensor[]; valid: boolean } {
    const isTensor = (value: unknown): value is TfjsWorkerTensor =>
        typeof value === 'object' && value !== null && typeof Reflect.get(value, 'data') === 'function';
    if (isTensor(prediction)) {
        return { tensors: [prediction], valid: true };
    }
    const candidates: unknown[] = Array.isArray(prediction) ? prediction : Object.values(prediction);
    const tensors: TfjsWorkerTensor[] = [];
    let valid = true;
    for (const candidate of candidates) {
        if (!isTensor(candidate)) {
            valid = false;
            continue;
        }
        tensors.push(candidate);
    }
    return { tensors, valid };
}

function validateOutputShape(tensor: TfjsWorkerTensor, valueCount: number): void {
    const shape = tensor.shape;
    const supported =
        (shape.length === 1 && shape[0] !== undefined && shape[0] > 0) ||
        (shape.length === 2 && shape[0] === 1 && shape[1] !== undefined && shape[1] > 0);
    const elementCount = shape.reduce((product, dimension) => product * dimension, 1);
    if (tensor.dtype !== 'float32' || !supported || elementCount !== valueCount) {
        throw new Error('DDSP model returned an invalid audio tensor');
    }
}

/** Testable DDSP worker state machine; the worker shell only adapts real TensorFlow.js objects. */
export function createTfjsInferenceRequestHandler(input: CreateTfjsInferenceRequestHandlerInput): {
    dispose: () => Promise<void>;
    handleRequest: (request: WorkerRequest) => Promise<void>;
} {
    const sessions = new Map<string, DdspSession>();
    const sessionLoads = new Map<string, SessionLoad>();
    const inFlightSessionLoads = new Set<SessionLoad>();
    const activeRequests = new Map<string, ActiveRequest>();
    const modelReleases = new Map<string, Promise<void>>();
    const closedPorts = new WeakSet<MessagePort>();
    const disposedModels = new WeakSet<TfjsWorkerModel>();
    const disposedTensors = new WeakSet<TfjsWorkerTensor>();
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

    function closeArtifactPorts(artifacts: readonly DdspStoredArtifact[]): void {
        for (const artifact of artifacts) {
            closePort(artifact.modelDataPort);
        }
    }

    function disposeModel(model: TfjsWorkerModel): void {
        if (disposedModels.has(model)) {
            return;
        }
        disposedModels.add(model);
        model.dispose();
    }

    function disposeTensor(tensor: TfjsWorkerTensor): void {
        if (disposedTensors.has(tensor)) {
            return;
        }
        disposedTensors.add(tensor);
        tensor.dispose();
    }

    function disposeCachedSessions(): void {
        for (const session of sessions.values()) {
            disposeModel(session.model);
        }
        sessions.clear();
    }

    async function getTfjs(): Promise<TfjsWorkerRuntime> {
        tfPromise ??= input.initializeTfjs().catch((error: unknown) => {
            tfPromise = undefined;
            throw error;
        });
        return tfPromise;
    }

    function requireWebgpu(tf: TfjsWorkerRuntime): 'webgpu' {
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
                    if (result.bytes.byteLength !== artifact.sizeBytes) {
                        reject(new Error(`DDSP artifact transfer size drifted: ${artifact.path}`));
                    } else {
                        resolve(result.bytes);
                    }
                } else {
                    reject(result.error);
                }
            };
            const onAbort = (): void => finish({ error: abortError() });
            port.onmessage = (
                event: MessageEvent<{ message?: string; modelData?: ArrayBuffer; type?: string } | undefined>
            ) => {
                const message = event.data;
                if (message?.type === 'model-data' && message.modelData !== undefined) {
                    finish({ bytes: message.modelData });
                } else {
                    finish({ error: new Error(message?.message ?? `Unable to read DDSP artifact: ${artifact.path}`) });
                }
            };
            port.onmessageerror = () =>
                finish({ error: new Error(`DDSP artifact port is unreadable: ${artifact.path}`) });
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

    function createSessionLoad(request: Extract<WorkerRequest, { type: 'create-ddsp-session' }>): SessionLoad {
        validateArtifactSet(request.artifacts);
        const controller = new AbortController();
        const load: SessionLoad = {
            artifacts: request.artifacts,
            controller,
            sessionKey: request.sessionKey,
            subscribers: new Set(),
            promise: Promise.resolve().then(async () => {
                let loadedModel: TfjsWorkerModel | undefined;
                try {
                    const byPath = new Map(load.artifacts.map((artifact) => [artifact.path, artifact]));
                    const modelArtifact = byPath.get('model.json');
                    const shardArtifact = byPath.get('group1-shard1of1.bin');
                    const settingsArtifact = byPath.get('settings.json');
                    if (!modelArtifact || !shardArtifact || !settingsArtifact) {
                        throw new Error('DDSP artifact manifest is incomplete');
                    }
                    const tf = await getTfjs();
                    requireWebgpu(tf);
                    throwIfAborted(controller.signal);
                    const modelJson = parseModelJson(await readArtifact(modelArtifact, controller.signal));
                    const weightData = await readArtifact(shardArtifact, controller.signal);
                    const settings = parseSettings(await readArtifact(settingsArtifact, controller.signal));
                    throwIfAborted(controller.signal);
                    const modelArtifacts: TfjsModelArtifacts = {
                        modelTopology: modelJson.modelTopology,
                        weightData,
                        weightSpecs: modelJson.weightsManifest.flatMap(({ weights }) => weights),
                        ...(modelJson.convertedBy !== undefined && { convertedBy: modelJson.convertedBy }),
                        ...(modelJson.format !== undefined && { format: modelJson.format }),
                        ...(modelJson.generatedBy !== undefined && { generatedBy: modelJson.generatedBy }),
                    };
                    loadedModel = await tf.loadGraphModel({ load: async () => modelArtifacts });
                    throwIfAborted(controller.signal);
                    requireWebgpu(tf);
                    if (disposed || load.subscribers.size === 0) {
                        throw abortError();
                    }
                    const session = { model: loadedModel, settings };
                    sessions.set(load.sessionKey, session);
                    loadedModel = undefined;
                    return session;
                } finally {
                    if (loadedModel) {
                        disposeModel(loadedModel);
                    }
                    closeArtifactPorts(load.artifacts);
                    inFlightSessionLoads.delete(load);
                    if (sessionLoads.get(load.sessionKey) === load) {
                        sessionLoads.delete(load.sessionKey);
                    }
                }
            }),
        };
        inFlightSessionLoads.add(load);
        sessionLoads.set(request.sessionKey, load);
        return load;
    }

    async function waitForSession(load: SessionLoad, requestId: string, signal: AbortSignal): Promise<DdspSession> {
        load.subscribers.add(requestId);
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
            if (load.subscribers.size === 0 && sessionLoads.get(load.sessionKey) === load) {
                load.controller.abort();
            }
        }
    }

    async function createSession(
        request: Extract<WorkerRequest, { type: 'create-ddsp-session' }>,
        signal: AbortSignal
    ): Promise<void> {
        const existing = sessions.get(request.sessionKey);
        if (existing) {
            closeArtifactPorts(request.artifacts);
            const backend = requireWebgpu(await getTfjs());
            throwIfAborted(signal);
            input.postResponse({
                type: 'session-created',
                requestId: request.requestId,
                sessionKey: request.sessionKey,
                backend,
                modelFrameLength: existing.settings.modelMaxFrameLength,
                settings: existing.settings,
            });
            return;
        }
        let load = sessionLoads.get(request.sessionKey);
        if (load?.controller.signal.aborted) {
            load = undefined;
        }
        if (load) {
            closeArtifactPorts(request.artifacts);
        } else {
            try {
                load = createSessionLoad(request);
            } catch (error) {
                closeArtifactPorts(request.artifacts);
                throw error;
            }
        }
        const session = await waitForSession(load, request.requestId, signal);
        throwIfAborted(signal);
        input.postResponse({
            type: 'session-created',
            requestId: request.requestId,
            sessionKey: request.sessionKey,
            backend: requireWebgpu(await getTfjs()),
            modelFrameLength: session.settings.modelMaxFrameLength,
            settings: session.settings,
        });
    }

    async function runInference(
        request: Extract<WorkerRequest, { type: 'run-ddsp-inference' }>,
        signal: AbortSignal
    ): Promise<void> {
        const session = sessions.get(request.sessionKey);
        if (!session) {
            throw new Error(`DDSP session not found: ${request.sessionKey}`);
        }
        if (
            request.f0Hz.length !== request.loudnessDb.length ||
            request.f0Hz.length !== session.settings.modelMaxFrameLength
        ) {
            throw new Error('DDSP input tensors must match the checkpoint model frame length');
        }
        if (!request.f0Hz.every(Number.isFinite) || !request.loudnessDb.every(Number.isFinite)) {
            throw new TypeError('DDSP input tensors must contain only finite values');
        }
        const tf = await getTfjs();
        const backend = requireWebgpu(tf);
        throwIfAborted(signal);
        let pitch: TfjsWorkerTensor | undefined;
        let loudness: TfjsWorkerTensor | undefined;
        let outputs: TfjsWorkerTensor[] = [];
        try {
            pitch = tf.tensor1d(request.f0Hz);
            loudness = tf.tensor1d(request.loudnessDb);
            const prediction = collectPredictionTensors(session.model.predict({ f0_hz: pitch, loudness_db: loudness }));
            outputs = prediction.tensors;
            if (!prediction.valid) {
                throw new Error('DDSP model returned an invalid tensor map');
            }
            if (outputs.length !== 1 || outputs[0] === undefined) {
                throw new Error('DDSP model must return exactly one audio tensor');
            }
            const values = await outputs[0].data();
            throwIfAborted(signal);
            validateOutputShape(outputs[0], values.length);
            const audio = Float32Array.from(values, Number);
            if (!audio.every(Number.isFinite)) {
                throw new TypeError('DDSP model returned non-finite audio');
            }
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
        } finally {
            if (pitch) {
                disposeTensor(pitch);
            }
            if (loudness) {
                disposeTensor(loudness);
            }
            for (const output of outputs) {
                disposeTensor(output);
            }
        }
    }

    function releaseSession(sessionKey: string): Promise<void> {
        const priorRelease = modelReleases.get(sessionKey);
        const loads = [...inFlightSessionLoads].filter((load) => load.sessionKey === sessionKey);
        for (const load of loads) {
            load.controller.abort();
        }
        const matchingRequests = [...activeRequests.values()].filter((request) => request.sessionKey === sessionKey);
        for (const request of matchingRequests) {
            request.controller.abort();
        }
        const release = (async (): Promise<void> => {
            if (priorRelease) {
                await priorRelease;
            }
            await Promise.allSettled(matchingRequests.map(({ settled }) => settled));
            await Promise.allSettled(loads.map(({ promise }) => promise));
            const session = sessions.get(sessionKey);
            if (session) {
                disposeModel(session.model);
                sessions.delete(sessionKey);
            }
        })();
        const tracked = release.finally(() => {
            if (modelReleases.get(sessionKey) === tracked) {
                modelReleases.delete(sessionKey);
            }
        });
        modelReleases.set(sessionKey, tracked);
        return tracked;
    }

    function cancelRequest(requestId: string): void {
        activeRequests.get(requestId)?.controller.abort();
    }

    function dispose(): Promise<void> {
        if (disposePromise) {
            return disposePromise;
        }
        disposed = true;
        const requests = [...activeRequests.values()];
        for (const request of requests) {
            request.controller.abort();
        }
        const loads = [...inFlightSessionLoads];
        for (const load of loads) {
            load.controller.abort();
            closeArtifactPorts(load.artifacts);
        }
        disposePromise = Promise.allSettled([
            ...requests.map(({ settled }) => settled),
            ...loads.map(({ promise }) => promise),
            ...modelReleases.values(),
        ]).then(() => {
            sessionLoads.clear();
            inFlightSessionLoads.clear();
            disposeCachedSessions();
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
            input.postResponse({ type: 'worker-disposed', requestId: request.requestId });
            return;
        }
        if (request.type === 'release-ddsp-session') {
            await releaseSession(request.sessionKey);
            input.postResponse({
                type: 'ddsp-session-released',
                requestId: request.requestId,
                sessionKey: request.sessionKey,
            });
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
        if (request.type !== 'create-ddsp-session' && request.type !== 'run-ddsp-inference') {
            if ('requestId' in request) {
                input.postResponse({
                    type: 'error',
                    requestId: request.requestId,
                    error: `Unsupported TF.js request: ${request.type}`,
                });
            }
            return;
        }
        if (activeRequests.has(request.requestId)) {
            if (request.type === 'create-ddsp-session') {
                closeArtifactPorts(request.artifacts);
            }
            input.postResponse({ type: 'error', requestId: request.requestId, error: 'Duplicate DDSP request id' });
            return;
        }
        const sessionKey = request.sessionKey;
        const controller = new AbortController();
        let settle = (): void => undefined;
        const settled = new Promise<void>((resolve) => {
            settle = resolve;
        });
        const activeRequest = { controller, sessionKey, settled, settle };
        activeRequests.set(request.requestId, activeRequest);
        let createStarted = false;
        try {
            const releasing = modelReleases.get(sessionKey);
            if (releasing) {
                await releasing;
            }
            throwIfAborted(controller.signal);
            if (disposed) {
                throw new Error('TF.js worker is disposed');
            }
            if (request.type === 'create-ddsp-session') {
                createStarted = true;
                await createSession(request, controller.signal);
            } else {
                await runInference(request, controller.signal);
            }
        } catch (error) {
            if (request.type === 'create-ddsp-session' && !createStarted) {
                closeArtifactPorts(request.artifacts);
            }
            input.postResponse({
                type: 'error',
                requestId: request.requestId,
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            if (activeRequests.get(request.requestId) === activeRequest) {
                activeRequests.delete(request.requestId);
            }
            activeRequest.settle();
        }
    }

    return { dispose, handleRequest };
}
