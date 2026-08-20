import { type DdspStoredArtifact, type WorkerRequest, type WorkerResponse } from '../models/InferenceRequest';

import type { GraphModel, NamedTensorMap, Tensor, io } from '@tensorflow/tfjs';

const sessions = new Map<string, GraphModel>();
let tfModule: typeof import('@tensorflow/tfjs') | undefined;
type WeightSpec = {
    name: string;
    shape: number[];
    dtype: 'float32' | 'int32' | 'bool' | 'complex64' | 'string';
    quantization?: { min: number; scale: number; dtype: 'uint8' | 'uint16' };
};

function post(response: WorkerResponse, transfer?: Transferable[]): void {
    self.postMessage(response, transfer ? { transfer } : undefined);
}

async function readArtifact(artifact: DdspStoredArtifact): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        artifact.modelDataPort.onmessage = (
            event: MessageEvent<{ type: string; modelData?: ArrayBuffer; message?: string }>
        ) => {
            artifact.modelDataPort.close();
            if (event.data.type === 'model-data' && event.data.modelData) {
                resolve(event.data.modelData);
            } else {
                reject(new Error(event.data.message ?? `Unable to read DDSP artifact: ${artifact.path}`));
            }
        };
        artifact.modelDataPort.start();
    });
}

async function loadTfjs(): Promise<typeof import('@tensorflow/tfjs')> {
    if (tfModule) {
        return tfModule;
    }
    const tf = await import('@tensorflow/tfjs');
    // Vite's worker define can expose a partial `process`; TF.js prefers it over
    // the WorkerGlobalScope unless this points its environment back at the worker.
    tf.env().global = globalThis;
    await import('@tensorflow/tfjs-backend-webgpu');
    if (typeof navigator === 'undefined' || !navigator.gpu) {
        throw new Error('DDSP requires WebGPU');
    }
    if ((await tf.setBackend('webgpu')) !== true) {
        throw new Error('TF.js could not initialize its required WebGPU backend');
    }
    await tf.ready();
    tf.registerOp('Roll', (node) => {
        const input = node.inputs[0];
        if (!input) {
            throw new Error('DDSP Roll operation received no input');
        }
        const [first, second] = tf.split(input, 2, 2);
        if (!first || !second) {
            throw new Error('DDSP Roll operation could not split its input');
        }
        const result = tf.concat([second, first], 2);
        first.dispose();
        second.dispose();
        return result;
    });
    tfModule = tf;
    return tf;
}

function firstTensor(output: Tensor | Tensor[] | NamedTensorMap): Tensor {
    if (Array.isArray(output)) {
        if (!output[0]) {
            throw new Error('DDSP model returned no output');
        }
        return output[0];
    }
    if (typeof Reflect.get(output, 'data') === 'function') {
        return output as Tensor;
    }
    const tensor = (output as NamedTensorMap)['Identity:0'] ?? Object.values(output as NamedTensorMap)[0];
    if (!tensor) {
        throw new Error('DDSP model returned no output');
    }
    return tensor;
}

async function createSession(
    request: Extract<WorkerRequest, { type: 'create-session-from-model-storage' }>
): Promise<void> {
    if (sessions.has(request.modelId)) {
        const tf = await loadTfjs();
        post({
            type: 'session-created',
            requestId: request.requestId,
            modelId: request.modelId,
            backend: tf.getBackend(),
        });
        return;
    }
    const tf = await loadTfjs();
    const artifacts = new Map(request.artifacts.map((artifact) => [artifact.path, artifact]));
    const modelArtifact = artifacts.get('model.json');
    const shard = artifacts.get('group1-shard1of1.bin');
    const settings = artifacts.get('settings.json');
    if (!modelArtifact || !shard || !settings) {
        throw new Error('DDSP manifest is incomplete');
    }
    const modelJson = JSON.parse(new TextDecoder().decode(await readArtifact(modelArtifact))) as {
        modelTopology: Record<string, unknown>;
        weightsManifest: Array<{ weights: WeightSpec[] }>;
        format?: string;
        generatedBy?: string;
        convertedBy?: string;
    };
    const weightData = await readArtifact(shard);
    await readArtifact(settings);
    const handler: io.IOHandler = {
        load: async () => ({
            modelTopology: modelJson.modelTopology,
            weightSpecs: modelJson.weightsManifest.flatMap((group) => group.weights),
            weightData,
            format: modelJson.format,
            generatedBy: modelJson.generatedBy,
            convertedBy: modelJson.convertedBy,
        }),
    };
    sessions.set(request.modelId, await tf.loadGraphModel(handler));
    post({ type: 'session-created', requestId: request.requestId, modelId: request.modelId, backend: tf.getBackend() });
}

async function runInference(request: Extract<WorkerRequest, { type: 'run-ddsp-inference' }>): Promise<void> {
    const session = sessions.get(request.modelId);
    if (!session) {
        throw new Error(`DDSP session not found: ${request.modelId}`);
    }
    const tf = await loadTfjs();
    const pitch = tf.tensor1d(request.pitchHz);
    const loudness = tf.tensor1d(request.loudnessDb);
    let outputTensor: Tensor | undefined;
    try {
        outputTensor = firstTensor(session.predict({ f0_hz: pitch, loudness_db: loudness }));
        const audio = Float32Array.from(await outputTensor.data());
        post(
            {
                type: 'ddsp-result',
                requestId: request.requestId,
                audio,
                nativeSampleRate: 16_000,
                backend: tf.getBackend(),
            },
            [audio.buffer]
        );
    } finally {
        pitch.dispose();
        loudness.dispose();
        outputTensor?.dispose();
    }
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
    const request = event.data;
    if (request.type === 'release-session') {
        sessions.get(request.modelId)?.dispose();
        sessions.delete(request.modelId);
        return;
    }
    if (request.type === 'get-status') {
        post({ type: 'status', requestId: request.requestId, loadedModels: [...sessions.keys()], memoryUsageBytes: 0 });
        return;
    }
    if (request.type !== 'create-session-from-model-storage' && request.type !== 'run-ddsp-inference') {
        if ('requestId' in request) {
            post({ type: 'error', requestId: request.requestId, error: `Unsupported TF.js request: ${request.type}` });
        }
        return;
    }
    void (request.type === 'create-session-from-model-storage' ? createSession(request) : runInference(request)).catch(
        (error: unknown) =>
            post({
                type: 'error',
                requestId: request.requestId,
                error: error instanceof Error ? error.message : String(error),
            })
    );
};
