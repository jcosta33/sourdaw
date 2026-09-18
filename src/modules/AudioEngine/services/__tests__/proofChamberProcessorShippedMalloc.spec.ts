import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWorkletGlobals, makeChannels } from './wasmViewGrowthHarness';

type ProofChamberProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const FRAMES = 128;
const MEASURED_QUANTA = 4;
const WARMUP_QUANTA = 192;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/proof-chamber/proof_chamber_bg.wasm'));
const wasmModule = new WebAssembly.Module(wasmBytes);

function installMallocCounter(): { count: () => number; reset: () => void } {
    const GenuineInstance = WebAssembly.Instance;
    let mallocCalls = 0;
    function CountingInstance(module: WebAssembly.Module, imports?: WebAssembly.Imports): WebAssembly.Instance {
        const actual = new GenuineInstance(module, imports);
        const actualMalloc = actual.exports.__wbindgen_malloc;
        if (typeof actualMalloc !== 'function') {
            throw new TypeError('Expected the shipped ProofChamber allocator export');
        }
        return {
            exports: {
                ...actual.exports,
                __wbindgen_malloc(size: number, alignment: number): number {
                    mallocCalls++;
                    return actualMalloc(size, alignment);
                },
            },
        };
    }
    const instrumentedWebAssembly = new Proxy(WebAssembly, {
        get(target, property, receiver) {
            return property === 'Instance' ? CountingInstance : Reflect.get(target, property, receiver);
        },
    });
    vi.stubGlobal('WebAssembly', instrumentedWebAssembly);
    return {
        count: () => mallocCalls,
        reset: () => {
            mallocCalls = 0;
        },
    };
}

function send(processor: ProofChamberProcessorLike, data: unknown): void {
    processor.port.onmessage?.({ data });
}

function seedInput(input: Float32Array[], quantum: number): void {
    for (let frame = 0; frame < FRAMES; frame++) {
        const absoluteFrame = quantum * FRAMES + frame;
        input[0]![frame] = Math.sin(absoluteFrame * 0.031) * 0.55;
        input[1]![frame] = Math.cos(absoluteFrame * 0.047) * 0.35;
    }
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('shipped ProofChamberProcessor input marshalling', () => {
    it.each([
        ['plate', 0],
        ['fdn-8', 1],
        ['fdn-16', 2],
        ['spring', 3],
        ['reverse', 6],
    ] as const)('uses the committed WASM without allocator calls for %s after warmup', async (_name, algorithm) => {
        const malloc = installMallocCounter();
        const { registry } = installWorkletGlobals<ProofChamberProcessorLike>();
        await import('../proofChamberProcessor');
        const Processor = registry.get('proof-chamber-processor');
        if (!Processor) {
            throw new TypeError('Expected proof-chamber-processor registration');
        }
        const processor = new Processor({ processorOptions: { wasmModule } });
        send(processor, { type: 'init' });
        send(processor, { type: 'param', name: 'algorithm', value: algorithm });
        send(processor, { type: 'param', name: 'mix', value: 1 });
        send(processor, { type: 'param', name: 'decay', value: 0.7 });
        send(processor, { type: 'param', name: 'size', value: 0 });

        const input = makeChannels(2, FRAMES);
        const output = makeChannels(2, FRAMES);
        for (let quantum = 0; quantum < WARMUP_QUANTA; quantum++) {
            seedInput(input, quantum);
            processor.process([input], [output]);
        }
        malloc.reset();
        let outputEnergy = 0;
        let inputDifference = 0;
        for (let quantum = 0; quantum < MEASURED_QUANTA; quantum++) {
            seedInput(input, WARMUP_QUANTA + quantum);
            processor.process([input], [output]);
            for (let frame = 0; frame < FRAMES; frame++) {
                outputEnergy += Math.abs(output[0]![frame]!) + Math.abs(output[1]![frame]!);
                inputDifference +=
                    Math.abs(output[0]![frame]! - input[0]![frame]!) + Math.abs(output[1]![frame]! - input[1]![frame]!);
            }
        }

        expect(processor.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }));
        expect(processor.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        expect(outputEnergy).toBeGreaterThan(0.001);
        expect(inputDifference).toBeGreaterThan(0.001);
        expect(malloc.count()).toBe(0);
    });
});
