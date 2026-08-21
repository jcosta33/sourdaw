import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Preserved host/transport proof for the withheld Grand Boule implementation.
 * The real distributed `daw-dsp` module is compiled and passed into the real
 * offline processor, while the source-owned constructor seam supplies
 * synthetic transport data. This proves exact module handoff, 64-voice
 * construction, dispatch, and block transfer. It makes no browser-WASM DSP or
 * timing claim; native Rust benches own retained native-only evidence.
 */

const HOST_SAMPLE_RATE = 48_000;
const QUANTUM_FRAMES = 128;
/** Full polyphony: `GrandBouleInstance` is constructed with 64 voices. */
const VOICE_COUNT = 64;
/** Lowest MIDI note of an 88-key piano; 64 voices from here stay in range. */
const LOWEST_PIANO_NOTE = 21;

const WASM_PATH = resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm');

type ProcessorLike = { process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean };
type HarnessPort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
};

const wasmStub = vi.hoisted(() => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const maxBlockFrames = 4096;
    const leftPtr = 0;
    const rightPtr = maxBlockFrames * Float32Array.BYTES_PER_ELEMENT;

    class SyntheticTransportInstance {
        readonly phases = new Map<number, number>();

        constructor(
            readonly instanceSampleRate: number,
            readonly voiceCount: number
        ) {}

        note_on(midiNote: number, _velocity: number): void {
            this.phases.set(midiNote, this.phases.get(midiNote) ?? 0);
        }
        note_on_with_channel(midiNote: number, velocity: number, _channel: number): void {
            this.note_on(midiNote, velocity);
        }
        note_off(midiNote: number): void {
            this.phases.delete(midiNote);
        }
        note_off_on_channel(midiNote: number, _channel: number): void {
            this.phases.delete(midiNote);
        }
        note_expression(): void {}
        set_param(): void {}
        set_sustain(): void {}
        set_una_corda(): void {}
        set_sostenuto(): void {}
        note_on_midi2(): void {}
        set_temperament(): void {}
        load_attack_clip(): void {}
        all_notes_off(): void {
            this.phases.clear();
        }

        process(frames: number): number {
            const left = new Float32Array(memory.buffer, leftPtr, frames);
            const right = new Float32Array(memory.buffer, rightPtr, frames);
            left.fill(0);
            right.fill(0);
            for (const [midiNote, phase] of this.phases) {
                const step = (2 * Math.PI * (440 * 2 ** ((midiNote - 69) / 12))) / this.instanceSampleRate;
                for (let index = 0; index < frames; index++) {
                    const sample = Math.sin(phase + step * index) * 0.3;
                    left[index] = (left[index] ?? 0) + sample;
                    right[index] = (right[index] ?? 0) + sample;
                }
                this.phases.set(midiNote, phase + step * frames);
            }
            return leftPtr;
        }

        get_right_ptr(): number {
            return rightPtr;
        }
    }

    const instances: SyntheticTransportInstance[] = [];
    const initModules: WebAssembly.Module[] = [];
    let expectedModule: WebAssembly.Module | null = null;
    return {
        memory,
        SyntheticTransportInstance,
        instances,
        initModules,
        expectedModule: () => expectedModule,
        setExpectedModule: (module: WebAssembly.Module) => {
            expectedModule = module;
        },
    };
});

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: ({ module }: { module: WebAssembly.Module }) => {
        wasmStub.initModules.push(module);
        if (module !== wasmStub.expectedModule()) {
            throw new Error('Grand Boule transport received a substituted compiled WASM module');
        }
        return { memory: wasmStub.memory };
    },
}));
vi.mock('../grandBouleWasmInstance', () => ({
    createGrandBouleWasmInstance: (sampleRate: number, voiceCount: number) => {
        const instance = new wasmStub.SyntheticTransportInstance(sampleRate, voiceCount);
        wasmStub.instances.push(instance);
        return instance;
    },
}));

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

describe('the retained Grand Boule offline host transport', () => {
    let processor: ProcessorLike;
    let port: HarnessPort;
    let compiledWasmModule: WebAssembly.Module;

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

        // Compile where the real node factory does: outside the processor and
        // once, before constructing the worklet instance.
        const wasmBytes = readFileSync(WASM_PATH);
        compiledWasmModule = new WebAssembly.Module(
            wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength)
        );
        wasmStub.setExpectedModule(compiledWasmModule);
        const inner: HarnessPort = { onmessage: null, postMessage: vi.fn() };
        pendingProcessorPort = inner;
        try {
            processor = new Processor({ processorOptions: { wasmModule: compiledWasmModule } });
        } finally {
            pendingProcessorPort = null;
        }
        port = inner;

        port.onmessage?.({ data: { type: 'init' } } as MessageEvent);
    });

    it('hands off the exact compiled module, dispatches 64 notes, and transfers synthetic audio', () => {
        for (let voice = 0; voice < VOICE_COUNT; voice++) {
            port.onmessage?.({
                data: { type: 'noteOn', midiNote: LOWEST_PIANO_NOTE + voice, velocity: 0.9 },
            } as MessageEvent);
        }

        const left = new Float32Array(QUANTUM_FRAMES);
        const right = new Float32Array(QUANTUM_FRAMES);
        harnessFrame = 0;

        expect(processor.process([], [[left, right]])).toBe(true);
        expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' });
        expect(wasmStub.initModules).toEqual([compiledWasmModule]);
        expect(wasmStub.initModules[0]).toBe(compiledWasmModule);
        expect(wasmStub.instances).toHaveLength(1);
        expect(wasmStub.instances[0]).toMatchObject({
            instanceSampleRate: HOST_SAMPLE_RATE,
            voiceCount: VOICE_COUNT,
        });
        expect(wasmStub.instances[0]?.phases.size).toBe(VOICE_COUNT);
        expect(left.some((sample) => Math.abs(sample) > 0.001)).toBe(true);
        expect(right).toEqual(left);
    });

    it('rejects a substituted compiled module at the retained construction boundary', async () => {
        const substitutedModule = new WebAssembly.Module(
            Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
        );
        const { createGrandBouleInstance } = await import('../grandBouleEngineCore');

        expect(() => createGrandBouleInstance({ wasmModule: substitutedModule, sampleRate: HOST_SAMPLE_RATE })).toThrow(
            'Grand Boule transport received a substituted compiled WASM module'
        );
        expect(wasmStub.initModules.at(-1)).toBe(substitutedModule);
    });
});
