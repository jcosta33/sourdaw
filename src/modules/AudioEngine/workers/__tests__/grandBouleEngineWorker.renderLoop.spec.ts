import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

import { GRAND_BOULE_SYNC_INT_COUNT } from '../../models/GrandBouleRingProtocol';
import { publishGrandBouleConsumerClock } from '../../worklets/grandBouleConsumerClock';

/**
 * renderLoop coverage for the Grand Boule engine worker.
 *
 * renderLoop is private and driven solely by the worker's internal
 * MessageChannel yield. To exercise it we let the channel deliver normally
 * (so init's scheduleRender() actually invokes renderLoop), and we mock the
 * WASM instance so process() returns a valid pointer into a real Memory.
 *
 * Branches targeted:
 *  - the renderLoop guard short-circuits (134) are covered indirectly by the
 *    not-yet-init state; the live path covers the loop body.
 *  - the "enough headroom / ring full" break (148): driven by TARGET_AHEAD
 *    on a large ring vs ring-full on a small ring.
 *  - the "buffer full → setTimeout(2ms)" vs "immediate reschedule" branch (169).
 */

const posted: Array<{ type: string; [k: string]: unknown }> = [];
const selfShim = {
    onmessage: null as ((ev: MessageEvent) => void) | null,
    postMessage: vi.fn((m: unknown) => {
        posted.push(m as { type: string });
    }),
};
Object.defineProperty(globalThis, 'self', { configurable: true, value: selfShim });

// A real WebAssembly.Memory the worker reads rendered frames from. The mock
// instance's process()/get_right_ptr() return byte offsets into this memory
// where we pre-place a 128-sample stereo pair.
const MEM_FRAMES = 128;
const mem = new WebAssembly.Memory({ initial: 1 });
const memView = new Float32Array(mem.buffer);
// Left channel at offset 0, right channel at offset 128 (Float32 indices).
for (let i = 0; i < MEM_FRAMES; i++) {
    memView[i] = 0.1 * (i + 1);
    memView[MEM_FRAMES + i] = -0.1 * (i + 1);
}
const LEFT_PTR = 0; // byte offset 0
const RIGHT_PTR = MEM_FRAMES * Float32Array.BYTES_PER_ELEMENT; // byte offset 512

