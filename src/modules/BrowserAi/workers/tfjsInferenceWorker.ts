import { type WorkerRequest, type WorkerResponse } from '../models/InferenceRequest';

import {
    createTfjsInferenceRequestHandler,
    type TfjsWorkerModel,
    type TfjsWorkerRuntime,
    type TfjsWorkerTensor,
} from './tfjsInferenceWorkerRuntime';

import type { NamedTensorMap, Tensor, io } from '@tensorflow/tfjs';

// Dispose GraphModels before the bridge's 60-second worker termination deadline.
const SESSION_IDLE_MS = 55_000;
let rollRegistered = false;

async function initializeTfjs(): Promise<TfjsWorkerRuntime> {
    const tf = await import('@tensorflow/tfjs');
    // Vite's worker define can expose a partial `process`; TF.js prefers it over
    // WorkerGlobalScope unless its environment points back at this worker.
    tf.env().global = globalThis;
    await import('@tensorflow/tfjs-backend-webgpu');
    if (typeof navigator === 'undefined' || !navigator.gpu) {
        throw new Error('DDSP requires WebGPU');
    }
    if ((await tf.setBackend('webgpu')) !== true) {
        throw new Error('TF.js could not initialize its required WebGPU backend');
    }
    await tf.ready();
    if (!rollRegistered) {
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
        rollRegistered = true;
    }
    const rawTensors = new WeakMap<TfjsWorkerTensor, Tensor>();
    const wrapTensor = (tensor: Tensor): TfjsWorkerTensor => {
        const wrapped = {
            data: async () => {
                const raw = await tensor.data();
                const values = new Float32Array(raw.length);
                for (let index = 0; index < raw.length; index += 1) {
                    values[index] = Number(raw[index]);
                }
                return values;
            },
            dispose: () => tensor.dispose(),
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
            const model = await tf.loadGraphModel(handler as io.IOHandler);
            return {
                dispose: () => model.dispose(),
                predict: (feeds) => {
                    const namedFeeds: NamedTensorMap = {};
                    for (const [name, tensor] of Object.entries(feeds)) {
                        const raw = rawTensors.get(tensor);
                        if (!raw) {
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
    self.postMessage(response, transfer ? { transfer } : undefined);
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
    runtime.dispose();
};
