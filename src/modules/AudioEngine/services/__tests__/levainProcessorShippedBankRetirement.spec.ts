import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWorkletGlobals, makeChannels } from './wasmViewGrowthHarness';

type LevainProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process: (inputs: unknown[], outputs: unknown[]) => boolean;
    // The processor's engine, read to observe the shipped retired slot.
    _instance: { has_retired_bank: () => boolean } | null;
};

const FRAMES = 128;
const SAMPLE_FRAMES = 4_800;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasmModule = new WebAssembly.Module(wasmBytes);

function send(processor: LevainProcessorLike, data: unknown): void {
    processor.port.onmessage?.({ data });
}

function posted(processor: LevainProcessorLike): { type?: string; loadToken?: number; done?: boolean }[] {
    return processor.port.postMessage.mock.calls.map(([message]) => message as { type?: string });
}

function stageBank(processor: LevainProcessorLike, loadToken: number, instrumentId: string): void {
    send(processor, { type: 'beginSampleBank', bankKey: `bank-${loadToken}`, instrumentId, loadToken });
    const data = new Float32Array(SAMPLE_FRAMES).map((_, frame) => Math.sin(frame * 0.05) * 0.5);
    send(processor, {
        type: 'beginSample',
        loadToken,
        sampleId: 0,
        frameCount: SAMPLE_FRAMES,
        channels: 1,
        sampleRate: 48_000,
    });
    send(processor, { type: 'sampleChunk', loadToken, sampleId: 0, data });
    send(processor, { type: 'sealSample', loadToken, sampleId: 0 });
    send(processor, {
        type: 'addZone',
        loadToken,
        zoneId: 0,
        sampleId: 0,
        articulationId: 0,
        rootNote: 60,
        loKey: 0,
        hiKey: 127,
        loVel: 0,
        hiVel: 127,
        rrPos: 0,
        rrLen: 1,
        micId: 0,
        loopMode: 'forward',
        loopStart: 0,
        loopEnd: SAMPLE_FRAMES,
        loopCrossfade: 0,
        gainDb: 0,
        attack: 0.005,
        decay: 0.1,
        sustain: 1,
        release: 0.3,
    });
    send(processor, {
        type: 'addLegatoTransition',
        loadToken,
        sampleId: 0,
        interval: 2,
        transitionType: 'slurred',
        dynamic: 'mf',
        crossfadeOutMs: 20,
    });
}

function loadBank(processor: LevainProcessorLike, loadToken: number, instrumentId: string): void {
    stageBank(processor, loadToken, instrumentId);
    send(processor, { type: 'buildZoneMap', loadToken, numArticulations: 1, numMics: 1 });
}

function hasRetiredBank(processor: LevainProcessorLike): boolean {
    if (!processor._instance) {
        throw new TypeError('Expected an initialised engine');
    }
    return processor._instance.has_retired_bank();
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('shipped LevainProcessor bank retirement', () => {
    it('commits a replacement bank, frees the displaced one by message, and still sounds', async () => {
        const { registry } = installWorkletGlobals<LevainProcessorLike>();
        await import('../levainProcessor');
        const Processor = registry.get('levain-processor');
        if (!Processor) {
            throw new TypeError('Expected levain-processor registration');
        }
        const processor = new Processor({ processorOptions: { wasmModule } });
        send(processor, { type: 'init' });
        vi.stubGlobal('currentFrame', 0);

        loadBank(processor, 1, 'violin-1');
        loadBank(processor, 2, 'cello');
        expect(posted(processor)).toContainEqual({ type: 'sampleBankLoaded', loadToken: 2 });

        send(processor, { type: 'releaseRetiredBank', loadToken: 2 });

        expect(posted(processor)).not.toContainEqual(expect.objectContaining({ type: 'error' }));
        expect(posted(processor)).toContainEqual({ type: 'retiredBankReleased', loadToken: 2, done: true });

        send(processor, { type: 'noteOn', note: 60, velocity: 100 });
        const output = makeChannels(2, FRAMES);
        for (let quantum = 0; quantum < 4; quantum++) {
            processor.process([], [output]);
        }
        const peak = output[0]!.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
        expect(peak).toBeGreaterThan(1e-6);
    });

    it('retires an aborted staged bank, frees it by message, and keeps the sounding bank', async () => {
        const { registry } = installWorkletGlobals<LevainProcessorLike>();
        await import('../levainProcessor');
        const Processor = registry.get('levain-processor');
        if (!Processor) {
            throw new TypeError('Expected levain-processor registration');
        }
        const processor = new Processor({ processorOptions: { wasmModule } });
        send(processor, { type: 'init' });
        vi.stubGlobal('currentFrame', 0);

        loadBank(processor, 1, 'violin-1');
        send(processor, { type: 'releaseRetiredBank', loadToken: 1 });
        expect(hasRetiredBank(processor)).toBe(false);

        stageBank(processor, 2, 'cello');
        send(processor, { type: 'abortSampleBank', loadToken: 2 });

        expect(hasRetiredBank(processor)).toBe(true);
        send(processor, { type: 'releaseRetiredBank', loadToken: 2 });
        expect(posted(processor)).not.toContainEqual(expect.objectContaining({ type: 'error' }));
        expect(posted(processor)).toContainEqual({ type: 'retiredBankReleased', loadToken: 2, done: true });
        expect(hasRetiredBank(processor)).toBe(false);

        send(processor, { type: 'noteOn', note: 60, velocity: 100 });
        const output = makeChannels(2, FRAMES);
        for (let quantum = 0; quantum < 4; quantum++) {
            processor.process([], [output]);
        }
        const peak = output[0]!.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
        expect(peak).toBeGreaterThan(1e-6);
    });
});
