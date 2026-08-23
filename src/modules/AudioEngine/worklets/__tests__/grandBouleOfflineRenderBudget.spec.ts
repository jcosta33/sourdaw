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
type ProcessorConstructor = new (...args: unknown[]) => ProcessorLike;
type HarnessPort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
};

const processorRegistry = new Map<string, new (...args: unknown[]) => ProcessorLike>();
let pendingProcessorPort: HarnessPort | null = null;
let harnessFrame = 0;
let Processor: ProcessorConstructor;
let wasmModule: WebAssembly.Module;

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
    beforeAll(async () => {
        Object.defineProperty(globalThis, 'currentFrame', { configurable: true, get: () => harnessFrame });
        Object.defineProperty(globalThis, 'sampleRate', { configurable: true, get: () => HOST_SAMPLE_RATE });
        vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
        vi.stubGlobal('registerProcessor', (name: string, ctor: new (...args: unknown[]) => ProcessorLike) => {
            processorRegistry.set(name, ctor);
        });

        await import('../grandBouleOfflineProcessor');
        const registeredProcessor = processorRegistry.get('grand-boule-offline-processor');
        if (!registeredProcessor) {
            throw new Error('grand-boule-offline-processor was not registered');
        }
        Processor = registeredProcessor;

        const wasmBytes = readFileSync(WASM_PATH);
        wasmModule = new WebAssembly.Module(
            wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength)
        );
    });

    function renderVoiceCount(voiceCount: number): {
        elapsedSeconds: number;
        energy: number;
        fingerprint: number;
        peak: number;
        realtimeRatio: number;
    } {
        harnessFrame = 0;
        const inner: HarnessPort = { onmessage: null, postMessage: vi.fn() };
        pendingProcessorPort = inner;
        let processor: ProcessorLike;
        try {
            processor = new Processor({ processorOptions: { wasmModule } });
        } finally {
            pendingProcessorPort = null;
        }
        inner.onmessage?.({ data: { type: 'init' } } as MessageEvent);

        for (let voice = 0; voice < voiceCount; voice += 1) {
            inner.onmessage?.({
                data: { type: 'noteOn', midiNote: LOWEST_PIANO_NOTE + voice, velocity: 0.9 },
            } as MessageEvent);
        }

        const quanta = Math.round((AUDIO_SECONDS * HOST_SAMPLE_RATE) / QUANTUM_FRAMES);
        const left = new Float32Array(QUANTUM_FRAMES);
        const right = new Float32Array(QUANTUM_FRAMES);
        processor.process([], [[left, right]]);

        let energy = 0;
        let fingerprint = 2_166_136_261;
        let peak = 0;
        const startedAt = performance.now();
        for (let quantum = 0; quantum < quanta; quantum += 1) {
            harnessFrame = quantum * QUANTUM_FRAMES;
            processor.process([], [[left, right]]);
            for (const sample of left) {
                peak = Math.max(peak, Math.abs(sample));
                energy += sample * sample;
                fingerprint = Math.imul(fingerprint ^ Math.round(sample * 1_000_000), 16_777_619) >>> 0;
            }
        }
        const elapsedSeconds = (performance.now() - startedAt) / 1000;
        return { elapsedSeconds, energy, fingerprint, peak, realtimeRatio: elapsedSeconds / AUDIO_SECONDS };
    }

    it(
        'renders 64 sounding voices with more work and energy than the one-voice control inside the export timeout ratio',
        async ({ annotate }) => {
            const oneVoice = renderVoiceCount(1);
            const sixtyFourVoices = renderVoiceCount(VOICE_COUNT);
            await annotate(
                `1 voice in ${oneVoice.elapsedSeconds.toFixed(3)}s; ${VOICE_COUNT} voices in ${sixtyFourVoices.elapsedSeconds.toFixed(3)}s = ${sixtyFourVoices.realtimeRatio.toFixed(3)}x realtime`,
                'notice'
            );

            expect(oneVoice.peak).toBeGreaterThan(0.001);
            expect(sixtyFourVoices.peak).toBeGreaterThan(0.001);
            expect(sixtyFourVoices.energy).toBeGreaterThan(oneVoice.energy * 1.25);
            expect(sixtyFourVoices.fingerprint).not.toBe(oneVoice.fingerprint);
            expect(sixtyFourVoices.elapsedSeconds).toBeGreaterThan(oneVoice.elapsedSeconds);
            expect(sixtyFourVoices.realtimeRatio).toBeLessThan(RENDER_TIMEOUT_MULTIPLIER);
        },
        MEASUREMENT_TIMEOUT_MS
    );
});
