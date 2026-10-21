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

function stageBank(processor: LevainProcessorLike, loadToken: number, instrumentId: string, constant?: number): void {
    send(processor, { type: 'beginSampleBank', bankKey: `bank-${loadToken}`, instrumentId, loadToken });
    const data = new Float32Array(SAMPLE_FRAMES).map((_, frame) => constant ?? Math.sin(frame * 0.05) * 0.5);
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
        hiKey: constant === undefined ? 127 : 66,
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

async function renderFreshEnsembleAttack(
    note: number,
    ensembleTiming: boolean,
    instrumentId = 'marimba'
): Promise<Float32Array[]> {
    vi.resetModules();
    const { registry } = installWorkletGlobals<LevainProcessorLike>();
    await import('../levainProcessor');
    const Processor = registry.get('levain-processor');
    if (!Processor) {
        throw new TypeError('Expected levain-processor registration');
    }
    const processor = new Processor({ processorOptions: { wasmModule } });
    send(processor, { type: 'init' });

    // The neutral default isolates sample timing; bowed callers include realism.
    loadBank(processor, 1, instrumentId);
    expect(posted(processor)).toContainEqual({ type: 'sampleBankLoaded', loadToken: 1 });
    send(processor, { type: 'param', name: 'humanize', value: 0 });
    send(processor, { type: 'param', name: 'legatoEnabled', value: 0 });
    send(processor, { type: 'param', name: 'ensembleTiming', value: ensembleTiming ? 1 : 0 });
    send(processor, { type: 'noteOn', note, velocity: 100, sampleFrame: 0 });

    const quanta = 12;
    const rendered = makeChannels(2, quanta * FRAMES);
    const output = makeChannels(2, FRAMES);
    for (let quantum = 0; quantum < quanta; quantum++) {
        vi.stubGlobal('currentFrame', quantum * FRAMES);
        expect(processor.process([], [output])).toBe(true);
        rendered[0]!.set(output[0]!, quantum * FRAMES);
        rendered[1]!.set(output[1]!, quantum * FRAMES);
    }
    expect(posted(processor)).not.toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(posted(processor)).not.toContainEqual(expect.objectContaining({ type: 'sampleBankError' }));
    for (const channel of rendered) {
        expect(channel.every(Number.isFinite)).toBe(true);
        expect(channel.some((sample) => Math.abs(sample) > 1e-6)).toBe(true);
    }
    return rendered;
}

async function renderStolenAttack(incomingPcm: number): Promise<Float32Array> {
    vi.resetModules();
    const { registry } = installWorkletGlobals<LevainProcessorLike>();
    await import('../levainProcessor');
    const Processor = registry.get('levain-processor');
    if (!Processor) {
        throw new TypeError('Expected levain-processor registration');
    }
    const processor = new Processor({ processorOptions: { wasmModule } });
    send(processor, { type: 'init' });
    stageBank(processor, 1, 'marimba', 0.25);
    send(processor, {
        type: 'beginSample',
        loadToken: 1,
        sampleId: 1,
        frameCount: SAMPLE_FRAMES,
        channels: 1,
        sampleRate: 48_000,
    });
    send(processor, {
        type: 'sampleChunk',
        loadToken: 1,
        sampleId: 1,
        data: new Float32Array(SAMPLE_FRAMES).fill(incomingPcm),
    });
    send(processor, { type: 'sealSample', loadToken: 1, sampleId: 1 });
    send(processor, {
        type: 'addZone',
        loadToken: 1,
        zoneId: 1,
        sampleId: 1,
        articulationId: 0,
        rootNote: 67,
        loKey: 67,
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
    send(processor, { type: 'buildZoneMap', loadToken: 1, numArticulations: 1, numMics: 1 });
    expect(posted(processor)).toContainEqual({ type: 'sampleBankLoaded', loadToken: 1 });
    send(processor, { type: 'param', name: 'humanize', value: 0 });
    send(processor, { type: 'param', name: 'legatoEnabled', value: 0 });
    send(processor, { type: 'param', name: 'ensembleTiming', value: 1 });
    for (let voice = 0; voice < 64; voice++) {
        send(processor, { type: 'noteOn', note: 60, velocity: 100, sampleFrame: 0 });
    }
    const output = makeChannels(2, FRAMES);
    for (let quantum = 0; quantum < 8; quantum++) {
        vi.stubGlobal('currentFrame', quantum * FRAMES);
        expect(processor.process([], [output])).toBe(true);
    }
    send(processor, { type: 'noteOn', note: 67, velocity: 100, sampleFrame: 8 * FRAMES });
    const rendered = new Float32Array(8 * FRAMES);
    for (let quantum = 0; quantum < 8; quantum++) {
        vi.stubGlobal('currentFrame', (8 + quantum) * FRAMES);
        expect(processor.process([], [output])).toBe(true);
        rendered.set(output[0]!, quantum * FRAMES);
    }
    expect(posted(processor)).not.toContainEqual(expect.objectContaining({ type: 'error' }));
    return rendered;
}

function onsetFrame(samples: Float32Array): number {
    const onset = samples.findIndex((sample) => Math.abs(sample) > 1e-6);
    if (onset < 0) {
        throw new TypeError('Expected a sounding sample attack');
    }
    return onset;
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

    it('delays bowed realism with the fresh sample attack', async () => {
        const off = await renderFreshEnsembleAttack(64, false, 'violin-1');
        const on = await renderFreshEnsembleAttack(64, true, 'violin-1');
        for (let channel = 0; channel < 2; channel++) {
            expect(on[channel]!.subarray(0, 88)).toEqual(new Float32Array(88));
            expect(on[channel]!.subarray(88)).toEqual(off[channel]!.subarray(0, off[channel]!.length - 88));
        }
    });

    it('never emits a cancelled fresh bowed attack after its pending offset', async () => {
        const { registry } = installWorkletGlobals<LevainProcessorLike>();
        await import('../levainProcessor');
        const Processor = registry.get('levain-processor');
        if (!Processor) {
            throw new TypeError('Expected levain-processor registration');
        }
        const processor = new Processor({ processorOptions: { wasmModule } });
        send(processor, { type: 'init' });
        loadBank(processor, 1, 'violin-1');
        send(processor, { type: 'param', name: 'humanize', value: 0 });
        send(processor, { type: 'param', name: 'legatoEnabled', value: 0 });
        send(processor, { type: 'param', name: 'ensembleTiming', value: 1 });
        send(processor, { type: 'noteOn', note: 67, velocity: 100, sampleFrame: 0 });
        send(processor, { type: 'noteOff', note: 67, sampleFrame: 128 });
        const output = makeChannels(2, FRAMES);
        for (let quantum = 0; quantum < 8; quantum++) {
            vi.stubGlobal('currentFrame', quantum * FRAMES);
            expect(processor.process([], [output])).toBe(true);
            for (const channel of output) {
                expect(channel).toEqual(new Float32Array(FRAMES));
            }
        }
        expect(posted(processor)).not.toContainEqual(expect.objectContaining({ type: 'error' }));
    });

    it('keeps a stolen incoming sample silent until its ensemble offset while the old voice fades', async () => {
        const sounding = await renderStolenAttack(0.5);
        const silent = await renderStolenAttack(0);
        expect(sounding.subarray(0, 476)).toEqual(silent.subarray(0, 476));
        const difference = sounding.map((sample, frame) => sample - silent[frame]!);
        expect(difference.subarray(476).some((sample) => Math.abs(sample) > 1e-6)).toBe(true);
        expect(silent.subarray(0, 48).every((sample) => sample > 1e-6)).toBe(true);
    });

    it('spreads compiled sample attacks by pitch and replays the same shifted stereo PCM', async () => {
        const pitches = [48, 55, 60, 64, 67, 72];
        const offsets: number[] = [];
        for (const note of pitches) {
            const off = await renderFreshEnsembleAttack(note, false);
            const on = await renderFreshEnsembleAttack(note, true);
            const replay = await renderFreshEnsembleAttack(note, true);
            const delay = onsetFrame(on[0]!) - onsetFrame(off[0]!);

            expect(delay, `note ${note} must not precede its ensemble-off attack`).toBeGreaterThanOrEqual(0);
            expect(delay, `note ${note} must stay within the 12 ms spread at 48 kHz`).toBeLessThanOrEqual(576);
            for (let channel = 0; channel < 2; channel++) {
                const offChannel = off[channel]!;
                const onChannel = on[channel]!;
                expect(onsetFrame(onChannel) - onsetFrame(offChannel)).toBe(delay);
                expect(onChannel.subarray(delay), `note ${note}, channel ${channel}: only onset may change`).toEqual(
                    offChannel.subarray(0, offChannel.length - delay)
                );
            }
            expect(replay, `note ${note} must replay identically in a fresh processor`).toEqual(on);
            offsets.push(delay);
        }
        expect(new Set(offsets).size, `pitch offsets: ${offsets.join(', ')}`).toBeGreaterThan(3);
        console.info('Shipped Levain ensemble onset offsets (frames):', offsets);
    });
});