let processCalls = 0;
let noteOnCalls = 0;
let noteOnAtProcessCall = -1;
let lifecycleState = 3;
let sleepAfterProcessCalls: number | null = null;
class GrandBouleInstanceMock {
    note_on_with_channel(): void {
        noteOnCalls++;
        noteOnAtProcessCall = processCalls;
        lifecycleState = 0;
    }
    process(): number {
        processCalls++;
        if (sleepAfterProcessCalls !== null && processCalls >= sleepAfterProcessCalls) {
            lifecycleState = 3;
        }
        return LEFT_PTR;
    }
    get_right_ptr(): number {
        return RIGHT_PTR;
    }
    lifecycle_state(): number {
        return lifecycleState;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: mem })),
}));
vi.mock('../../worklets/grandBouleWasmInstance', () => ({
    createGrandBouleWasmInstance: () => new GrandBouleInstanceMock(),
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

let onmessage: (ev: MessageEvent) => void;

beforeAll(async () => {
    await import('../grandBouleEngineWorker');
    onmessage = selfShim.onmessage!;
});

function makeSab(ringFrames: number): SharedArrayBuffer {
    const HEADER = 7 * Int32Array.BYTES_PER_ELEMENT;
    return new SharedArrayBuffer(HEADER + ringFrames * 2 * Float32Array.BYTES_PER_ELEMENT);
}

let nextInitId = 0;

function sendInit(
    sab: SharedArrayBuffer,
    sampleRate = 48_000,
    syncSab?: SharedArrayBuffer,
    contextFrame?: number
): void {
    onmessage({
        data: {
            type: 'init',
            initId: ++nextInitId,
            wasmModule: MINIMAL_WASM_MODULE,
            sab,
            sampleRate,
            syncSab,
            contextFrame,
        },
    } as MessageEvent);
}

function sendStop(): void {
    onmessage({ data: { type: 'stop' } } as MessageEvent);
}

// Every test re-inits the worker; afterEach stops it so no render loop keeps
// spinning (the small-ring case otherwise re-posts scheduleRender forever).
afterEach(() => {
    sendStop();
});

describe('grandBouleEngineWorker renderLoop', () => {
    it('leaves a cold sleeping DSP idle until a note wakes it', async () => {
        processCalls = 0;
        noteOnCalls = 0;
        noteOnAtProcessCall = -1;
        lifecycleState = 3;
        sleepAfterProcessCalls = null;
        const sab = makeSab(128 * 8);

        sendInit(sab);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(processCalls).toBe(0);

        onmessage({ data: { type: 'noteOn', midiNote: 60, velocity: 1 } } as MessageEvent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(processCalls).toBeGreaterThan(0);
    });

    it('keeps rendering toward a future-frame note while the DSP itself is still asleep', async () => {
        processCalls = 0;
        noteOnCalls = 0;
        lifecycleState = 3;
        sleepAfterProcessCalls = null;
        const sab = makeSab(128 * 8);

        sendInit(sab);
        onmessage({ data: { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 384 } } as MessageEvent);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(noteOnCalls).toBe(1);
        expect(processCalls).toBeGreaterThanOrEqual(4);
    });

    it('preserves a consumer offset published before Worker init for the first scheduled note', async () => {
        processCalls = 0;
        noteOnCalls = 0;
        noteOnAtProcessCall = -1;
        lifecycleState = 3;
        sleepAfterProcessCalls = null;
        const sab = makeSab(128 * 8);
        const syncSab = new SharedArrayBuffer(GRAND_BOULE_SYNC_INT_COUNT * Int32Array.BYTES_PER_ELEMENT);
        publishGrandBouleConsumerClock(new Int32Array(syncSab), 512, 0);

        sendInit(sab, 48_000, syncSab, 0);
        onmessage({ data: { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 640 } } as MessageEvent);
        await new Promise((resolve) => setTimeout(resolve, 20));

        // 640 is the exclusive end of the first block under offset 512, so it
        // belongs to the second block and voices after exactly one process call.
        expect({ noteOnCalls, noteOnAtProcessCall }).toEqual({ noteOnCalls: 1, noteOnAtProcessCall: 1 });
    });

    it('renders blocks up to TARGET_AHEAD headroom, then waits for consumer demand', async () => {
        processCalls = 0;
        lifecycleState = 0;
        sleepAfterProcessCalls = null;
        // Large ring (128*8) so the loop is bounded by TARGET_AHEAD, not by
        // ring capacity.
        const sab = makeSab(128 * 8);

        sendInit(sab);

        // Init schedules the active mock engine; drain the MessageChannel task.
        await new Promise((resolve) => setTimeout(resolve, 20));

        // TARGET_AHEAD = 128*6 = 768; the loop renders 6 blocks then breaks on
        // `buffered >= TARGET_AHEAD` and waits for a render request.
        expect(processCalls).toBeGreaterThanOrEqual(6);
        // The ready handshake was posted.
        expect(posted.some((m) => m.type === 'ready')).toBe(true);
    });

    it('renders again only after the consumer advances the ring and requests work', async () => {
        processCalls = 0;
        lifecycleState = 0;
        sleepAfterProcessCalls = null;
        const sab = makeSab(128 * 8);
        const controls = new Int32Array(sab, 0, 7);

        sendInit(sab);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const beforeDemand = processCalls;
        Atomics.store(controls, 1, 128);
        Atomics.add(controls, 2, 1);
        Atomics.notify(controls, 2);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(processCalls).toBeGreaterThan(beforeDemand);
    });

    it('rechecks ring capacity after sampling the request generation', async () => {
        processCalls = 0;
        lifecycleState = 0;
        sleepAfterProcessCalls = null;
        const sab = makeSab(128 * 8);
        const controls = new Int32Array(sab, 0, 7);
        const originalLoad = Atomics.load;
        let demandInjected = false;
        const loadSpy = vi.spyOn(Atomics, 'load').mockImplementation((typedArray, index) => {
            if (typedArray.buffer === sab && index === 2 && !demandInjected) {
                demandInjected = true;
                Atomics.store(controls, 1, 128);
                Atomics.add(controls, 2, 1);
            }
            return originalLoad(typedArray, index);
        });

        try {
            sendInit(sab);
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(demandInjected).toBe(true);
            expect(processCalls).toBeGreaterThan(6);
        } finally {
            loadSpy.mockRestore();
        }
    });

    it('does not miss a request-generation change during waiter enrollment', async () => {
        processCalls = 0;
        lifecycleState = 0;
        sleepAfterProcessCalls = null;
        const sab = makeSab(128 * 8);
        const controls = new Int32Array(sab, 0, 7);
        const originalWaitAsync = Atomics.waitAsync;
        let demandInjected = false;
        const waitSpy = vi.spyOn(Atomics, 'waitAsync').mockImplementation((typedArray, index, value, timeout) => {
            if (typedArray.buffer === sab && index === 2 && !demandInjected) {
                demandInjected = true;
                Atomics.store(controls, 1, 128);
                Atomics.add(controls, 2, 1);
                Atomics.notify(controls, 2);
            }
            return originalWaitAsync(typedArray, index, value, timeout);
        });

        try {
            sendInit(sab);
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(demandInjected).toBe(true);
            expect(processCalls).toBeGreaterThan(6);
        } finally {
            waitSpy.mockRestore();
        }
    });

    it('stops producing after the DSP publishes sleep and preserves the drain boundary', async () => {
        processCalls = 0;
        lifecycleState = 0;
        sleepAfterProcessCalls = 2;
        const sab = makeSab(128 * 8);
        const controls = new Int32Array(sab, 0, 7);
        const originalStore = Atomics.store;
        const publicationOrder: number[] = [];
        const storeSpy = vi.spyOn(Atomics, 'store').mockImplementation((typedArray, index, value) => {
            if (typedArray.buffer === sab && (index === 3 || index === 4)) {
                publicationOrder.push(index);
            }
            return originalStore(typedArray, index, value);
        });

        try {
            sendInit(sab);
            await new Promise((resolve) => setTimeout(resolve, 10));
            const sleepingProcessCalls = processCalls;
            const sleepHead = Atomics.load(controls, 3);

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(sleepingProcessCalls).toBe(2);
            expect(processCalls).toBe(sleepingProcessCalls);
            expect(sleepHead).toBe(Atomics.load(controls, 0));
            expect(Atomics.load(controls, 4)).toBe(3);
            expect(publicationOrder.slice(-2)).toEqual([3, 4]);
        } finally {
            storeSpy.mockRestore();
        }
    });

    it('waits instead of spinning when the ring fills before reaching TARGET_AHEAD', async () => {
        processCalls = 0;
        lifecycleState = 0;
        sleepAfterProcessCalls = null;
        // Small ring: one block (128) fills it. After one render, buffered=128
        // and ringFrames-buffered = 0 < BLOCK_SIZE → break on the ring-full
        // branch and waits for the consumer to free space.
        const sab = makeSab(128);

        sendInit(sab);
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Exactly one block fits; no polling render should run while it remains full.
        expect(processCalls).toBeGreaterThanOrEqual(1);
        expect(processCalls).toBeLessThanOrEqual(1);
    });

    it('no-ops renderLoop before init (module-level guards are all null)', async () => {
        // A fresh import path exercises the not-running guard, but the worker
        // is already initialised by the beforeAll import. Verify that sending
        // a stop then re-init is consistent: stop sets running=false so a
        // pending render is a no-op guard return.
        processCalls = 0;
        lifecycleState = 0;
        sleepAfterProcessCalls = null;
        const sab = makeSab(128 * 8);
        sendInit(sab);
        onmessage({ data: { type: 'stop' } } as MessageEvent);
        const before = processCalls;
        // Allow any pending yields to drain; with running=false the guard at
        // line 134 returns immediately.
        await new Promise((resolve) => setTimeout(resolve, 0));
        // No further process calls after stop (guard short-circuits).
        expect(processCalls).toBe(before);
    });
});
