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

class LevainInstanceMock {
    note_on(note: number, velocity: number): void {
        calls.push({ method: 'note_on', args: [note, velocity] });
    }
    note_on_with_channel(note: number, velocity: number, _channel: number): void {
        calls.push({ method: 'note_on', args: [note, velocity] });
    }
    note_off(note: number): void {
        calls.push({ method: 'note_off', args: [note] });
    }
    all_notes_off(): void {
        calls.push({ method: 'all_notes_off', args: [] });
    }
    set_param(name: string, value: number): void {
        calls.push({ method: 'set_param', args: [name, value] });
    }
    handle_cc(cc: number, value: number): void {
        calls.push({ method: 'handle_cc', args: [cc, value] });
    }
    set_instrument(id: string): void {
        calls.push({ method: 'set_instrument', args: [id] });
    }
    add_sample(data: Float32Array, frameCount: number, channels: number, sampleRate: number): void {
        if (addSampleShouldThrow) {
            // Sample loading is the likeliest place for this device to fail
            // after startup: the copy into linear memory is hundreds of MiB for
            // a single instrument, with no dedup between instances.
            throw new Error('memory allocation failed');
        }
        calls.push({ method: 'add_sample', args: [Array.from(data), frameCount, channels, sampleRate] });
    }
    add_zone(...args: unknown[]): void {
        calls.push({ method: 'add_zone', args });
    }
    build_zone_map(numArticulations: number, numMics: number): void {
        calls.push({ method: 'build_zone_map', args: [numArticulations, numMics] });
    }
    clear_zones(): void {
        calls.push({ method: 'clear_zones', args: [] });
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
        resetGrowableMemory(memory, HEAP_BYTES);
        calls.length = 0;
        processShouldThrow = false;
        addSampleShouldThrow = false;
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

    it('forwards cc, setInstrument and bypass messages', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;

        send(proc, { type: 'cc', cc: 74, value: 100 });
        send(proc, { type: 'setInstrument', instrumentId: 'strings-legion' });
        send(proc, { type: 'bypass', bypassed: true });

        expect(method('handle_cc')!.args).toEqual([74, 100]);
        expect(method('set_instrument')!.args).toEqual(['strings-legion']);
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

        const data = new Float32Array([0.1, 0.2, 0.3, 0.4]);
        send(proc, { type: 'addSample', data, frameCount: 4, channels: 1, sampleRate: 48000 });

        const args = method('add_sample')!.args;
        expect(args[1]).toBe(4);
        expect(args[2]).toBe(1);
        expect(args[3]).toBe(48000);
        // Float32 storage rounds the sample values; compare with tolerance.
        const passed = args[0] as number[];
        expect(passed.map((v) => Number(v.toFixed(6)))).toEqual([0.1, 0.2, 0.3, 0.4]);
    });

    it('maps addZone loop modes forward→1, pingpong→2, other/absent→0', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;

        const baseZone = {
            type: 'addZone',
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

    it('forwards buildZoneMap and clearZones', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;

        send(proc, { type: 'buildZoneMap', numArticulations: 4, numMics: 3 });
        send(proc, { type: 'clearZones' });

        expect(method('build_zone_map')!.args).toEqual([4, 3]);
        expect(calls.some((c) => c.method === 'clear_zones')).toBe(true);
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
        addSampleShouldThrow = true;

        send(proc, {
            type: 'addSample',
            sampleId: 1,
            data: new RealFloat32Array(8),
            frameCount: 8,
            channels: 1,
            sampleRate: 48000,
        });

        // The main thread has to hear about it. Before, the report was gated on
        // `!_ready`, so a post-startup throw reached only a worklet console.
        const errors = proc.port.postMessage.mock.calls.filter((c) => (c[0] as { type?: string }).type === 'error');
        expect(errors).toHaveLength(1);
        expect((errors[0]![0] as { message: string }).message).toBe('memory allocation failed');

        // And the instance stops taking work, exactly as the process() catch
        // already does. Before, `_faulted` stayed false and the next message
        // was handed to a possibly-trapped instance.
        addSampleShouldThrow = false;
        send(proc, { type: 'noteOn', note: 60, velocity: 90 });
        expect(calls.find((c) => c.method === 'note_on')).toBeUndefined();

        proc.process([], [makeChannels(2, FRAMES)]);
        expect(calls.find((c) => c.method === 'process')).toBeUndefined();
    });
});
