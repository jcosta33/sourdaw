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

import { type DdspStoredArtifact, type WorkerRequest, type WorkerResponse } from '../models/InferenceRequest';
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
} = {
    onnx: { worker: null, pendingRequests: new Map(), initialized: false },
    tfjs: { worker: null, pendingRequests: new Map(), initialized: false },
    tfjsIdleTimer: null,
};

const TFJS_IDLE_TIMEOUT_MS = 60_000; // 1 minute — destroy TF.js worker after idle

function createMessageHandler(state: WorkerState): (event: MessageEvent<WorkerResponse>) => void {
    return (event: MessageEvent<WorkerResponse>): void => {
        const msg = event.data;

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

function resetWorkerAfterFailure(state: WorkerState, failedWorker: Worker, reason: Error): void {
    if (state.worker !== failedWorker) {
        return;
    }
    for (const { reject } of state.pendingRequests.values()) {
        reject(reason);
    }
    state.pendingRequests.clear();
    failedWorker.terminate();
    state.worker = null;
    state.initialized = false;
    if (state === workerState.tfjs && workerState.tfjsIdleTimer !== null) {
        clearTimeout(workerState.tfjsIdleTimer);
        workerState.tfjsIdleTimer = null;
    }
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
    worker.onmessage = createMessageHandler(workerState.onnx);
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

    if (workerState.tfjs.worker && workerState.tfjs.initialized) {
        return workerState.tfjs.worker;
    }

    const worker = new Worker(new URL('../workers/tfjsInferenceWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = createMessageHandler(workerState.tfjs);
    workerState.tfjs.worker = worker;
    workerState.tfjs.initialized = true;
    installFailureHandlers(workerState.tfjs, worker, 'TF.js');
    return worker;
}

function scheduleTfjsDestroy(): void {
    if (workerState.tfjsIdleTimer !== null) {
        return;
    }
    workerState.tfjsIdleTimer = setTimeout(() => {
        if (workerState.tfjs.pendingRequests.size === 0 && workerState.tfjs.worker) {
            workerState.tfjs.worker.terminate();
            workerState.tfjs.worker = null;
            workerState.tfjs.initialized = false;
            workerState.tfjsIdleTimer = null;
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

function isOnnxExecutionProviderList(value: unknown): value is Array<'webgpu' | 'wasm'> {
    if (!Array.isArray(value) || value.length === 0) {
        return false;
    }
    const providers = new Set(value);
    return providers.size === value.length && value.every((provider) => provider === 'webgpu' || provider === 'wasm');
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
            response.type !== 'session-created' ||
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

    async loadDdspSession({
        modelId,
        artifacts,
    }: {
        modelId: string;
        artifacts: Array<Omit<DdspStoredArtifact, 'modelDataPort'>>;
    }): Promise<void> {
        logger.info(`[WorkerBridge] Loading DDSP (TF.js) session from verified OPFS: ${modelId}`);
        const worker = await getTfjsWorker();
        const requestId = crypto.randomUUID();
        const streamedArtifacts: DdspStoredArtifact[] = [];
        try {
            for (const artifact of artifacts) {
                const modelDataPort = await modelStorageWorkerBridge.readModel({
                    family: 'ddsp',
                    modelId: artifact.modelId,
                    expectedSizeBytes: artifact.sizeBytes,
                    expectedSha256: artifact.sha256,
                });
                if (modelDataPort === null) {
                    throw new Error(`Verified DDSP artifact is missing: ${artifact.path}`);
                }
                streamedArtifacts.push({ ...artifact, modelDataPort });
            }
            const request: WorkerRequest = {
                type: 'create-session-from-model-storage',
                requestId,
                modelId,
                artifacts: streamedArtifacts,
            };
            await sendRequest(
                worker,
                workerState.tfjs,
                request,
                streamedArtifacts.map((artifact) => artifact.modelDataPort)
            );
        } catch (error) {
            for (const artifact of streamedArtifacts) {
                artifact.modelDataPort.close();
            }
            throw error;
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

    async runDdspInference(input: RunDdspInput): Promise<Extract<WorkerResponse, { type: 'ddsp-result' }>> {
        const worker = await getTfjsWorker();
        const response = await sendRequest(worker, workerState.tfjs, input);
        scheduleTfjsDestroy();
        return response as Extract<WorkerResponse, { type: 'ddsp-result' }>;
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- fire-and-forget postMessage; async for uniform bridge API
    async releaseOnnxSession(modelId: string): Promise<void> {
        if (!workerState.onnx.worker) {
            return;
        }
        const request: WorkerRequest = { type: 'release-session', modelId };
        workerState.onnx.worker.postMessage(request);
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- fire-and-forget postMessage; async for uniform bridge API
    async releaseDdspSession(modelId: string): Promise<void> {
        if (!workerState.tfjs.worker) {
            return;
        }
        const request: WorkerRequest = { type: 'release-session', modelId };
        workerState.tfjs.worker.postMessage(request);
        scheduleTfjsDestroy();
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
        if (pending) {
            workerState.onnx.pendingRequests.delete(requestId);
            pending.reject(new Error('Render cancelled'));
        }
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
     * Mirror of cancelOnnxRequest — see that method for the rationale.
     */
    cancelTfjsRequest(requestId: string): void {
        const pending = workerState.tfjs.pendingRequests.get(requestId);
        if (pending) {
            workerState.tfjs.pendingRequests.delete(requestId);
            pending.reject(new Error('Render cancelled'));
        }
        if (workerState.tfjs.pendingRequests.size === 0 && workerState.tfjs.worker) {
            workerState.tfjs.worker.terminate();
            workerState.tfjs.worker = null;
            workerState.tfjs.initialized = false;
            if (workerState.tfjsIdleTimer !== null) {
                clearTimeout(workerState.tfjsIdleTimer);
                workerState.tfjsIdleTimer = null;
            }
        }
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
        if (workerState.tfjs.worker) {
            workerState.tfjs.worker.terminate();
            workerState.tfjs.worker = null;
            workerState.tfjs.initialized = false;
        }
        if (workerState.tfjsIdleTimer !== null) {
            clearTimeout(workerState.tfjsIdleTimer);
            workerState.tfjsIdleTimer = null;
        }
    },

    terminateAll(): void {
        inferenceWorkerBridge.terminateOnnxWorker();
        inferenceWorkerBridge.terminateTfjsWorker();
    },
};
