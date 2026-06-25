import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createFaustDevice } from '../faustDeviceFactory';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        logger: { warn: vi.fn() },
        compileFaustDSP: vi.fn().mockResolvedValue(false),
        createFaustNode: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

vi.mock('#/modules/Plugin/useCases', () => ({
    compileFaustDSP: mocks.compileFaustDSP,
    createFaustNode: mocks.createFaustNode,
    isFaustModule: vi.fn(),
}));

describe('createFaustDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.compileFaustDSP.mockReset();
        mocks.createFaustNode.mockReset();
    });

    it('should return null and warn when compilation fails', async () => {
        mocks.compileFaustDSP.mockResolvedValue(false);

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDevice(ctx, 'faust-test');

        expect(result).toBeNull();
        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to compile'));
        expect(mocks.createFaustNode).not.toHaveBeenCalled();
    });

    it('should return offline nodes when compilation and node creation succeed', async () => {
        mocks.compileFaustDSP.mockResolvedValue(true);
        const fakeNode = { numberOfInputs: 1, numberOfOutputs: 1 } as unknown as AudioWorkletNode;
        mocks.createFaustNode.mockResolvedValue(fakeNode);

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDevice(ctx, 'faust-ok');

        expect(result).not.toBeNull();
        expect(result?.inputNode).toBe(fakeNode);
        expect(result?.outputNode).toBe(fakeNode);
    });
});

/** A Faust node stub exposing keyOn/keyOff so scheduleCall has something to fire. */
function makeKeyNode(): {
    keyOn: ReturnType<typeof vi.fn>;
    keyOff: ReturnType<typeof vi.fn>;
} {
    return {
        keyOn: vi.fn(),
        keyOff: vi.fn(),
        keyOffAll: vi.fn(),
        setParamValue: vi.fn(),
        destroy: vi.fn(),
    } as unknown as { keyOn: ReturnType<typeof vi.fn>; keyOff: ReturnType<typeof vi.fn> };
}

describe('createFaustDevice — offline note scheduling (suspend batching)', () => {
    const RealOfflineAudioContext = globalThis.OfflineAudioContext;

    let suspendCalls: number[];
    let resumeCount: number;
    let ctx: OfflineAudioContext;

    beforeEach(() => {
        vi.clearAllMocks();
        suspendCalls = [];
        resumeCount = 0;

        // The shared setupTests mock returns a plain object from its constructor,
        // so `instanceof` fails. Install a real, controllable class for these tests.
        class TestOfflineCtx {
            readonly sampleRate = 48_000;
            currentTime = 0;
            suspend(time: number): Promise<void> {
                suspendCalls.push(time);
                return Promise.resolve();
            }
            resume(): Promise<void> {
                resumeCount++;
                return Promise.resolve();
            }
        }
        globalThis.OfflineAudioContext = TestOfflineCtx as unknown as typeof OfflineAudioContext;
        ctx = new TestOfflineCtx() as unknown as OfflineAudioContext;

        mocks.compileFaustDSP.mockResolvedValue(true);
        mocks.createFaustNode.mockResolvedValue(makeKeyNode());
    });

    afterEach(() => {
        globalThis.OfflineAudioContext = RealOfflineAudioContext;
    });

    it('registers exactly one suspend for two notes that land on the same frame', async () => {
        const node = makeKeyNode();
        mocks.createFaustNode.mockResolvedValue(node);

        const device = await createFaustDevice(ctx, 'faust');
        const controls = device!.wamControls!;

        // Two note-ons at the same target time (same sample frame).
        controls.keyOn!(0, 60, 100, 1);
        controls.keyOn!(0, 64, 100, 1);

        // Previously each call invoked suspend() independently — the second
        // collided at the same frame, was caught, and fired immediately.
        // Now the second call joins the first frame's batch: one suspend only.
        expect(suspendCalls).toEqual([1]);

        // Both queued calls fire when that frame's suspend resolves.
        await Promise.resolve();
        await Promise.resolve();
        expect(node.keyOn).toHaveBeenCalledTimes(2);
        expect(resumeCount).toBe(1);
    });

    it('registers one suspend per distinct frame, not one per note', async () => {
        const node = makeKeyNode();
        mocks.createFaustNode.mockResolvedValue(node);

        const device = await createFaustDevice(ctx, 'faust');
        const controls = device!.wamControls!;

        // Three notes across two distinct frames (1s and 2s).
        controls.keyOn!(0, 60, 100, 1);
        controls.keyOn!(0, 62, 100, 1);
        controls.keyOff!(0, 60, 0, 2);

        expect(suspendCalls).toEqual([1, 2]);
    });
});

// Characterization tests for the live path. The live change (per-call setTimeout
// → one sample-frame-sorted queue) removes the browser ~4ms timer floor and
// coalescing jitter — neither of which jsdom's fake timers model, so these do NOT
// flip red on the old setTimeout implementation. They instead pin the ordering
// invariants the new queue must preserve (earliest-time-first; note-on before a
// same-time note-off), guarding against a future refactor that breaks them.
describe('createFaustDevice — live note scheduling (sample-frame-sorted queue)', () => {
    let now: number;
    let ctx: AudioContext;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        now = 0;
        ctx = {
            sampleRate: 48_000,
            get currentTime() {
                return now;
            },
        } as unknown as AudioContext;
        mocks.compileFaustDSP.mockResolvedValue(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires queued live notes in target-time order even when scheduled out of order', async () => {
        const node = makeKeyNode();
        mocks.createFaustNode.mockResolvedValue(node);
        const order: string[] = [];
        node.keyOn.mockImplementation(() => order.push('on'));
        node.keyOff.mockImplementation(() => order.push('off'));

        const device = await createFaustDevice(ctx, 'faust');
        const controls = device!.wamControls!;

        // Schedule the LATER note-on first, then an EARLIER note-off: the queue
        // must fire the earlier event (off @0.2) first.
        controls.keyOn!(0, 60, 100, 0.5);
        controls.keyOff!(0, 48, 0, 0.2);

        now = 0.5;
        await vi.advanceTimersByTimeAsync(600);

        expect(order).toEqual(['off', 'on']);
    });

    it('fires a note-on before a note-off scheduled at the same target time', async () => {
        const node = makeKeyNode();
        mocks.createFaustNode.mockResolvedValue(node);
        const order: string[] = [];
        node.keyOn.mockImplementation(() => order.push('on'));
        node.keyOff.mockImplementation(() => order.push('off'));

        const device = await createFaustDevice(ctx, 'faust');
        const controls = device!.wamControls!;

        controls.keyOn!(0, 60, 100, 0.3);
        controls.keyOff!(0, 60, 0, 0.3);

        now = 0.3;
        await vi.advanceTimersByTimeAsync(400);

        expect(order).toEqual(['on', 'off']);
    });
});
