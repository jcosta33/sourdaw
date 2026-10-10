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
    bankStaged = false;
    begin_sample_bank(instrumentId: string): void {
        calls.push({ method: 'begin_sample_bank', args: [instrumentId] });
        this.bankStaged = true;
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
    abort_sample_bank(): boolean {
        calls.push({ method: 'abort_sample_bank', args: [] });
        if (abortSampleBankShouldThrow) {
            throw new Error('abort trapped');
        }
        const retired = this.bankStaged;
        this.bankStaged = false;
        return retired;
    }
    commit_sample_bank(): boolean {
        calls.push({ method: 'commit_sample_bank', args: [] });
        this.bankStaged = false;
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

// A controller is state, so allNotesOff keeps every queued controller move. Stored clip
// playback therefore marks its moves, and `discardStoredCc` drops the marked ones that
// are still waiting for their frame (the look-ahead past a relocation or a stop).
describe('LevainProcessor queued controller moves from stored playback', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        resetGrowableMemory(memory, HEAP_BYTES);
        calls.length = 0;
        processShouldThrow = false;
        vi.stubGlobal('currentFrame', 0);
    });

    function controllerCalls(): unknown[][] {
        return calls.filter((call) => call.method === 'handle_cc').map((call) => call.args);
    }

    async function startedProcessor(): Promise<LevainProcessorLike> {
        const proc = await loadProcessor();
        send(proc, { type: 'init', wasmModule: MINIMAL_WASM_MODULE });
        calls.length = 0;
        return proc;
    }

    function drainPast(proc: LevainProcessorLike, frame: number): void {
        vi.stubGlobal('currentFrame', frame);
        proc.process([], [makeChannels(2, FRAMES)]);
    }

    it('drops a stored CC11 move still queued, so it never applies after the relocation', async () => {
        const proc = await startedProcessor();

        send(proc, { type: 'cc', cc: 11, value: 20, sampleFrame: 5_000, stored: true });
        send(proc, { type: 'discardStoredCc' });
        send(proc, { type: 'cc', cc: 11, value: 100, sampleFrame: 200, stored: true });
        drainPast(proc, 6_000);

        expect(controllerCalls()).toEqual([[11, 100]]);
    });

    it('would apply that stored move after the destination value without the discard', async () => {
        const proc = await startedProcessor();

        send(proc, { type: 'cc', cc: 11, value: 20, sampleFrame: 5_000, stored: true });
        send(proc, { type: 'allNotesOff' });
        send(proc, { type: 'cc', cc: 11, value: 100, sampleFrame: 200, stored: true });
        drainPast(proc, 6_000);

        expect(controllerCalls()).toEqual([
            [11, 100],
            [11, 20],
        ]);
    });

    it('keeps a controller move a performer played, framed or not, queued', async () => {
        const proc = await startedProcessor();

        send(proc, { type: 'cc', cc: 1, value: 64, sampleFrame: 5_000 });
        send(proc, { type: 'cc', cc: 11, value: 90, sampleFrame: 5_100, stored: true });
        send(proc, { type: 'discardStoredCc' });
        drainPast(proc, 6_000);

        expect(controllerCalls()).toEqual([[1, 64]]);
    });

    it('leaves a controller value already applied where it stands', async () => {
        const proc = await startedProcessor();

        send(proc, { type: 'cc', cc: 11, value: 100, stored: true });
        calls.length = 0;
        send(proc, { type: 'discardStoredCc' });
        drainPast(proc, 6_000);

        expect(controllerCalls()).toEqual([]);
    });

    it('does not supersede a performer move queued for the same controller when it is frameless', async () => {
        const proc = await startedProcessor();

        send(proc, { type: 'cc', cc: 11, value: 90, sampleFrame: 5_000 });
        send(proc, { type: 'cc', cc: 11, value: 50, stored: true });
        drainPast(proc, 6_000);

        expect(controllerCalls()).toEqual([
            [11, 50],
            [11, 90],
        ]);
    });

    it('still lets a frameless performer move supersede a queued stored one of the same controller', async () => {
        const proc = await startedProcessor();

        send(proc, { type: 'cc', cc: 11, value: 20, sampleFrame: 5_000, stored: true });
        send(proc, { type: 'cc', cc: 11, value: 70 });
        drainPast(proc, 6_000);

        expect(controllerCalls()).toEqual([[11, 70]]);
    });
});
