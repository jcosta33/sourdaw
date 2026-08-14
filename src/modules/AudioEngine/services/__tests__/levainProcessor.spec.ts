import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    RealFloat32Array,
    installWorkletGlobals,
    makeChannels,
    type GrowableMemory,
    createGrowableMemory,
    resetGrowableMemory,
} from './wasmViewGrowthHarness';

// LevainProcessor message handling, pending-message buffering, sampler dispatch,
// loop-mode mapping, queue and process guards. The existing levainProcessorWasmViews
// spec covers only the RT-1/RT-7 WASM-view growth; this spec drives the state machine.

type LevainProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<LevainProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const FRAMES = 128;
const memory: GrowableMemory = createGrowableMemory(HEAP_BYTES);

const calls: Array<{ method: string; args: unknown[] }> = [];
let processShouldThrow = false;
let addSampleShouldThrow = false;
let abortSampleBankShouldThrow = false;
let allNotesOffShouldThrow = false;
let setParamShouldThrow = false;
let zoneMapShouldBuild = true;
const sharedBanks = new Set<string>();

class LevainInstanceMock {
    note_on(note: number, velocity: number): void {
        calls.push({ method: 'note_on', args: [note, velocity] });
    }
    note_on_with_channel(note: number, velocity: number, _channel: number): void {
        calls.push({ method: 'note_on', args: [note, velocity] });
    }
    note_on_with_channel_and_articulation(
        note: number,
        velocity: number,
        channel: number,
        articulationId: number
    ): void {
        calls.push({
            method: 'note_on_with_channel_and_articulation',
            args: [note, velocity, channel, articulationId],
        });
    }
    note_off(note: number): void {
        calls.push({ method: 'note_off', args: [note] });
    }
    all_notes_off(): void {
        calls.push({ method: 'all_notes_off', args: [] });
        if (allNotesOffShouldThrow) {
            throw new Error('all notes off trapped');
        }
    }
    set_param(name: string, value: number): void {
        if (setParamShouldThrow) {
            throw new Error('parameter trap');
        }
        calls.push({ method: 'set_param', args: [name, value] });
    }
    handle_cc(cc: number, value: number): void {
        calls.push({ method: 'handle_cc', args: [cc, value] });
    }
    add_sample(data: Float32Array, frameCount: number, channels: number, sampleRate: number): number {
        if (addSampleShouldThrow) {
            // Sample loading is the likeliest place for this device to fail
            // after startup: the copy into linear memory is hundreds of MiB for
            // a single instrument, with no dedup between instances.
            throw new Error('memory allocation failed');
        }
        calls.push({ method: 'add_sample', args: [Array.from(data), frameCount, channels, sampleRate] });
        return calls.filter((call) => call.method === 'add_sample').length - 1;
    }
    add_zone(...args: unknown[]): void {
        calls.push({ method: 'add_zone', args });
    }
    add_legato_transition(...args: unknown[]): void {
        calls.push({ method: 'add_legato_transition', args });
    }
    build_zone_map(numArticulations: number, numMics: number): boolean {
        calls.push({ method: 'build_zone_map', args: [numArticulations, numMics] });
        return zoneMapShouldBuild;
    }
    begin_sample_bank(instrumentId: string): void {
        calls.push({ method: 'begin_sample_bank', args: [instrumentId] });
    }
    attach_sample_bank(bankKey: string): boolean {
        calls.push({ method: 'attach_sample_bank', args: [bankKey] });
        return sharedBanks.has(bankKey);
    }
    publish_sample_bank(bankKey: string): boolean {
        calls.push({ method: 'publish_sample_bank', args: [bankKey] });
        sharedBanks.add(bankKey);
        return true;
    }
    abort_sample_bank(): void {
        calls.push({ method: 'abort_sample_bank', args: [] });
        if (abortSampleBankShouldThrow) {
            throw new Error('abort trapped');
        }
    }
    commit_sample_bank(): boolean {
        calls.push({ method: 'commit_sample_bank', args: [] });
        return true;
    }
    sample_bank_bytes(): number {
        return 16;
    }
    process(frames: number): number {
        if (processShouldThrow) {
            throw new Error('wasm trap');
        }
        const left = new RealFloat32Array(memory.buffer, OUT_LEFT_PTR, frames);
        const right = new RealFloat32Array(memory.buffer, OUT_RIGHT_PTR, frames);
        for (let i = 0; i < frames; i++) {
            left[i] = 0.1;
            right[i] = 0.2;
        }
        return OUT_LEFT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    LevainInstance: LevainInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<LevainProcessorLike> {
    await import('../levainProcessor');
    const Ctor = registry.get('levain-processor');
    if (!Ctor) {
        throw new Error('levain-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: LevainProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function method(name: string): { method: string; args: unknown[] } | undefined {
    return [...calls].reverse().find((c) => c.method === name);
}

describe('LevainProcessor message handling', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        resetGrowableMemory(memory, HEAP_BYTES);
        calls.length = 0;
        processShouldThrow = false;
        addSampleShouldThrow = false;
        abortSampleBankShouldThrow = false;
        allNotesOffShouldThrow = false;
        setParamShouldThrow = false;
        zoneMapShouldBuild = true;
        sharedBanks.clear();
    });

    it('buffers messages that arrive before init and replays them once ready', async () => {
        const proc = await loadProcessor();
        // Sent before init → buffered in _pendingMessages.
        send(proc, { type: 'noteOn', note: 60, velocity: 90 });
        send(proc, { type: 'cc', cc: 1, value: 64 });
        expect(calls).toEqual([]);

        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        // Buffered messages replayed in order during _initWasm.
        expect(calls.map((c) => c.method)).toEqual(['note_on', 'handle_cc']);
        expect(proc.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }));
    });

