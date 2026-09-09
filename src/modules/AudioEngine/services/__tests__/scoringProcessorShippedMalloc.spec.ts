import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWorkletGlobals, makeChannels } from './wasmViewGrowthHarness';

type ScoringProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const FRAMES = 128;
const MEASURED_QUANTA = 4;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/scoring/scoring_bg.wasm'));
const wasmModule = new WebAssembly.Module(wasmBytes);

function installMallocCounter(): { count: () => number; reset: () => void } {
    const GenuineInstance = WebAssembly.Instance;
    let mallocCalls = 0;
    function CountingInstance(module: WebAssembly.Module, imports?: WebAssembly.Imports): WebAssembly.Instance {
        const actual = new GenuineInstance(module, imports);
        const actualMalloc = actual.exports.__wbindgen_malloc;
        if (typeof actualMalloc !== 'function') {
            throw new TypeError('Expected the shipped Scoring allocator export');
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

function send(processor: ScoringProcessorLike, data: unknown): void {
    processor.port.onmessage?.({ data });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('shipped ScoringProcessor input marshalling', () => {
    it('uses the committed WASM without allocator calls after warmup and preserves distinct channels', async () => {
        const malloc = installMallocCounter();
        const { registry } = installWorkletGlobals<ScoringProcessorLike>();
        await import('../scoringProcessor');
        const Processor = registry.get('scoring-processor');
        if (!Processor) {
            throw new TypeError('Expected scoring-processor registration');
        }
        const processor = new Processor({ processorOptions: { wasmModule } });
        send(processor, { type: 'init' });

        const input = makeChannels(2, FRAMES, (channel, frame) =>
            channel === 0 ? Math.sin(frame * 0.071) * 0.6 : Math.cos(frame * 0.043) * 0.35
        );
        const output = makeChannels(2, FRAMES);
        processor.process([input], [output]);
        malloc.reset();
        for (let quantum = 0; quantum < MEASURED_QUANTA; quantum++) {
            processor.process([input], [output]);
        }

        expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'ready' });
        expect(processor.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        expect(output[0]).toEqual(input[0]);
        expect(output[1]).toEqual(input[1]);
        expect(malloc.count()).toBe(0);
    });

    it('runs the committed Scoring DSP without allocator calls after warmup', async () => {
        const malloc = installMallocCounter();
        const { registry } = installWorkletGlobals<ScoringProcessorLike>();
        await import('../scoringProcessor');
        const Processor = registry.get('scoring-processor');
        if (!Processor) {
            throw new TypeError('Expected scoring-processor registration');
        }
        const processor = new Processor({ processorOptions: { wasmModule } });
        send(processor, { type: 'init' });
        send(processor, { type: 'param', name: 'tone', value: 1 });
        send(processor, { type: 'param', name: 'mute', value: 1 });

        const input = makeChannels(2, FRAMES);
        const output = makeChannels(2, FRAMES);
        for (let quantum = 0; quantum < 8; quantum++) {
            processor.process([input], [output]);
        }
        malloc.reset();
        let outputEnergy = 0;
        for (let quantum = 0; quantum < MEASURED_QUANTA; quantum++) {
            processor.process([input], [output]);
            for (let frame = 0; frame < FRAMES; frame++) {
                outputEnergy += Math.abs(output[0]![frame]!);
            }
        }

        expect(processor.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        expect(outputEnergy).toBeGreaterThan(0.001);
        expect(output[0]).toEqual(output[1]);
        expect(malloc.count()).toBe(0);
    });
});
