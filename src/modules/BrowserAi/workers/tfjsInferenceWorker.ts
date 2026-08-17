/**
 * TF.js Inference Worker — DDSP instrument synthesis stub.
 *
 * TensorFlow.js cannot be statically bundled by Rolldown (same constraint as
 * @huggingface/transformers) and cannot be loaded from CDN because the app's
 * Cross-Origin-Embedder-Policy: require-corp header blocks cross-origin scripts
 * that lack a Cross-Origin-Resource-Policy header (jsDelivr/unpkg do not send one).
 *
 * DDSP browser rendering is therefore not available in this build. All requests
 * respond with a clear error. The worker file is retained so the bridge and use
 * cases compile without changes; the UI shows a "not available" state.
 */

import type { WorkerRequest, WorkerResponse } from '../models/InferenceRequest';

const UNAVAILABLE = 'DDSP browser rendering is unavailable because TensorFlow.js cannot be bundled by Rolldown.';

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
    const req = event.data;

    if (req.type === 'get-status') {
        const response: WorkerResponse = {
            type: 'status',
            requestId: req.requestId,
            loadedModels: [],
            memoryUsageBytes: 0,
        };
        self.postMessage(response);
        return;
    }

    if (req.type === 'release-session') {
        // No-op — nothing to release.
        return;
    }

    // All session creation and inference requests fail with a clear message.
    if ('requestId' in req) {
        const response: WorkerResponse = { type: 'error', requestId: req.requestId, error: UNAVAILABLE };
        self.postMessage(response);
    }
};
