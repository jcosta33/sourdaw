/**
 * TF.js Inference Worker — handles DDSP instrument synthesis via TensorFlow.js.
 *
 * Lazily spawned only when a DDSP instrument is first used.
 * Destroyed when no DDSP sessions are active.
 *
 * DDSP models run in synthesis-only mode:
 *   - Skip the encoder (no audio-to-audio)
 *   - Feed pitch (Hz) and loudness (dB) directly to the decoder at 250 Hz frame rate
 *   - Output raw PCM audio at 16 kHz (resampled to 44.1 kHz on the main thread)
 */

import type { WorkerRequest, WorkerResponse } from '../models/InferenceRequest';

// ── Types ──────────────────────────────────────────────────────────────────

type TfGraphModel = {
    predict: (inputs: TfTensor | TfTensor[] | Record<string, TfTensor>) => TfTensor | TfTensor[] | Record<string, TfTensor>;
    dispose: () => void;
};

type TfTensor = {
    data: () => Promise<Float32Array | Int32Array>;
    shape: number[];
    dispose: () => void;
};

type TfModule = {
    setBackend: (backend: string) => Promise<boolean>;
    ready: Promise<void>;
    loadGraphModel: (url: string | { load: () => Promise<TfGraphModel> }) => Promise<TfGraphModel>;
    tensor2d: (data: number[] | Float32Array, shape: [number, number]) => TfTensor;
    browser?: { fromPixels: (img: HTMLImageElement) => TfTensor };
};

// ── Session state ──────────────────────────────────────────────────────────

type DdspSessionEntry = {
    model: TfGraphModel;
    modelId: string;
    sizeBytes: number;
    lastUsedAt: number;
    /** Native output sample rate (typically 16000 Hz) */
    nativeSampleRate: number;
    /** Frame rate expected by this model (typically 250 Hz) */
    frameRate: number;
};

const SESSION_MEMORY_BUDGET = 512 * 1024 * 1024; // 512 MB for TF.js models

const ddspSessions: Map<string, DdspSessionEntry> = new Map();
let totalTfMemory = 0;
let tfModule: TfModule | null = null;

async function getTf(): Promise<TfModule> {
    if (tfModule) {
        return tfModule;
    }
    const tf = await import('@tensorflow/tfjs') as unknown as TfModule;
    // Try WebGPU backend first for DDSP inference
    try {
        await import('@tensorflow/tfjs-backend-webgpu');
        if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
            await tf.setBackend('webgpu');
        } else {
            await tf.setBackend('cpu');
        }
    } catch {
        await tf.setBackend('cpu');
    }
    await tf.ready;
    tfModule = tf;
    return tf;
}

function evictLruDdsp(): void {
    while (totalTfMemory > SESSION_MEMORY_BUDGET && ddspSessions.size > 0) {
        let oldest: [string, DdspSessionEntry] | null = null;
        for (const entry of ddspSessions.entries()) {
            if (!oldest || entry[1].lastUsedAt < oldest[1].lastUsedAt) {
                oldest = entry;
            }
        }
        if (!oldest) {
            break;
        }
        const [id, entry] = oldest;
        entry.model.dispose();
        totalTfMemory -= entry.sizeBytes;
        ddspSessions.delete(id);
    }
}

// ── DDSP inference ─────────────────────────────────────────────────────────

/**
 * Run DDSP synthesis-only inference.
 *
 * DDSP decoder takes frame-level pitch (Hz) and loudness (dB) and outputs PCM audio.
 * The pitch and loudness arrays must be at the model's frame rate (250 Hz).
 */
async function runDdspInference(
    tf: TfModule,
    model: TfGraphModel,
    pitchHz: Float32Array,
    loudnessDb: Float32Array,
    nFrames: number
): Promise<Float32Array> {
    const pitchTensor = tf.tensor2d(pitchHz, [1, nFrames]);
    const loudnessTensor = tf.tensor2d(loudnessDb, [1, nFrames]);

    try {
        const output = model.predict({ f0_hz: pitchTensor, loudness_db: loudnessTensor });
        const audioTensor = Array.isArray(output)
            ? output[0]
            : (output as Record<string, TfTensor>)['audio'] ?? (output as TfTensor);
        const audioData = await (audioTensor as TfTensor).data();
        return new Float32Array(audioData);
    } finally {
        pitchTensor.dispose();
        loudnessTensor.dispose();
    }
}

