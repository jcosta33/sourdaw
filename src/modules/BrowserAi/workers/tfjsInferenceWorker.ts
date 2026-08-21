import { type WorkerRequest, type WorkerResponse } from '../models/InferenceRequest';

import {
    createTfjsInferenceRequestHandler,
    requireHardwareWebGpu,
    type TfjsWorkerModel,
    type TfjsWorkerRuntime,
    type TfjsWorkerTensor,
} from './tfjsInferenceWorkerRuntime';

import type { NamedTensorMap, Tensor } from '@tensorflow/tfjs-core';

const SESSION_IDLE_MS = 55_000;
let rollRegistered = false;

/** Initialize only the hardware WebGPU backend; no CPU, WebGL, or software success path exists. */
async function initializeTfjs(): Promise<TfjsWorkerRuntime> {
    await requireHardwareWebGpu(typeof navigator === 'undefined' ? undefined : navigator.gpu);
    const tf = await import('@tensorflow/tfjs-core');
    const converter = await import('@tensorflow/tfjs-converter');
    tf.env().global = globalThis;
    await import('@tensorflow/tfjs-backend-webgpu');
    if ((await tf.setBackend('webgpu')) !== true) {
        throw new Error('TF.js could not initialize its required WebGPU backend');
    }
    await tf.ready();
    if (tf.getBackend() !== 'webgpu') {
        throw new Error(`DDSP requires WebGPU; TF.js selected ${tf.getBackend() || 'no backend'}`);
    }

    if (!rollRegistered) {
        // Adapted from Magenta.js DDSP model.ts at immutable revision
        // 0692eb2b79681f062c6b6dd53a0361967f298caa (Apache-2.0).
        converter.registerOp('Roll', (node) => {
            const input = node.inputs[0];
            if (input === undefined) {
                throw new Error('DDSP Roll operation received no input');
            }
            const halves = tf.split(input, 2, 2);
            const first = halves[0];
            const second = halves[1];
            if (first === undefined || second === undefined) {
                for (const tensor of halves) {
                    tensor.dispose();
                }
                throw new Error('DDSP Roll operation could not split its input');
            }
            try {
                return tf.concat([second, first], 2);
            } finally {
                first.dispose();
                second.dispose();
            }
        });
        rollRegistered = true;
    }

    const rawTensors = new WeakMap<TfjsWorkerTensor, Tensor>();
    const wrapTensor = (tensor: Tensor): TfjsWorkerTensor => {
        const wrapped: TfjsWorkerTensor = {
            data: async () => {
                const raw = await tensor.data();
                return Float32Array.from(raw, Number);
            },
            dispose: () => tensor.dispose(),
            dtype: tensor.dtype,
            shape: [...tensor.shape],
        };
        rawTensors.set(wrapped, tensor);
        return wrapped;
    };
    const wrapPrediction = (output: Tensor | Tensor[] | NamedTensorMap): ReturnType<TfjsWorkerModel['predict']> => {
        if (Array.isArray(output)) {
            return output.map(wrapTensor);
        }
        if (output instanceof tf.Tensor) {
            return wrapTensor(output);
        }
        return Object.fromEntries(Object.entries(output).map(([name, tensor]) => [name, wrapTensor(tensor)]));
    };

    return {
        getBackend: () => tf.getBackend(),
        loadGraphModel: async (handler) => {
            const model = await converter.loadGraphModel(handler);
            return {
                dispose: () => model.dispose(),
                predict: (feeds) => {
                    const namedFeeds: NamedTensorMap = {};
                    for (const [name, tensor] of Object.entries(feeds)) {
                        const raw = rawTensors.get(tensor);
                        if (raw === undefined) {
                            throw new Error(`DDSP received an unknown TF.js tensor: ${name}`);
                        }
                        namedFeeds[name] = raw;
                    }
                    return wrapPrediction(model.predict(namedFeeds));
                },
            };
        },
        tensor1d: (values) => wrapTensor(tf.tensor1d(values)),
    };
}

function postResponse(response: WorkerResponse, transfer?: Transferable[]): void {
    self.postMessage(response, transfer === undefined ? undefined : { transfer });
}

const runtime = createTfjsInferenceRequestHandler({
    idleMs: SESSION_IDLE_MS,
    initializeTfjs,
    postResponse,
});

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
    void runtime.handleRequest(event.data);
};

self.onmessageerror = (): void => {
    void runtime.dispose();
};
