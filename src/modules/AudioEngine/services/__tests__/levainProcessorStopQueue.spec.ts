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

// Audit #4591 — Stop and bypass entry post `allNotesOff` alone. Future note
// messages the scheduler already queued (note-ons up to the look-ahead, and
// note-offs a whole note length ahead) must not fire after the release.
describe('LevainProcessor queued notes across allNotesOff', () => {
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
        vi.stubGlobal('currentFrame', 0);
    });

    it('does not sound a note that was queued before Stop released every voice', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;

        send(proc, { type: 'noteOn', note: 60, velocity: 100, sampleFrame: 64 });
        send(proc, { type: 'noteOff', note: 60, sampleFrame: 96_000 });
        send(proc, { type: 'allNotesOff' });

        proc.process([], [makeChannels(2, FRAMES)]);

        expect(calls.map((call) => call.method).filter((name) => name !== 'process')).toEqual(['all_notes_off']);
    });
});
