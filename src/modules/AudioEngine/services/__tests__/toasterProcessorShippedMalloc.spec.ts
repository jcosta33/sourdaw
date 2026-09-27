import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TOASTER_PAD_PARAM_IDS } from '../../models/ToasterPadParamIds';

import { installWorkletGlobals, makeChannels } from './wasmViewGrowthHarness';

type ToasterProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process: (inputs: unknown[], outputs: unknown[]) => boolean;
};

const FRAMES = 128;
const WARMUP_QUANTA = 64;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasmModule = new WebAssembly.Module(wasmBytes);

function installMallocCounter(): { count: () => number; reset: () => void } {
    const GenuineInstance = WebAssembly.Instance;
    let mallocCalls = 0;
    function CountingInstance(module: WebAssembly.Module, imports?: WebAssembly.Imports): WebAssembly.Instance {
        const actual = new GenuineInstance(module, imports);
        const actualMalloc = actual.exports.__wbindgen_malloc;
        if (typeof actualMalloc !== 'function') {
            throw new TypeError('Expected the shipped daw-dsp allocator export');
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

function send(processor: ToasterProcessorLike, data: unknown): void {
    processor.port.onmessage?.({ data });
}

/** The id a `scheduledHit` lock carries for a pad parameter name, or a loud failure. */
function padParamId(name: string): number {
    const id = TOASTER_PAD_PARAM_IDS[name];
    if (id === undefined) {
        throw new TypeError(`TOASTER_PAD_PARAM_IDS is missing ${name}`);
    }
    return id;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('shipped ToasterProcessor parameter-locked hits', () => {
    // The message contract carries numeric TOASTER_PAD_PARAM_IDS entries: the
    // producer translates names on the main thread so the worklet never
    // marshals a string inside process() (#4633). Locks stage into the
    // engine's per-hit overlay through `set_pad_param_lock_by_id` — sound
    // locks included, with no post-hit restore write (#4636) — so draining any
    // of these hits must stay free of allocator calls.
    it.each([
        ['an unlocked hit', []],
        ['a parameter-locked hit', [{ id: padParamId('tune'), value: 7 }]],
        ['a sound-locked hit', [{ id: padParamId('engineType'), value: 2 }]],
    ] as const)('plays %s without allocator calls on the render thread', async (_name, padParams) => {
        const malloc = installMallocCounter();
        const { registry } = installWorkletGlobals<ToasterProcessorLike>();
        await import('../toasterProcessor');
        const Processor = registry.get('toaster-processor');
        if (!Processor) {
            throw new TypeError('Expected toaster-processor registration');
        }
        const processor = new Processor({ processorOptions: { wasmModule } });
        send(processor, { type: 'init' });

        const output = makeChannels(2, FRAMES);
        vi.stubGlobal('currentFrame', 0);
        for (let quantum = 0; quantum < WARMUP_QUANTA; quantum++) {
            processor.process([], [output]);
        }

        const hitFrame = WARMUP_QUANTA * FRAMES + 64;
        send(processor, {
            type: 'scheduledHit',
            pad: 0,
            velocity: 100,
            note: 60,
            sampleFrame: hitFrame,
            padParams,
        });
        malloc.reset();
        vi.stubGlobal('currentFrame', WARMUP_QUANTA * FRAMES);
        processor.process([], [output]);

        expect(processor.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        expect(malloc.count()).toBe(0);
    });
});