    it('ignores a second init once ready', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const ready = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type: string }).type === 'ready');
        expect(ready).toHaveLength(1);
    });

    it('reports an init error when WASM instantiation throws', async () => {
        const { initSync } = await import('../../wasm/daw_dsp.js');
        vi.mocked(initSync).mockImplementationOnce(() => {
            throw new Error('WASM instantiation failed');
        });
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
    });

    it('dispatches immediate noteOn/noteOff and allNotesOff to the instance', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;

        send(proc, { type: 'noteOn', note: 64, velocity: 80 });
        send(proc, { type: 'noteOff', note: 64 });
        send(proc, { type: 'allNotesOff' });

        expect(calls.map((c) => c.method)).toEqual(['note_on', 'note_off', 'all_notes_off']);
        expect(method('note_on')!.args).toEqual([64, 80]);
    });

    it('allocates an articulated note with the immutable note articulation', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;

        send(proc, { type: 'noteOn', note: 62, velocity: 96, channel: 4, articulationId: 8 });

        expect(method('note_on_with_channel_and_articulation')!.args).toEqual([62, 96, 4, 8]);
        expect(method('note_on')).toBeUndefined();
    });

    it('maps known params through PARAM_MAP and falls back to the raw name', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;

        send(proc, { type: 'param', name: 'masterGain', value: 0.8 });
        send(proc, { type: 'param', name: 'unknownX', value: 0.3 });

        const setParams = calls.filter((c) => c.method === 'set_param');
        expect(setParams).toContainEqual({ method: 'set_param', args: ['master_gain', 0.8] });
        expect(setParams).toContainEqual({ method: 'set_param', args: ['unknownX', 0.3] });
    });

    it('forwards cc and bypass messages', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;

        send(proc, { type: 'cc', cc: 74, value: 100 });
        send(proc, { type: 'bypass', bypassed: true });

        expect(method('handle_cc')!.args).toEqual([74, 100]);
        // bypass does not call the instance; it flips the _bypassed flag (tested below).
    });

    it('suppresses process() output while bypassed', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init' });
        send(proc, { type: 'bypass', bypassed: true });
        calls.length = 0;

        const output = makeChannels(2, FRAMES);
        proc.process([], [output]);

        // No instance.process call while bypassed.
        expect(calls.find((c) => c.method === 'process')).toBeUndefined();
    });

    it('loads a sample and forwards addSample args to the instance', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;

        send(proc, { type: 'beginSampleBank', bankKey: 'single-bank', instrumentId: 'violin', loadToken: 1 });
        const data = new Float32Array([0.1, 0.2, 0.3, 0.4]);
        send(proc, {
            type: 'addSample',
            loadToken: 1,
            sampleId: 0,
            data,
            frameCount: 4,
            channels: 1,
            sampleRate: 48000,
        });

        const args = method('add_sample')!.args;
        expect(args[1]).toBe(4);
        expect(args[2]).toBe(1);
        expect(args[3]).toBe(48000);
        // Float32 storage rounds the sample values; compare with tolerance.
        const passed = args[0] as number[];
        expect(passed.map((v) => Number(v.toFixed(6)))).toEqual([0.1, 0.2, 0.3, 0.4]);
    });

    it('reuses one compiled WASM module and uploads one PCM bank for two Levain processors', async () => {
        const owner = await loadProcessor();
        const follower = await loadProcessor();
        send(owner, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(follower, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        const wasmModule = await import('../../wasm/daw_dsp.js');
        expect(wasmModule.initSync).toHaveBeenCalledTimes(2);
        calls.length = 0;

        send(owner, { type: 'beginSampleBank', bankKey: 'shared-bank', instrumentId: 'violin', loadToken: 1 });
        send(follower, { type: 'beginSampleBank', bankKey: 'shared-bank', instrumentId: 'violin', loadToken: 2 });
        expect(owner.port.postMessage).toHaveBeenCalledWith({
            type: 'sampleBankUploadDecision',
            loadToken: 1,
            uploadRequired: true,
        });
        expect(follower.port.postMessage).toHaveBeenCalledWith({
            type: 'sampleBankUploadDecision',
            loadToken: 2,
            uploadRequired: false,
        });
        const sample = {
            type: 'addSample',
            sampleId: 0,
            data: new Float32Array([0.1]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        };
        send(owner, { ...sample, loadToken: 1 });
        send(follower, { ...sample, loadToken: 2 });
        send(follower, { type: 'buildZoneMap', loadToken: 2, numArticulations: 1, numMics: 1 });
        send(owner, { type: 'buildZoneMap', loadToken: 1, numArticulations: 1, numMics: 1 });

        expect(calls.filter((call) => call.method === 'add_sample')).toHaveLength(1);
        expect(calls.filter((call) => call.method === 'publish_sample_bank')).toHaveLength(1);
        expect(calls.filter((call) => call.method === 'build_zone_map')).toHaveLength(2);
        expect(calls.filter((call) => call.method === 'attach_sample_bank')).toHaveLength(2);
        expect(owner.port.postMessage).toHaveBeenCalledWith({ type: 'sampleBankLoaded', loadToken: 1 });
        expect(follower.port.postMessage).toHaveBeenCalledWith({ type: 'sampleBankLoaded', loadToken: 2 });
    });

    it('attaches a later processor to a published PCM bank without another upload', async () => {
        const owner = await loadProcessor();
        send(owner, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(owner, { type: 'beginSampleBank', bankKey: 'cached-bank', instrumentId: 'violin', loadToken: 1 });
        send(owner, {
            type: 'addSample',
            loadToken: 1,
            sampleId: 0,
            data: new Float32Array([0.1]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });
        send(owner, { type: 'buildZoneMap', loadToken: 1, numArticulations: 1, numMics: 1 });

        const cached = await loadProcessor();
        send(cached, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;
        send(cached, { type: 'beginSampleBank', bankKey: 'cached-bank', instrumentId: 'violin', loadToken: 2 });
        expect(cached.port.postMessage).toHaveBeenCalledWith({
            type: 'sampleBankUploadDecision',
            loadToken: 2,
            uploadRequired: false,
        });
        send(cached, {
            type: 'addSample',
            loadToken: 2,
            sampleId: 0,
            data: new Float32Array([0.1]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });
        send(cached, { type: 'buildZoneMap', loadToken: 2, numArticulations: 1, numMics: 1 });

        expect(calls.filter((call) => call.method === 'attach_sample_bank')).toHaveLength(1);
        expect(calls.filter((call) => call.method === 'add_sample')).toHaveLength(0);
        expect(calls.filter((call) => call.method === 'publish_sample_bank')).toHaveLength(0);
        expect(calls.filter((call) => call.method === 'build_zone_map')).toHaveLength(1);
        expect(cached.port.postMessage).toHaveBeenCalledWith({ type: 'sampleBankLoaded', loadToken: 2 });
    });

    it('rejects owner and follower loads when an upload fails and permits a clean same-key retry', async () => {
        const owner = await loadProcessor();
        const follower = await loadProcessor();
        send(owner, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(follower, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(owner, { type: 'beginSampleBank', bankKey: 'retry-bank', instrumentId: 'violin', loadToken: 1 });
        send(follower, { type: 'beginSampleBank', bankKey: 'retry-bank', instrumentId: 'violin', loadToken: 2 });
        addSampleShouldThrow = true;

        send(owner, {
            type: 'addSample',
            loadToken: 1,
            sampleId: 0,
            data: new Float32Array([0.1]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });

        expect(owner.port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'sampleBankError', message: 'memory allocation failed' })
        );
        expect(follower.port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'sampleBankError', message: 'memory allocation failed' })
        );

        addSampleShouldThrow = false;
        calls.length = 0;
        send(follower, { type: 'beginSampleBank', bankKey: 'retry-bank', instrumentId: 'violin', loadToken: 3 });
        send(follower, {
            type: 'addSample',
            loadToken: 3,
            sampleId: 0,
            data: new Float32Array([0.2]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });
        send(follower, { type: 'buildZoneMap', loadToken: 3, numArticulations: 1, numMics: 1 });

        expect(calls.filter((call) => call.method === 'add_sample')).toHaveLength(1);
        expect(calls.filter((call) => call.method === 'publish_sample_bank')).toHaveLength(1);
    });

    it('ignores stale tail messages after a rejected load and accepts a fresh attempt', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'beginSampleBank', bankKey: 'stale-tail-bank', instrumentId: 'violin', loadToken: 1 });
        addSampleShouldThrow = true;
        send(proc, {
            type: 'addSample',
            loadToken: 1,
            sampleId: 0,
            data: new Float32Array([0.1]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });

        addSampleShouldThrow = false;
        calls.length = 0;
        send(proc, {
            type: 'addSample',
            loadToken: 1,
            sampleId: 1,
            data: new Float32Array([0.2]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });
        send(proc, {
            type: 'addZone',
            loadToken: 1,
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
            loopStart: 0,
            loopEnd: 1,
            loopCrossfade: 0,
            gainDb: 0,
            attack: 0,
            decay: 0,
            sustain: 1,
            release: 0.1,
        });
        send(proc, { type: 'buildZoneMap', loadToken: 1, numArticulations: 1, numMics: 1 });

        expect(calls.filter((call) => call.method === 'add_sample')).toHaveLength(0);
        expect(calls.filter((call) => call.method === 'add_zone')).toHaveLength(0);
        expect(calls.filter((call) => call.method === 'build_zone_map')).toHaveLength(0);

        send(proc, { type: 'beginSampleBank', bankKey: 'stale-tail-bank', instrumentId: 'violin', loadToken: 2 });
        send(proc, {
            type: 'addSample',
            loadToken: 2,
            sampleId: 0,
            data: new Float32Array([0.3]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });
        send(proc, { type: 'buildZoneMap', loadToken: 2, numArticulations: 1, numMics: 1 });

        expect(calls.filter((call) => call.method === 'add_sample')).toHaveLength(1);
        expect(calls.filter((call) => call.method === 'publish_sample_bank')).toHaveLength(1);
    });

    it('releases followers and permits retry when an owner faults during process', async () => {
        const owner = await loadProcessor();
        const follower = await loadProcessor();
        send(owner, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(follower, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(owner, {
            type: 'beginSampleBank',
            bankKey: 'process-fault-bank',
            instrumentId: 'violin',
            loadToken: 1,
        });
        send(follower, {
            type: 'beginSampleBank',
            bankKey: 'process-fault-bank',
            instrumentId: 'violin',
            loadToken: 2,
        });
        processShouldThrow = true;
        abortSampleBankShouldThrow = true;

        owner.process([], [makeChannels(2, FRAMES)]);

        expect(owner.port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', message: 'wasm trap' })
        );
        expect(follower.port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'sampleBankError', message: 'wasm trap' })
        );

        processShouldThrow = false;
        abortSampleBankShouldThrow = false;
        calls.length = 0;
        const retry = await loadProcessor();
        send(retry, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(retry, {
            type: 'beginSampleBank',
            bankKey: 'process-fault-bank',
            instrumentId: 'violin',
            loadToken: 3,
        });
        send(retry, {
            type: 'addSample',
            loadToken: 3,
            sampleId: 0,
            data: new Float32Array([0.2]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });
        send(retry, { type: 'buildZoneMap', loadToken: 3, numArticulations: 1, numMics: 1 });

        expect(calls.filter((call) => call.method === 'add_sample')).toHaveLength(1);
        expect(calls.filter((call) => call.method === 'publish_sample_bank')).toHaveLength(1);
    });

    it('acknowledges disposal, releases followers, and stops rendering', async () => {
        const owner = await loadProcessor();
        const follower = await loadProcessor();
        send(owner, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(follower, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(owner, { type: 'beginSampleBank', bankKey: 'disposed-bank', instrumentId: 'violin', loadToken: 1 });
        send(follower, { type: 'beginSampleBank', bankKey: 'disposed-bank', instrumentId: 'violin', loadToken: 2 });

        send(owner, { type: 'dispose' });

        expect(owner.port.postMessage).toHaveBeenCalledWith({ type: 'disposed' });
        expect(follower.port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'sampleBankError',
                message: 'Levain processor was disposed during sample loading',
            })
        );
        expect(owner.process([], [makeChannels(2, FRAMES)])).toBe(false);

        calls.length = 0;
        const retry = await loadProcessor();
        send(retry, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(retry, { type: 'beginSampleBank', bankKey: 'disposed-bank', instrumentId: 'violin', loadToken: 3 });
        send(retry, {
            type: 'addSample',
            loadToken: 3,
            sampleId: 0,
            data: new Float32Array([0.3]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });
        send(retry, { type: 'buildZoneMap', loadToken: 3, numArticulations: 1, numMics: 1 });

        expect(calls.filter((call) => call.method === 'add_sample')).toHaveLength(1);
        expect(calls.filter((call) => call.method === 'publish_sample_bank')).toHaveLength(1);
    });

    it('always acknowledges disposal even when best-effort WASM cleanup traps', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'beginSampleBank', bankKey: 'trapped-dispose-bank', instrumentId: 'violin', loadToken: 1 });
        abortSampleBankShouldThrow = true;
        allNotesOffShouldThrow = true;

        send(proc, { type: 'dispose' });

        expect(proc.port.postMessage).toHaveBeenCalledWith({ type: 'disposed' });
        expect(proc.process([], [makeChannels(2, FRAMES)])).toBe(false);
    });

    it('acknowledges disposal before initialization and ignores a later init', async () => {
        const proc = await loadProcessor();

        send(proc, { type: 'dispose' });
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });

        expect(proc.port.postMessage).toHaveBeenCalledWith({ type: 'disposed' });
        expect(proc.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }));
        expect(proc.process([], [makeChannels(2, FRAMES)])).toBe(false);
    });

    it('maps addZone loop modes forward→1, pingpong→2, other/absent→0', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'beginSampleBank', bankKey: 'zone-mode-bank', instrumentId: 'violin', loadToken: 1 });
        calls.length = 0;

        const baseZone = {
            type: 'addZone',
            loadToken: 1,
            zoneId: 1,
            sampleId: 2,
            articulationId: 0,
            rootNote: 60,
            loKey: 0,
            hiKey: 127,
            loVel: 0,
            hiVel: 127,
            rrPos: 0,
            rrLen: 1,
            micId: 0,
            loopStart: 0,
            loopEnd: 0,
            loopCrossfade: 0,
            gainDb: 0,
            attack: 0,
            decay: 0,
            sustain: 1,
            release: 0.1,
        };

        send(proc, { ...baseZone, isRelease: true, loopMode: 'forward' });
        send(proc, { ...baseZone, zoneId: 2, loopMode: 'pingpong' });
        send(proc, { ...baseZone, zoneId: 3, loopMode: 'something' });
        send(proc, { ...baseZone, zoneId: 4 }); // no loopMode

        const zones = calls.filter((c) => c.method === 'add_zone');
        // add_zone(zoneId, sampleId, articulationId, rootNote, loKey, hiKey, loVel,
        //          hiVel, rrPos, rrLen, micId, isRelease[11], loopMode[12], ...)
        expect(zones[0]!.args[11]).toBe(true); // isRelease
        expect(zones[0]!.args[12]).toBe(1); // forward
        expect(zones[1]!.args[12]).toBe(2); // pingpong
        expect(zones[2]!.args[12]).toBe(0); // unknown → 0
        expect(zones[3]!.args[12]).toBe(0); // absent → 0
        expect(zones[3]!.args[11]).toBe(false); // isRelease default false
    });

    it('registers legato transitions with the DSP enum ordering and drops ones from a stale load', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'beginSampleBank', bankKey: 'legato-bank', instrumentId: 'violin', loadToken: 1 });
        calls.length = 0;

        const base = {
            type: 'addLegatoTransition',
            loadToken: 1,
            sampleId: 7,
            interval: -3,
            crossfadeOutMs: 80,
        };
        send(proc, { ...base, transitionType: 'slurred', dynamic: 'pp' });
        send(proc, { ...base, transitionType: 'portamento', dynamic: 'ff' });
        send(proc, { ...base, transitionType: 'slurred', dynamic: 'mf', crossfadeOutMs: 0 });
        // A transition left over from a superseded load must not reach the
        // sounding bank's transition store.
        send(proc, { ...base, loadToken: 99, transitionType: 'portamento', dynamic: 'f' });

        const registered = calls.filter((call) => call.method === 'add_legato_transition');
        expect(registered).toHaveLength(3);
        // add_legato_transition(interval, transitionType, dynamic, sampleId,
        //                       crossfadeOutMs)
        expect(registered[0]!.args).toEqual([-3, 0, 0, 7, 80]);
        expect(registered[1]!.args).toEqual([-3, 1, 5, 7, 80]);
        // 0 is "unauthored" — it reaches the DSP as 0 and the adaptive default
        // applies there, rather than being dropped on this side.
        expect(registered[2]!.args).toEqual([-3, 0, 3, 7, 0]);
    });

    it('forwards buildZoneMap', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'beginSampleBank', bankKey: 'forward-build-bank', instrumentId: 'violin', loadToken: 1 });
        calls.length = 0;

        send(proc, { type: 'buildZoneMap', loadToken: 1, numArticulations: 4, numMics: 3 });

        expect(method('build_zone_map')!.args).toEqual([4, 3]);
    });

    it('rejects an invalid DSP zone-map build instead of reporting a hydrated instrument', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'beginSampleBank', bankKey: 'invalid-build-bank', instrumentId: 'violin', loadToken: 1 });
        zoneMapShouldBuild = false;

        send(proc, { type: 'buildZoneMap', loadToken: 1, numArticulations: 33, numMics: 1 });

        expect(proc.port.postMessage).toHaveBeenCalledWith({
            type: 'sampleBankError',
            loadToken: 1,
            message: 'Levain DSP rejected zone-map dimensions or capacity',
        });
        expect(calls.some((call) => call.method === 'abort_sample_bank')).toBe(true);
    });

    it('aborts only the sample-bank transaction carrying the active load token', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        send(proc, { type: 'beginSampleBank', bankKey: 'abort-bank', instrumentId: 'violin', loadToken: 7 });
        calls.length = 0;

        send(proc, { type: 'abortSampleBank', loadToken: 6 });
        expect(calls.some((call) => call.method === 'abort_sample_bank')).toBe(false);

        send(proc, { type: 'abortSampleBank', loadToken: 7 });
        expect(calls.some((call) => call.method === 'abort_sample_bank')).toBe(true);
        expect(proc.port.postMessage).toHaveBeenCalledWith({
            type: 'sampleBankError',
            loadToken: 7,
            message: 'Levain sample bank load was aborted',
        });
    });

    it('enqueues a future-dated note and drains it within the process block window', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;

        // currentFrame stubbed at 0 ⇒ blockEndFrame = 128. A note at 64 drains; 200 stays.
        send(proc, { type: 'noteOn', note: 60, velocity: 90, sampleFrame: 64 });
        send(proc, { type: 'noteOff', note: 60, sampleFrame: 200 });

        expect(calls).toEqual([]);

        proc.process([], [makeChannels(2, FRAMES)]);
        expect(calls.map((c) => c.method)).toEqual(['note_on']); // only the @64 note

        // Further blocks (static currentFrame=0 → still blockEndFrame 128) drain nothing.
        proc.process([], [makeChannels(2, FRAMES)]);
        expect(calls.map((c) => c.method)).toEqual(['note_on']);
    });

    it('voices a note landing on a block boundary in that block, not the one before it', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init' });
        calls.length = 0;

        // Block 1 renders frames [0, 127]; block 2 renders [128, 255].
        // The noteOn @127 is the last frame of block 1; the noteOff @128 is the
        // FIRST frame of block 2 and must not fire until block 2.
        send(proc, { type: 'noteOn', note: 60, velocity: 90, sampleFrame: 127 });
        send(proc, { type: 'noteOff', note: 60, sampleFrame: 128 });

        vi.stubGlobal('currentFrame', 0);
        proc.process([], [makeChannels(2, FRAMES)]);
        expect(calls.filter((c) => c.method !== 'process').map((c) => c.method)).toEqual(['note_on']);

        vi.stubGlobal('currentFrame', 128);
        proc.process([], [makeChannels(2, FRAMES)]);
        expect(calls.filter((c) => c.method !== 'process').map((c) => c.method)).toEqual(['note_on', 'note_off']);

        vi.stubGlobal('currentFrame', 0);
    });

    it('process guards: not-ready and <2-channel outputs bail without instance calls', async () => {
        const proc = await loadProcessor();
        // not ready
        proc.process([], [makeChannels(2, FRAMES)]);
        expect(calls.find((c) => c.method === 'process')).toBeUndefined();

        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;
        // mono output
        proc.process([], [makeChannels(1, FRAMES)]);
        expect(calls.find((c) => c.method === 'process')).toBeUndefined();
    });

    it('renders a stereo block and copies the seeded output views', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init' });
        calls.length = 0;

        const output = makeChannels(2, FRAMES);
        proc.process([], [output]);

        for (const sample of output[0]!) {
            expect(sample).toBeCloseTo(0.1, 6);
        }
        for (const sample of output[1]!) {
            expect(sample).toBeCloseTo(0.2, 6);
        }
    });

    it('faults and posts an error when instance.process throws', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init' });
        calls.length = 0;
        processShouldThrow = true;

        proc.process([], [makeChannels(2, FRAMES)]);

        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);

        // After faulting, process() short-circuits.
        calls.length = 0;
        processShouldThrow = false;
        proc.process([], [makeChannels(2, FRAMES)]);
        expect(calls.find((c) => c.method === 'process')).toBeUndefined();
    });

    it('faults and posts an error when a message handled after ready throws', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;
        proc.port.postMessage.mockClear();
        setParamShouldThrow = true;

        send(proc, { type: 'param', name: 'masterGain', value: 0.5 });

        // The main thread has to hear about it. Before, the report was gated on
        // `!_ready`, so a post-startup throw reached only a worklet console.
        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        expect((errors[0]![0] as { message: string }).message).toBe('parameter trap');

        // And the instance stops taking work, exactly as the process() catch
        // already does. Before, `_faulted` stayed false and the next message
        // was handed to a possibly-trapped instance.
        setParamShouldThrow = false;
        send(proc, { type: 'noteOn', note: 60, velocity: 90 });
        expect(calls.find((c) => c.method === 'note_on')).toBeUndefined();

        proc.process([], [makeChannels(2, FRAMES)]);
        expect(calls.find((c) => c.method === 'process')).toBeUndefined();
    });
});
