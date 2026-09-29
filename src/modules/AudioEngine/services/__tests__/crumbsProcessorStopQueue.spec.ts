import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    RealFloat32Array,
    installWorkletGlobals,
    makeChannels,
    type GrowableMemory,
    createGrowableMemory,
    resetGrowableMemory,
} from './wasmViewGrowthHarness';

// CrumbsProcessor scheduled-note timing. The drain window is the one behaviour
// here that is not observable from CrumbsNode, because it depends on where the
// worklet's `currentFrame` sits relative to the queued sampleFrame.

type CrumbsProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<CrumbsProcessorLike>();

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const FRAMES = 128;
const memory: GrowableMemory = createGrowableMemory(HEAP_BYTES);

const calls: Array<{ method: string; args: unknown[] }> = [];
let sampleLoadFailure: Error | null = null;
let droppedSampleWrites = 0;

class CrumbsInstanceMock {
    free(): void {
        calls.push({ method: 'free', args: [] });
    }
    note_on(note: number, velocity: number): void {
        calls.push({ method: 'note_on', args: [note, velocity] });
    }
    note_off(note: number): void {
        calls.push({ method: 'note_off', args: [note] });
    }
    all_notes_off(): void {
        calls.push({ method: 'all_notes_off', args: [] });
    }
    all_sound_off(): void {
        calls.push({ method: 'all_sound_off', args: [] });
    }
    add_sample(_data: Float32Array, _channels: number, _sampleRate: number): number {
        calls.push({ method: 'add_sample', args: [_data, _channels, _sampleRate] });
        if (sampleLoadFailure) {
            throw sampleLoadFailure;
        }
        return 0;
    }
    set_active_sample(id: number): void {
        calls.push({ method: 'set_active_sample', args: [id] });
    }
    dropped_sample_writes(): number {
        calls.push({ method: 'dropped_sample_writes', args: [] });
        return droppedSampleWrites;
    }
    set_param(name: string, value: number): void {
        calls.push({ method: 'set_param', args: [name, value] });
    }
    set_mode(mode: string): void {
        calls.push({ method: 'set_mode', args: [mode] });
    }
    process(frames: number): number {
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
    CrumbsInstance: CrumbsInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<CrumbsProcessorLike> {
    await import('../crumbsProcessor');
    const Ctor = registry.get('crumbs-processor');
    if (!Ctor) {
        throw new Error('crumbs-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: CrumbsProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function noteCalls(): string[] {
    return calls.filter((c) => c.method === 'note_on' || c.method === 'note_off').map((c) => c.method);
}

// Audit #4591 — Stop and bypass entry post `allNotesOff` alone. Future note
// messages the scheduler already queued must not fire after the release.
describe('CrumbsProcessor queued notes across allNotesOff', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        calls.length = 0;
        sampleLoadFailure = null;
        droppedSampleWrites = 0;
        vi.stubGlobal('currentFrame', 0);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not sound a note that was queued before Stop released every voice', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init' });
        calls.length = 0;

        send(proc, { type: 'noteOn', note: 60, velocity: 100, sampleFrame: 64 });
        send(proc, { type: 'noteOff', note: 60, sampleFrame: 96_000 });
        send(proc, { type: 'allNotesOff' });

        proc.process([], [makeChannels(2, FRAMES)]);

        expect(calls.map((call) => call.method).filter((name) => name !== 'process')).toEqual(['all_notes_off']);
        expect(noteCalls()).toEqual([]);
    });
});
