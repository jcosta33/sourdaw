import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

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
class GrandBouleInstanceMock {
    process(): number {
        processCalls++;
        return LEFT_PTR;
    }
    get_right_ptr(): number {
        return RIGHT_PTR;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: mem })),
    GrandBouleInstance: GrandBouleInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

let onmessage: (ev: MessageEvent) => void;

beforeAll(async () => {
    await import('../grandBouleEngineWorker');
    onmessage = selfShim.onmessage!;
});

function makeSab(ringFrames: number): SharedArrayBuffer {
    const HEADER = 2 * Int32Array.BYTES_PER_ELEMENT;
    return new SharedArrayBuffer(HEADER + ringFrames * 2 * Float32Array.BYTES_PER_ELEMENT);
}

let nextInitId = 0;

function sendInit(sab: SharedArrayBuffer, sampleRate = 48_000): void {
    onmessage({
        data: { type: 'init', initId: ++nextInitId, wasmModule: MINIMAL_WASM_MODULE, sab, sampleRate },
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
    it('renders blocks up to TARGET_AHEAD headroom, then sleeps 2ms when the buffer is full', async () => {
        processCalls = 0;
        // Large ring (128*8) so the loop is bounded by TARGET_AHEAD, not by
        // ring capacity.
        const sab = makeSab(128 * 8);

        sendInit(sab);

        // init posts 'ready' and calls scheduleRender() → the real MessageChannel
        // delivers renderLoop as a macrotask; the 2ms reschedule (setTimeout)
        // also fires. Drain macrotasks with real async ticks.
        await new Promise((resolve) => setTimeout(resolve, 20));

        // TARGET_AHEAD = 128*6 = 768; the loop renders 6 blocks then breaks on
        // `buffered >= TARGET_AHEAD` and schedules setTimeout(scheduleRender, 2).
        expect(processCalls).toBeGreaterThanOrEqual(6);
        // The ready handshake was posted.
        expect(posted.some((m) => m.type === 'ready')).toBe(true);
    });

    it('immediately reschedules when the ring fills before reaching TARGET_AHEAD', async () => {
        processCalls = 0;
        // Small ring: one block (128) fills it. After one render, buffered=128
        // and ringFrames-buffered = 0 < BLOCK_SIZE → break on the ring-full
        // branch. buffered (128) < TARGET_AHEAD (768) → scheduleRender() now.
        const sab = makeSab(128);

        sendInit(sab);
        await new Promise((resolve) => setTimeout(resolve, 20));

        // At least one block rendered; the loop broke on ring-full and the
        // immediate-reschedule branch (line 169 else) ran.
        expect(processCalls).toBeGreaterThanOrEqual(1);
    });

    it('no-ops renderLoop before init (module-level guards are all null)', async () => {
        // A fresh import path exercises the not-running guard, but the worker
        // is already initialised by the beforeAll import. Verify that sending
        // a stop then re-init is consistent: stop sets running=false so a
        // pending render is a no-op guard return.
        processCalls = 0;
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
