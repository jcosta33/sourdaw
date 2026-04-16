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
import { type WorkerRequest, type WorkerResponse } from '../models/InferenceRequest';
import { updateActiveRenderProgress } from '../stores/inferenceProgressStore';

type PendingRequest = {
    resolve: (value: WorkerResponse) => void;
    reject: (reason: unknown) => void;
};

type WorkerState = {
    worker: Worker | null;
    pendingRequests: Map<string, PendingRequest>;
    initialized: boolean;
};

// Module-level state following the §152.1 coalesce pattern from browserStemSeparation.ts
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

async function getOnnxWorker(): Promise<Worker> {
    if (workerState.onnx.worker && workerState.onnx.initialized) {
        return workerState.onnx.worker;
    }

    const worker = new Worker(
        new URL('../workers/onnxInferenceWorker.ts', import.meta.url),
        { type: 'module' }
    );
    worker.onmessage = createMessageHandler(workerState.onnx);
    workerState.onnx.worker = worker;
    workerState.onnx.initialized = true;
    return worker;
}

async function getTfjsWorker(): Promise<Worker> {
    // Reset idle timer
    if (workerState.tfjsIdleTimer !== null) {
        clearTimeout(workerState.tfjsIdleTimer);
        workerState.tfjsIdleTimer = null;
    }

    if (workerState.tfjs.worker && workerState.tfjs.initialized) {
        return workerState.tfjs.worker;
    }

    const worker = new Worker(
        new URL('../workers/tfjsInferenceWorker.ts', import.meta.url),
        { type: 'module' }
    );
    worker.onmessage = createMessageHandler(workerState.tfjs);
    workerState.tfjs.worker = worker;
    workerState.tfjs.initialized = true;
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
        if (transferable && transferable.length > 0) {
            worker.postMessage(request, transferable);
        } else {
            worker.postMessage(request);
        }
        // For fire-and-forget messages (no requestId), resolve immediately
        if (!requestId) {
            resolve({ type: 'status', loadedModels: [], memoryUsageBytes: 0 });
        }
    });
}

type LoadSessionInput = {
    modelId: string;
    modelData: ArrayBuffer;
};

type RunKokoroInput = {
    requestId: string;
    inputIds: BigInt64Array;
    style: Float32Array;
    speed: number;
};

type RunDiffSingerInput = Extract<WorkerRequest, { type: 'run-diffsinger-phrase' }>;

type RunDdspInput = Extract<WorkerRequest, { type: 'run-ddsp-inference' }>;

/**
 * Singleton bridge object for routing inference requests to the correct worker.
 * Module-level singleton — not injectable because it owns worker lifecycle state.
 */
export const inferenceWorkerBridge = {
    async loadOnnxSession({ modelId, modelData }: LoadSessionInput): Promise<void> {
        logger.info(`[WorkerBridge] Loading ONNX session: ${modelId}`);
        const worker = await getOnnxWorker();
        const requestId = crypto.randomUUID();
        const request: WorkerRequest = { type: 'create-session', requestId, modelId, modelData, options: {} };
        await sendRequest(worker, workerState.onnx, request, [modelData]);
    },

    async loadDdspSession({ modelId, modelUrl }: { modelId: string; modelUrl: string }): Promise<void> {
        logger.info(`[WorkerBridge] Loading DDSP (TF.js) session from URL: ${modelId}`);
        const worker = await getTfjsWorker();
        const requestId = crypto.randomUUID();
        const request: WorkerRequest = { type: 'create-session-from-url', requestId, modelId, modelUrl };
        await sendRequest(worker, workerState.tfjs, request);
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

    async runDiffSingerPhrase(input: RunDiffSingerInput): Promise<Extract<WorkerResponse, { type: 'diffsinger-result' }>> {
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

    async runGenericInference(input: {
        modelId: string;
        requestId: string;
        inputs: Record<string, import('../models/InferenceRequest').TensorData>;
    }): Promise<Extract<WorkerResponse, { type: 'inference-result' }>> {
        const worker = await getOnnxWorker();
        const request: WorkerRequest = {
            type: 'run-inference',
            modelId: input.modelId,
            requestId: input.requestId,
            feeds: input.inputs,
        };
        const response = await sendRequest(worker, workerState.onnx, request);
        return response as Extract<WorkerResponse, { type: 'inference-result' }>;
    },

    async releaseOnnxSession(modelId: string): Promise<void> {
        if (!workerState.onnx.worker) {
            return;
        }
        const request: WorkerRequest = { type: 'release-session', modelId };
        workerState.onnx.worker.postMessage(request);
    },

    async releaseDdspSession(modelId: string): Promise<void> {
        if (!workerState.tfjs.worker) {
            return;
        }
        const request: WorkerRequest = { type: 'release-session', modelId };
        workerState.tfjs.worker.postMessage(request);
        scheduleTfjsDestroy();
    },

    /**
     * Terminate the ONNX worker immediately, rejecting all in-flight requests.
     * The worker is respawned automatically on the next inference call.
     * Used by cancelRender to stop DiffSinger/Kokoro inference mid-flight.
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
     * Terminate the TF.js worker immediately, rejecting all in-flight requests.
     * Used by cancelRender to stop DDSP inference mid-flight.
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
