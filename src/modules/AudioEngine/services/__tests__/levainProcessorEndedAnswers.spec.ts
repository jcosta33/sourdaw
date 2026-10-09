import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWorkletGlobals, makeChannels } from './wasmViewGrowthHarness';

type LevainProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process: (inputs: unknown[], outputs: unknown[]) => boolean;
};

const FRAMES = 128;
const FAULT_MESSAGE = 'output channel trapped';
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasmModule = new WebAssembly.Module(wasmBytes);

function send(processor: LevainProcessorLike, data: unknown): void {
    processor.port.onmessage?.({ data });
}

function posted(processor: LevainProcessorLike): { type?: string; message?: string }[] {
    return processor.port.postMessage.mock.calls.map(([message]) => message as { type?: string });
}

async function startProcessor(): Promise<LevainProcessorLike> {
    const { registry } = installWorkletGlobals<LevainProcessorLike>();
    await import('../levainProcessor');
    const Processor = registry.get('levain-processor');
    if (!Processor) {
        throw new TypeError('Expected levain-processor registration');
    }
    const processor = new Processor({ processorOptions: { wasmModule } });
    send(processor, { type: 'init' });
    vi.stubGlobal('currentFrame', 0);
    return processor;
}

/** Faults the shipped processor in `process()`: the copy into the output channel throws. */
function faultInProcess(processor: LevainProcessorLike): void {
    const trappingChannel = {
        length: FRAMES,
        set: () => {
            throw new Error(FAULT_MESSAGE);
        },
    };
    processor.process([], [[trappingChannel, makeChannels(1, FRAMES)[0]]]);
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('shipped LevainProcessor after it has faulted', () => {
    it('answers a begin with the fault it posted, and only the begin and release get an answer', async () => {
        const processor = await startProcessor();
        faultInProcess(processor);
        expect(posted(processor)).toContainEqual({ type: 'error', message: FAULT_MESSAGE });
        processor.port.postMessage.mockClear();

        send(processor, { type: 'noteOn', note: 60, velocity: 100 });
        send(processor, { type: 'param', name: 'masterGain', value: 0.5 });
        expect(posted(processor)).toEqual([]);

        send(processor, { type: 'beginSampleBank', bankKey: 'bank-1', instrumentId: 'violin-1', loadToken: 1 });

        expect(posted(processor)).toEqual([{ type: 'error', message: FAULT_MESSAGE }]);
    });

    it('answers a release request with the fault it posted', async () => {
        const processor = await startProcessor();
        faultInProcess(processor);
        processor.port.postMessage.mockClear();

        send(processor, { type: 'releaseRetiredBank', loadToken: 1 });

        expect(posted(processor)).toEqual([{ type: 'error', message: FAULT_MESSAGE }]);
    });

    it('answers every later begin and release the same way', async () => {
        const processor = await startProcessor();
        faultInProcess(processor);
        processor.port.postMessage.mockClear();

        send(processor, { type: 'beginSampleBank', bankKey: 'bank-1', instrumentId: 'violin-1', loadToken: 1 });
        send(processor, { type: 'releaseRetiredBank', loadToken: 1 });
        send(processor, { type: 'beginSampleBank', bankKey: 'bank-2', instrumentId: 'cello', loadToken: 2 });

        expect(posted(processor)).toEqual([
            { type: 'error', message: FAULT_MESSAGE },
            { type: 'error', message: FAULT_MESSAGE },
            { type: 'error', message: FAULT_MESSAGE },
        ]);
    });

    it('answers a begin with an upload decision, not an error, while it is healthy', async () => {
        const processor = await startProcessor();
        processor.port.postMessage.mockClear();

        send(processor, { type: 'beginSampleBank', bankKey: 'bank-1', instrumentId: 'violin-1', loadToken: 1 });

        expect(posted(processor)).toEqual([{ type: 'sampleBankUploadDecision', loadToken: 1, uploadRequired: true }]);
    });
});
