import { describe, it, expect, vi, beforeEach } from 'vitest';

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

class CrumbsInstanceMock {
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
        return 0;
    }
    set_active_sample(_id: number): void {}
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

const MINIMAL_WASM_MODULE = new WebAssembly.Module(
    new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
);

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

describe('CrumbsProcessor scheduled note queue', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        calls.length = 0;
        vi.stubGlobal('currentFrame', 0);
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
        expect(noteCalls()).toEqual(['note_on']);

        vi.stubGlobal('currentFrame', 128);
        proc.process([], [makeChannels(2, FRAMES)]);
        expect(noteCalls()).toEqual(['note_on', 'note_off']);

        vi.stubGlobal('currentFrame', 0);
    });

    it('sounds a note at exactly currentFrame even while bypassed, where a queued one is withheld', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init' });
        send(proc, { type: 'bypass', bypassed: true });
        calls.length = 0;

        // The `> currentFrame` enqueue guard is NOT the drain bound restated: it
        // decides whether a message enters the queue at all. Both paths would
        // otherwise reach the instance in the same block, because _drainQueue
        // runs inside the very next process(). What separates them is that the
        // queue can be abandoned — process() early-returns while bypassed (and
        // when faulted, or on a malformed output), so a queued event never
        // drains. Dispatching a same-frame event immediately keeps it out of
        // that trap; queueing it would silently drop it.
        vi.stubGlobal('currentFrame', 256);
        send(proc, { type: 'noteOn', note: 64, velocity: 70, sampleFrame: 256 });
        send(proc, { type: 'noteOn', note: 67, velocity: 70, sampleFrame: 257 });

        proc.process([], [makeChannels(2, FRAMES)]);

        // Note 64 (== currentFrame) sounded; note 67 (> currentFrame) is stuck
        // in a queue this bypassed block will never drain.
        expect(noteCalls()).toEqual(['note_on']);
        expect(calls.filter((c) => c.method === 'note_on').map((c) => c.args[0])).toEqual([64]);

        vi.stubGlobal('currentFrame', 0);
    });
});
