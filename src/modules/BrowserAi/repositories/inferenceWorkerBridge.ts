/**
 * Repository: Inference worker bridge.
 *
 * Manages the two inference workers (ONNX and TF.js) and routes
 * inference requests to the correct worker by model type.
 *
 * - ONNX Worker: always initialized, handles DiffSinger + Kokoro
 * - TF.js Worker: lazily spawned on first DDSP use, destroyed when idle
 *
 * Both workers communicate via the same typed WorkerRequest/WorkerResponse protocol.
 *
 * This is a module-level singleton — not injectable because it manages
 * worker lifecycle as module-level state (following the §152.1 pattern).
 */

import { logger } from '#/infra/logger/appLogger';

import { type DdspArtifact } from '../models/DdspArtifactManifest';
import {
    type DdspSettings,
    type DdspStoredArtifact,
    type WorkerRequest,
    type WorkerResponse,
} from '../models/InferenceRequest';
import { computeDdspSessionKey } from '../services/computeDdspSessionKey';
import { updateActiveRenderProgress } from '../stores/inferenceProgressStore';

import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';

type PendingRequest = {
    resolve: (value: WorkerResponse) => void;
    reject: (reason: unknown) => void;
};

type WorkerState = {
    worker: Worker | null;
    pendingRequests: Map<string, PendingRequest>;
    initialized: boolean;
};

// One state object coalesces worker initialization and request ownership.
const workerState: {
    onnx: WorkerState;
    tfjs: WorkerState;
    tfjsIdleTimer: ReturnType<typeof setTimeout> | null;
    tfjsShutdownPromise: Promise<void> | null;
} = {
    onnx: { worker: null, pendingRequests: new Map(), initialized: false },
    tfjs: { worker: null, pendingRequests: new Map(), initialized: false },
    tfjsIdleTimer: null,
    tfjsShutdownPromise: null,
};

const TFJS_IDLE_TIMEOUT_MS = 60_000; // 1 minute — destroy TF.js worker after idle

function createMessageHandler(state: WorkerState, worker: Worker): (event: MessageEvent<WorkerResponse>) => void {
    return (event: MessageEvent<WorkerResponse>): void => {
        const msg = event.data;

        if (msg.type === 'worker-fatal-error') {
            resetWorkerAfterFailure(state, worker, new Error(msg.error));
            return;
        }

        // Progress events don't resolve a pending request
        if (msg.type === 'inference-progress') {
            updateActiveRenderProgress({
                requestId: msg.requestId,
                stage: msg.stage,
                progress: msg.progress,
            });
            return;
        }

        const requestId = 'requestId' in msg ? msg.requestId : '';
        const pending = state.pendingRequests.get(requestId);
        if (!pending) {
            return;
        }

        state.pendingRequests.delete(requestId);

        if (msg.type === 'error') {
            pending.reject(new Error(msg.error));
        } else {
            pending.resolve(msg);
        }
    };
}

function toError(reason: unknown, fallback: string): Error {
    if (reason instanceof Error) {
        return reason;
    }
    return new Error(typeof reason === 'string' && reason ? reason : fallback);
}

function createAbortError(): DOMException {
    return new DOMException('Render cancelled', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw createAbortError();
    }
}

async function waitForAbortableTfjsRequest<TResult>(
    request: Promise<TResult>,
    requestId: string,
    signal: AbortSignal | undefined
): Promise<TResult> {
    if (signal === undefined) {
        return request;
    }
    const cancel = (): void => inferenceWorkerBridge.cancelTfjsRequest(requestId);
    if (signal.aborted) {
        cancel();
    }
    signal.addEventListener('abort', cancel, { once: true });
    try {
        return await request;
    } finally {
        signal.removeEventListener('abort', cancel);
    }
}

async function waitForAbortableModelRead(
    read: Promise<MessagePort | null>,
    signal: AbortSignal | undefined
): Promise<MessagePort | null> {
    if (signal === undefined) {
        return read;
    }
    if (signal.aborted) {
        void read.then(
            (port) => port?.close(),
            () => undefined
        );
        throw createAbortError();
    }
    return new Promise((resolve, reject) => {
        let aborted = false;
        const cancel = (): void => {
            aborted = true;
            reject(createAbortError());
        };
        signal.addEventListener('abort', cancel, { once: true });
        void read.then(
            (port) => {
                signal.removeEventListener('abort', cancel);
                if (aborted) {
                    port?.close();
                    return;
                }
                resolve(port);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', cancel);
                if (!aborted) {
                    reject(error);
                }
            }
        );
    });
}

