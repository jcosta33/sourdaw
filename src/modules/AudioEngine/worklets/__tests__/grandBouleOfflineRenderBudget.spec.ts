import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RENDER_TIMEOUT_MULTIPLIER } from '../../useCases/offlineRender/constants';

const HOST_SAMPLE_RATE = 48_000;
const QUANTUM_FRAMES = 128;
const VOICE_COUNT = 64;
const LOWEST_PIANO_NOTE = 21;
const AUDIO_SECONDS = 2;
const MEASUREMENT_TIMEOUT_MS = 120_000;
const WASM_PATH = resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm');

type ProcessorLike = { process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean };
type HarnessPort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
};

const processorRegistry = new Map<string, new (...args: unknown[]) => ProcessorLike>();
let pendingProcessorPort: HarnessPort | null = null;
let harnessFrame = 0;

class AudioWorkletProcessorShim {
    readonly port: HarnessPort;

    constructor() {
        if (!pendingProcessorPort) {
            throw new Error('AudioWorkletProcessorShim constructed outside the harness');
        }
        this.port = pendingProcessorPort;
    }
}

describe('Grand Boule offline render budget', () => {
    let processor: ProcessorLike;
    let port: HarnessPort;

    beforeAll(async () => {
        Object.defineProperty(globalThis, 'currentFrame', { configurable: true, get: () => harnessFrame });
        Object.defineProperty(globalThis, 'sampleRate', { configurable: true, get: () => HOST_SAMPLE_RATE });
        vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
        vi.stubGlobal('registerProcessor', (name: string, ctor: new (...args: unknown[]) => ProcessorLike) => {
            processorRegistry.set(name, ctor);
        });

        await import('../grandBouleOfflineProcessor');
        const Processor = processorRegistry.get('grand-boule-offline-processor');
        if (!Processor) {
            throw new Error('grand-boule-offline-processor was not registered');
        }

        const wasmBytes = readFileSync(WASM_PATH);
        const wasmModule = new WebAssembly.Module(
            wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength)
        );
        const inner: HarnessPort = { onmessage: null, postMessage: vi.fn() };
        pendingProcessorPort = inner;
        try {
            processor = new Processor({ processorOptions: { wasmModule } });
        } finally {
            pendingProcessorPort = null;
        }
        port = inner;
        port.onmessage?.({ data: { type: 'init' } } as MessageEvent);
    });

    it(
        'renders 64 sounding voices inside the export timeout ratio',
        async ({ annotate }) => {
            for (let voice = 0; voice < VOICE_COUNT; voice += 1) {
                port.onmessage?.({
                    data: { type: 'noteOn', midiNote: LOWEST_PIANO_NOTE + voice, velocity: 0.9 },
                } as MessageEvent);
            }

            const quanta = Math.round((AUDIO_SECONDS * HOST_SAMPLE_RATE) / QUANTUM_FRAMES);
            const left = new Float32Array(QUANTUM_FRAMES);
            const right = new Float32Array(QUANTUM_FRAMES);
            processor.process([], [[left, right]]);

            let peak = 0;
            const startedAt = performance.now();
            for (let quantum = 0; quantum < quanta; quantum += 1) {
                harnessFrame = quantum * QUANTUM_FRAMES;
                processor.process([], [[left, right]]);
                for (const sample of left) {
                    peak = Math.max(peak, Math.abs(sample));
                }
            }
            const elapsedSeconds = (performance.now() - startedAt) / 1000;
            const realtimeRatio = elapsedSeconds / AUDIO_SECONDS;
            await annotate(
                `${VOICE_COUNT} voices, ${AUDIO_SECONDS}s audio in ${elapsedSeconds.toFixed(3)}s = ${realtimeRatio.toFixed(3)}x realtime`,
                'notice'
            );

            expect({ producedAudio: peak > 0.001, withinBudget: realtimeRatio < RENDER_TIMEOUT_MULTIPLIER }).toEqual({
                producedAudio: true,
                withinBudget: true,
            });
        },
        MEASUREMENT_TIMEOUT_MS
    );
});