// ── Message handler ────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
    const req = event.data;

    if (req.type === 'create-session-from-url') {
        // DDSP GraphModels are multi-file (model.json + weight shards) — load from CDN URL.
        // TF.js caches internally via IndexedDB; no OPFS storage needed.
        if (ddspSessions.has(req.modelId)) {
            // Already loaded — update lastUsedAt and return immediately
            const existing = ddspSessions.get(req.modelId)!;
            existing.lastUsedAt = Date.now();
            self.postMessage({ type: 'session-created', requestId: req.requestId, modelId: req.modelId } as WorkerResponse);
            return;
        }
        try {
            const tf = await getTf();
            const model = await tf.loadGraphModel(req.modelUrl + '/model.json');
            // Query actual weight byte count from the loaded graph model
            const modelSizeBytes = (() => {
                try {
                    const weights = (model as unknown as { weights?: Array<{ shape: number[]; dtype: string }> }).weights;
                    if (!weights) return 15_000_000;
                    const bytesPerDtype: Record<string, number> = { float32: 4, float16: 2, int32: 4, bool: 1 };
                    return weights.reduce((acc: number, w: { shape: number[]; dtype: string }) => {
                        const elems = w.shape.reduce((a: number, b: number) => a * b, 1);
                        return acc + elems * (bytesPerDtype[w.dtype] ?? 4);
                    }, 0);
                } catch {
                    return 15_000_000;
                }
            })();
            const entry: DdspSessionEntry = {
                model,
                modelId: req.modelId,
                sizeBytes: modelSizeBytes,
                lastUsedAt: Date.now(),
                nativeSampleRate: 16000,
                frameRate: 250,
            };
            ddspSessions.set(req.modelId, entry);
            totalTfMemory += entry.sizeBytes;
            evictLruDdsp();

            const response: WorkerResponse = { type: 'session-created', requestId: req.requestId, modelId: req.modelId };
            self.postMessage(response);
        } catch (error) {
            const response: WorkerResponse = { type: 'error', requestId: req.requestId, error: String(error) };
            self.postMessage(response);
        }
        return;
    }

    if (req.type === 'run-ddsp-inference') {
        const entry = ddspSessions.get(req.modelId);
        if (!entry) {
            const response: WorkerResponse = {
                type: 'error',
                requestId: req.requestId,
                error: `DDSP session not found: ${req.modelId}`,
            };
            self.postMessage(response);
            return;
        }

        try {
            const progressMsg: WorkerResponse = {
                type: 'inference-progress',
                requestId: req.requestId,
                stage: 'Running DDSP synthesis',
                progress: 0.1,
            };
            self.postMessage(progressMsg);

            const tf = await getTf();
            entry.lastUsedAt = Date.now();
            const nFrames = req.pitchHz.length;

            const audio = await runDdspInference(tf, entry.model, req.pitchHz, req.loudnessDb, nFrames);

            const doneMsg: WorkerResponse = {
                type: 'ddsp-result',
                requestId: req.requestId,
                audio,
                nativeSampleRate: entry.nativeSampleRate,
            };
            self.postMessage(doneMsg, [audio.buffer]);
        } catch (error) {
            const response: WorkerResponse = {
                type: 'error',
                requestId: req.requestId,
                error: String(error),
            };
            self.postMessage(response);
        }
        return;
    }

    if (req.type === 'release-session') {
        const entry = ddspSessions.get(req.modelId);
        if (entry) {
            entry.model.dispose();
            totalTfMemory -= entry.sizeBytes;
            ddspSessions.delete(req.modelId);
        }
        return;
    }

    if (req.type === 'get-status') {
        const response: WorkerResponse = {
            type: 'status',
            loadedModels: Array.from(ddspSessions.keys()),
            memoryUsageBytes: totalTfMemory,
        };
        self.postMessage(response);
        return;
    }
};