function stopWorker(state: WorkerState, stoppedWorker: Worker): void {
    stoppedWorker.onmessage = null;
    stoppedWorker.onerror = null;
    stoppedWorker.onmessageerror = null;
    stoppedWorker.terminate();
    if (state.worker === stoppedWorker) {
        state.worker = null;
        state.initialized = false;
    }
    if (state === workerState.tfjs && workerState.tfjsIdleTimer !== null) {
        clearTimeout(workerState.tfjsIdleTimer);
        workerState.tfjsIdleTimer = null;
    }
}

function resetWorkerAfterFailure(state: WorkerState, failedWorker: Worker, reason: Error): void {
    if (state.worker !== failedWorker) {
        return;
    }
    for (const { reject } of state.pendingRequests.values()) {
        reject(reason);
    }
    state.pendingRequests.clear();
    stopWorker(state, failedWorker);
}

function installFailureHandlers(state: WorkerState, worker: Worker, label: string): void {
    worker.onerror = (event) => {
        resetWorkerAfterFailure(state, worker, new Error(event.message || `${label} inference worker failed`));
    };
    worker.onmessageerror = () => {
        resetWorkerAfterFailure(state, worker, new Error(`${label} inference worker returned an unreadable response`));
    };
}

// eslint-disable-next-line @typescript-eslint/require-await -- consistent async API; callers await this; worker creation is currently synchronous
async function getOnnxWorker(): Promise<Worker> {
    if (workerState.onnx.worker && workerState.onnx.initialized) {
        return workerState.onnx.worker;
    }

    const worker = new Worker(new URL('../workers/onnxInferenceWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = createMessageHandler(workerState.onnx, worker);
    workerState.onnx.worker = worker;
    workerState.onnx.initialized = true;
    installFailureHandlers(workerState.onnx, worker, 'ONNX');
    return worker;
}

// eslint-disable-next-line @typescript-eslint/require-await -- consistent async API; callers await this; worker creation is currently synchronous
async function getTfjsWorker(): Promise<Worker> {
    // Reset idle timer
    if (workerState.tfjsIdleTimer !== null) {
        clearTimeout(workerState.tfjsIdleTimer);
        workerState.tfjsIdleTimer = null;
    }

    if (workerState.tfjsShutdownPromise !== null) {
        await workerState.tfjsShutdownPromise.catch(() => undefined);
    }

    if (workerState.tfjs.worker && workerState.tfjs.initialized) {
        return workerState.tfjs.worker;
    }

    const worker = new Worker(new URL('../workers/tfjsInferenceWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = createMessageHandler(workerState.tfjs, worker);
    workerState.tfjs.worker = worker;
    workerState.tfjs.initialized = true;
    installFailureHandlers(workerState.tfjs, worker, 'TF.js');
    return worker;
}

async function disposeTfjsWorker(worker: Worker): Promise<void> {
    const requestId = crypto.randomUUID();
    try {
        const response = await sendRequest(worker, workerState.tfjs, { type: 'dispose-worker', requestId });
        if (response.type !== 'worker-disposed') {
            throw new Error(`TF.js worker did not confirm disposal: ${response.type}`);
        }
    } finally {
        if (workerState.tfjs.worker === worker) {
            stopWorker(workerState.tfjs, worker);
        }
    }
}

function scheduleTfjsDestroy(): void {
    if (
        workerState.tfjsIdleTimer !== null ||
        workerState.tfjs.worker === null ||
        workerState.tfjsShutdownPromise !== null
    ) {
        return;
    }
    workerState.tfjsIdleTimer = setTimeout(() => {
        workerState.tfjsIdleTimer = null;
        const worker = workerState.tfjs.worker;
        if (workerState.tfjs.pendingRequests.size === 0 && worker !== null) {
            const tracked = disposeTfjsWorker(worker).finally(() => {
                if (workerState.tfjsShutdownPromise === tracked) {
                    workerState.tfjsShutdownPromise = null;
                }
            });
            workerState.tfjsShutdownPromise = tracked;
            void tracked.catch(() => undefined);
        }
    }, TFJS_IDLE_TIMEOUT_MS);
}

function sendRequest(
    worker: Worker,
    state: WorkerState,
    request: WorkerRequest,
    transferable?: Transferable[]
): Promise<WorkerResponse> {
    return new Promise<WorkerResponse>((resolve, reject) => {
        const requestId = 'requestId' in request ? request.requestId : '';
        if (requestId) {
            state.pendingRequests.set(requestId, { resolve, reject });
        }
        try {
            if (transferable && transferable.length > 0) {
                worker.postMessage(request, transferable);
            } else {
                worker.postMessage(request);
            }
        } catch (error) {
            for (const item of transferable ?? []) {
                if (typeof MessagePort !== 'undefined' && item instanceof MessagePort) {
                    item.close();
                }
            }
            resetWorkerAfterFailure(state, worker, toError(error, 'Inference worker request failed'));
            return;
        }
        // For fire-and-forget messages (no requestId), resolve immediately
        if (!requestId) {
            resolve({ type: 'status', requestId: '', loadedModels: [], memoryUsageBytes: 0 });
        }
    });
}

type LoadSessionInput = { modelId: string; modelData: ArrayBuffer } | { modelId: string; modelDataPort: MessagePort };

type RunKokoroInput = {
    requestId: string;
    inputIds: BigInt64Array;
    style: Float32Array;
    speed: number;
};

type RunDiffSingerInput = Extract<WorkerRequest, { type: 'run-diffsinger-phrase' }>;

type RunDdspInput = Extract<WorkerRequest, { type: 'run-ddsp-inference' }>;

type LoadDdspSessionInput = {
    artifactVersion: string;
    artifacts: readonly DdspArtifact[];
    instrumentId: string;
    requestId?: string;
};

const DDSP_ARTIFACT_PATHS = ['model.json', 'group1-shard1of1.bin', 'settings.json'] as const;

function validateDdspArtifacts(artifacts: readonly DdspArtifact[]): void {
    const paths = artifacts.map(({ path }) => path);
    if (
        paths.length !== DDSP_ARTIFACT_PATHS.length ||
        new Set(paths).size !== paths.length ||
        !DDSP_ARTIFACT_PATHS.every((path) => paths.includes(path))
    ) {
        throw new Error('DDSP artifact manifest is incomplete');
    }
}

async function readDdspArtifacts(
    { artifactVersion, artifacts, instrumentId }: LoadDdspSessionInput,
    signal?: AbortSignal
): Promise<DdspStoredArtifact[]> {
    validateDdspArtifacts(artifacts);
    const storedArtifacts: DdspStoredArtifact[] = [];
    try {
        for (const artifact of artifacts) {
            throwIfAborted(signal);
            const modelDataPort = await waitForAbortableModelRead(
                modelStorageWorkerBridge.readModel({
                    family: 'ddsp',
                    modelId: `${instrumentId}/${artifactVersion}/${artifact.path}`,
                    expectedSizeBytes: artifact.sizeBytes,
                    expectedSha256: artifact.sha256,
                }),
                signal
            );
            if (modelDataPort === null) {
                throw new Error(`Verified DDSP artifact is missing: ${artifact.path}`);
            }
            storedArtifacts.push({
                path: artifact.path,
                sizeBytes: artifact.sizeBytes,
                sha256: artifact.sha256,
                modelDataPort,
            });
        }
        throwIfAborted(signal);
        return storedArtifacts;
    } catch (error) {
        for (const artifact of storedArtifacts) {
            artifact.modelDataPort.close();
        }
        throw error;
    }
}

function isOnnxExecutionProviderList(value: unknown): value is Array<'webgpu' | 'wasm'> {
    if (!Array.isArray(value) || value.length === 0) {
        return false;
    }
    const providers = new Set(value);
    return providers.size === value.length && value.every((provider) => provider === 'webgpu' || provider === 'wasm');
}

function isOnnxSessionResponse(
    response: WorkerResponse
): response is Extract<WorkerResponse, { type: 'session-created'; modelId: string }> {
    return response.type === 'session-created' && 'modelId' in response;
}

function isDdspSessionResponse(
    response: WorkerResponse
): response is Extract<WorkerResponse, { type: 'session-created'; sessionKey: string }> {
    return response.type === 'session-created' && 'sessionKey' in response;
}

/**
 * Singleton bridge object for routing inference requests to the correct worker.
 * Module-level singleton — not injectable because it owns worker lifecycle state.
 */
export const inferenceWorkerBridge = {
    async loadOnnxSession(input: LoadSessionInput): Promise<string[]> {
        const { modelId } = input;
        logger.info(`[WorkerBridge] Loading ONNX session: ${modelId}`);
        const worker = await getOnnxWorker();
        const requestId = crypto.randomUUID();
        let response: WorkerResponse;
        if ('modelDataPort' in input) {
            const request: WorkerRequest = {
                type: 'create-session-from-model-port',
                requestId,
                modelId,
                modelDataPort: input.modelDataPort,
                options: {},
            };
            response = await sendRequest(worker, workerState.onnx, request, [input.modelDataPort]);
        } else {
            const request: WorkerRequest = {
                type: 'create-session',
                requestId,
                modelId,
                modelData: input.modelData,
                options: {},
            };
            response = await sendRequest(worker, workerState.onnx, request, [input.modelData]);
        }
        if (
            !isOnnxSessionResponse(response) ||
            response.modelId !== modelId ||
            !isOnnxExecutionProviderList(response.executionProviders)
        ) {
            throw new Error(`Unexpected ONNX session response: ${response.type}`);
        }
        return response.executionProviders;
    },

    /**
     * Query the ONNX worker for the session ids it currently holds in its LIVE
     * session cache. Callers use this to skip re-reading + re-transferring a model
     * the worker already has loaded. The answer reflects LRU eviction — a key that
     * was evicted will not appear — so callers must still load anything absent here.
     */
    async getLoadedOnnxSessions(): Promise<string[]> {
        const worker = await getOnnxWorker();
        const requestId = crypto.randomUUID();
        const request: WorkerRequest = { type: 'get-status', requestId };
        const response = await sendRequest(worker, workerState.onnx, request);
        return response.type === 'status' ? response.loadedModels : [];
    },

    async loadDdspSession(
        input: LoadDdspSessionInput,
        signal?: AbortSignal
    ): Promise<{ sessionKey: string; backend: 'webgpu'; modelFrameLength: number; settings: DdspSettings }> {
        throwIfAborted(signal);
        const sessionKey = await computeDdspSessionKey(input);
        logger.info(`[WorkerBridge] Loading verified DDSP session: ${sessionKey}`);
        const artifacts = await readDdspArtifacts(input, signal);
        let handedOff = false;
        try {
            const worker = await getTfjsWorker();
            throwIfAborted(signal);
            const requestId = input.requestId ?? crypto.randomUUID();
            const request: WorkerRequest = {
                type: 'create-ddsp-session',
                requestId,
                sessionKey,
                artifacts,
            };
            const pending = sendRequest(
                worker,
                workerState.tfjs,
                request,
                artifacts.map(({ modelDataPort }) => modelDataPort)
            );
            handedOff = true;
            const response = await waitForAbortableTfjsRequest(pending, requestId, signal);
            if (
                !isDdspSessionResponse(response) ||
                response.sessionKey !== sessionKey ||
                response.backend !== 'webgpu' ||
                !Number.isSafeInteger(response.modelFrameLength) ||
                response.modelFrameLength <= 0 ||
                response.settings.modelMaxFrameLength !== response.modelFrameLength
            ) {
                throw new Error(`Unexpected DDSP session response: ${response.type}`);
            }
            return {
                sessionKey: response.sessionKey,
                backend: response.backend,
                modelFrameLength: response.modelFrameLength,
                settings: response.settings,
            };
        } finally {
            if (!handedOff) {
                for (const artifact of artifacts) {
                    artifact.modelDataPort.close();
                }
            }
            scheduleTfjsDestroy();
        }
    },

    async runKokoroTts(input: RunKokoroInput): Promise<Extract<WorkerResponse, { type: 'tts-result' }>> {
        const worker = await getOnnxWorker();
        const request: WorkerRequest = { type: 'run-kokoro-tts', ...input };
        // Transfer typed array buffers (zero-copy) — they are consumed by the worker
        const response = await sendRequest(worker, workerState.onnx, request, [
            input.inputIds.buffer,
            input.style.buffer,
        ]);
        return response as Extract<WorkerResponse, { type: 'tts-result' }>;
    },

    async runDiffSingerPhrase(
        input: RunDiffSingerInput
    ): Promise<Extract<WorkerResponse, { type: 'diffsinger-result' }>> {
        const worker = await getOnnxWorker();
        const response = await sendRequest(worker, workerState.onnx, input);
        return response as Extract<WorkerResponse, { type: 'diffsinger-result' }>;
    },

    async runDdspInference(
        input: RunDdspInput,
        signal?: AbortSignal
    ): Promise<Extract<WorkerResponse, { type: 'ddsp-result' }>> {
        throwIfAborted(signal);
        const worker = await getTfjsWorker();
        throwIfAborted(signal);
        try {
            const response = await waitForAbortableTfjsRequest(
                sendRequest(worker, workerState.tfjs, input, [input.f0Hz.buffer, input.loudnessDb.buffer]),
                input.requestId,
                signal
            );
            if (response.type !== 'ddsp-result' || response.backend !== 'webgpu') {
                throw new Error(`Unexpected DDSP inference response: ${response.type}`);
            }
            return response;
        } finally {
            scheduleTfjsDestroy();
        }
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- fire-and-forget postMessage; async for uniform bridge API
    async releaseOnnxSession(modelId: string): Promise<void> {
        if (!workerState.onnx.worker) {
            return;
        }
        const request: WorkerRequest = { type: 'release-session', modelId };
        workerState.onnx.worker.postMessage(request);
    },

    async releaseDdspSession(sessionKey: string): Promise<void> {
        if (workerState.tfjsShutdownPromise !== null) {
            await workerState.tfjsShutdownPromise.catch(() => undefined);
        }
        if (!workerState.tfjs.worker) {
            return;
        }
        if (workerState.tfjsIdleTimer !== null) {
            clearTimeout(workerState.tfjsIdleTimer);
            workerState.tfjsIdleTimer = null;
        }
        const worker = workerState.tfjs.worker;
        const requestId = crypto.randomUUID();
        const request: WorkerRequest = { type: 'release-ddsp-session', requestId, sessionKey };
        try {
            const response = await sendRequest(worker, workerState.tfjs, request);
            if (
                response.type !== 'ddsp-session-released' ||
                response.requestId !== requestId ||
                response.sessionKey !== sessionKey
            ) {
                throw new Error(`Unexpected DDSP release response: ${response.type}`);
            }
        } finally {
            scheduleTfjsDestroy();
        }
    },

    /**
     * Cancel a single in-flight ONNX render without disturbing sibling renders.
     *
     * Rejects only the targeted request's promise and forgets it. ORT has no
     * abortable run primitive and the ONNX worker is shared across renders, so
     * we only terminate (which is what actually stops compute) when no other
     * ONNX render is in flight. When siblings remain, the cancelled request's
     * eventual worker response is silently dropped (the message handler ignores
     * responses for requestIds no longer in pendingRequests).
     *
     * Used by cancelRender to stop a DiffSinger/Kokoro render mid-flight.
     */
    cancelOnnxRequest(requestId: string): void {
        const pending = workerState.onnx.pendingRequests.get(requestId);
        if (!pending) {
            return;
        }
        workerState.onnx.pendingRequests.delete(requestId);
        pending.reject(new Error('Render cancelled'));
        // Only tear down the shared worker if this was the last in-flight render —
        // otherwise we'd kill compute (and reject promises) for sibling renders.
        if (workerState.onnx.pendingRequests.size === 0 && workerState.onnx.worker) {
            workerState.onnx.worker.terminate();
            workerState.onnx.worker = null;
            workerState.onnx.initialized = false;
        }
    },

    /**
     * Terminate the ONNX worker immediately, rejecting all in-flight requests.
     * The worker is respawned automatically on the next inference call.
     * Used by terminateAll for a hard reset of all ONNX inference.
     */
    terminateOnnxWorker(): void {
        for (const { reject } of workerState.onnx.pendingRequests.values()) {
            reject(new Error('Render cancelled'));
        }
        workerState.onnx.pendingRequests.clear();
        if (workerState.onnx.worker) {
            workerState.onnx.worker.terminate();
            workerState.onnx.worker = null;
            workerState.onnx.initialized = false;
        }
    },

    /**
     * Cancel a single in-flight DDSP (TF.js) render without disturbing siblings.
     * The worker receives the same request id and aborts only that runtime task.
     */
    cancelTfjsRequest(requestId: string): void {
        const pending = workerState.tfjs.pendingRequests.get(requestId);
        if (!pending) {
            return;
        }
        workerState.tfjs.pendingRequests.delete(requestId);
        pending.reject(createAbortError());
        const worker = workerState.tfjs.worker;
        if (worker) {
            try {
                worker.postMessage({ type: 'cancel-request', requestId } satisfies WorkerRequest);
            } catch (error) {
                resetWorkerAfterFailure(workerState.tfjs, worker, toError(error, 'TF.js cancellation failed'));
                return;
            }
        }
        scheduleTfjsDestroy();
    },

    /**
     * Terminate the TF.js worker immediately, rejecting all in-flight requests.
     * Used by terminateAll for a hard reset of all DDSP inference.
     */
    terminateTfjsWorker(): void {
        for (const { reject } of workerState.tfjs.pendingRequests.values()) {
            reject(new Error('Render cancelled'));
        }
        workerState.tfjs.pendingRequests.clear();
        const worker = workerState.tfjs.worker;
        if (worker) {
            stopWorker(workerState.tfjs, worker);
        }
        if (workerState.tfjsIdleTimer !== null) {
            clearTimeout(workerState.tfjsIdleTimer);
            workerState.tfjsIdleTimer = null;
        }
        workerState.tfjsShutdownPromise = null;
    },

    terminateAll(): void {
        inferenceWorkerBridge.terminateOnnxWorker();
        inferenceWorkerBridge.terminateTfjsWorker();
    },
};
