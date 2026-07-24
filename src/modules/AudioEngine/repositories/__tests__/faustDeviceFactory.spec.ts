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

vi.mock('#/modules/PluginHost/useCases', () => {
    throw new Error('faustDeviceFactory must receive Plugin Faust operations by injection');
});

describe('createFaustDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.compileFaustDSP.mockReset();
        mocks.createFaustNode.mockReset();
    });

    it('should return null and warn when compilation fails', async () => {
        mocks.compileFaustDSP.mockResolvedValue(false);

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust-test' });

        expect(result).toBeNull();
        expect(mocks.compileFaustDSP).toHaveBeenCalledWith('faust-test');
        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to compile'));
        expect(mocks.createFaustNode).not.toHaveBeenCalled();
    });

    it('should return null and warn when node creation fails', async () => {
        mocks.compileFaustDSP.mockResolvedValue(true);
        mocks.createFaustNode.mockResolvedValue(null);

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust-missing-node' });

        expect(result).toBeNull();
        expect(mocks.createFaustNode).toHaveBeenCalledWith('faust-missing-node', ctx);
        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to create node'));
    });

    it('should return offline nodes when compilation and node creation succeed', async () => {
        mocks.compileFaustDSP.mockResolvedValue(true);
        const fakeNode = { numberOfInputs: 1, numberOfOutputs: 1 } as unknown as AudioWorkletNode;
        mocks.createFaustNode.mockResolvedValue(fakeNode);

        const ctx = {} as BaseAudioContext;
        const result = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust-ok' });

        expect(result).not.toBeNull();
        expect(mocks.createFaustNode).toHaveBeenCalledWith('faust-ok', ctx);
        expect(result?.inputNode).toBe(fakeNode);
        expect(result?.outputNode).toBe(fakeNode);
    });
});

type CreateFaustDeviceForTestInput = {
    ctx: BaseAudioContext;
    faustModuleId: string;
};

function createFaustDeviceForTest({ ctx, faustModuleId }: CreateFaustDeviceForTestInput) {
    return createFaustDevice({
        ctx,
        faustModuleId,
        compileFaustDSP: mocks.compileFaustDSP,
        createFaustNode: mocks.createFaustNode,
    });
}

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

        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });
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

        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });
        const controls = device!.wamControls!;

        // Three notes across two distinct frames (1s and 2s).
        controls.keyOn!(0, 60, 100, 1);
        controls.keyOn!(0, 62, 100, 1);
        controls.keyOff!(0, 60, 0, 2);

        expect(suspendCalls).toEqual([1, 2]);
    });

    it('fires a note immediately when ctx.suspend throws synchronously', async () => {
        const node = makeKeyNode();
        mocks.createFaustNode.mockResolvedValue(node);

        // Reinstall the OfflineAudioContext so suspend() throws synchronously
        // (some implementations throw instead of rejecting the promise).
        class ThrowingSuspendCtx {
            readonly sampleRate = 48_000;
            currentTime = 0;
            suspend(): Promise<void> {
                throw new Error('suspend sync throw');
            }
            resume(): Promise<void> {
                return Promise.resolve();
            }
        }
        globalThis.OfflineAudioContext = ThrowingSuspendCtx as unknown as typeof OfflineAudioContext;
        const throwingCtx = new ThrowingSuspendCtx() as unknown as OfflineAudioContext;

        const device = await createFaustDeviceForTest({ ctx: throwingCtx, faustModuleId: 'faust' });
        const controls = device!.wamControls!;

        // time > currentTime so it enters the suspend path; suspend throws
        // synchronously and the catch fires the call immediately.
        expect(() => controls.keyOn!(0, 60, 100, 1)).not.toThrow();
        expect(node.keyOn).toHaveBeenCalledWith(0, 60, 100);
    });

    it('fires a note immediately in the offline path when time is undefined or already in the past', async () => {
        const node = makeKeyNode();
        mocks.createFaustNode.mockResolvedValue(node);

        // Bump currentTime into the future-of-some-notes so the "past" branch fires.
        class FutureCtx {
            readonly sampleRate = 48_000;
            currentTime = 5;
            suspend(): Promise<void> {
                suspendCalls.push(-1);
                return Promise.resolve();
            }
            resume(): Promise<void> {
                return Promise.resolve();
            }
        }
        globalThis.OfflineAudioContext = FutureCtx as unknown as typeof OfflineAudioContext;
        const futureCtx = new FutureCtx() as unknown as OfflineAudioContext;

        const device = await createFaustDeviceForTest({ ctx: futureCtx, faustModuleId: 'faust' });
        const controls = device!.wamControls!;

        // undefined time → immediate.
        controls.keyOn!(0, 60, 100);
        // time <= currentTime (5) → immediate, no suspend.
        controls.keyOff!(0, 60, 0, 1);

        expect(node.keyOn).toHaveBeenCalledWith(0, 60, 100);
        expect(node.keyOff).toHaveBeenCalledWith(0, 60, 0);
        expect(suspendCalls).not.toContain(-1);
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

        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });
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

        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });
        const controls = device!.wamControls!;

        controls.keyOn!(0, 60, 100, 0.3);
        controls.keyOff!(0, 60, 0, 0.3);

        now = 0.3;
        await vi.advanceTimersByTimeAsync(400);

        expect(order).toEqual(['on', 'off']);
    });

    it('fires notes immediately when time is undefined or in the past (live path, no queue)', async () => {
        const node = makeKeyNode();
        mocks.createFaustNode.mockResolvedValue(node);

        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });
        const controls = device!.wamControls!;

        now = 1; // present time

        // undefined time → immediate fire.
        controls.keyOn!(0, 60, 100);
        expect(node.keyOn).toHaveBeenCalledWith(0, 60, 100);

        // time in the past (<= currentTime) → immediate fire.
        controls.keyOff!(0, 60, 0, 0.5);
        expect(node.keyOff).toHaveBeenCalledWith(0, 60, 0);
    });
});

// wamControls surface: setParam (resolved-via-cache + error swallow),
// scheduleParam (non-AudioWorkletNode skip, param hit/miss, bare-name
// resolution), destroy (success + error swallow), and the param-address
// cache duplicate-bare-name warning branch.
describe('createFaustDevice — wamControls param & lifecycle surface', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.compileFaustDSP.mockResolvedValue(true);
    });

    it('setParam resolves via the bare-name cache and swallows setParamValue errors', async () => {
        const setParamValue = vi.fn();
        setParamValue.mockImplementationOnce(() => {
            throw new Error('boom');
        });
        const node = {
            keyOn: vi.fn(),
            keyOff: vi.fn(),
            setParamValue,
            destroy: vi.fn(),
        };
        mocks.createFaustNode.mockResolvedValue(node);

        const ctx = {} as BaseAudioContext;
        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });

        // First call: setParamValue throws — must be caught + warned, not thrown.
        device!.wamControls!.setParam('gain', 0.5);
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Failed to set param'),
            expect.any(Error)
        );

        // Second call: succeeds.
        setParamValue.mockClear();
        mocks.logger.warn.mockClear();
        device!.wamControls!.setParam('gain', 0.8);
        expect(setParamValue).toHaveBeenCalledWith('gain', 0.8); // bare name passed through (no cache entry)
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('scheduleParam is a no-op for non-AudioWorkletNode devices, and otherwise sets value at time on resolved params', async () => {
        // Non-AudioWorkletNode: makeKeyNode() is a plain object.
        const plainNode = makeKeyNode();
        mocks.createFaustNode.mockResolvedValue(plainNode);
        const ctx = {} as BaseAudioContext;
        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });
        expect(() => device!.wamControls!.scheduleParam('gain', 0.5, 1)).not.toThrow();
    });

    it('scheduleParam resolves bare param names via the address cache and calls setValueAtTime on hit, ignores miss', async () => {
        const setValueAtTime = vi.fn();
        const params = new Map<string, { setValueAtTime: typeof setValueAtTime }>([
            ['/foo/gain', { setValueAtTime }],
            // '/bar/cutoff' intentionally absent to exercise the miss branch.
        ]);
        const awNode = {
            parameters: params,
            keyOn: vi.fn(),
            keyOff: vi.fn(),
            setParamValue: vi.fn(),
            destroy: vi.fn(),
        };
        // Force `instanceof AudioWorkletNode` true via a stubbed global.
        class FakeAudioWorkletNode {}
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        Object.setPrototypeOf(awNode, FakeAudioWorkletNode.prototype);
        mocks.createFaustNode.mockResolvedValue(awNode);

        const ctx = {} as BaseAudioContext;
        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });

        // Bare "gain" resolves to "/foo/gain" via the cache.
        device!.wamControls!.scheduleParam('gain', 0.9, 2);
        expect(setValueAtTime).toHaveBeenCalledWith(0.9, 2);

        // Unknown bare name → no param found → silent skip.
        setValueAtTime.mockClear();
        device!.wamControls!.scheduleParam('cutoff', 0.1, 3);
        expect(setValueAtTime).not.toHaveBeenCalled();

        vi.unstubAllGlobals();
    });

    it('destroy calls node.destroy() and swallows its errors', async () => {
        const destroy = vi.fn();
        destroy.mockImplementationOnce(() => {
            throw new Error('destroy failed');
        });
        const node = {
            keyOn: vi.fn(),
            keyOff: vi.fn(),
            setParamValue: vi.fn(),
            destroy,
        };
        mocks.createFaustNode.mockResolvedValue(node);
        const ctx = {} as BaseAudioContext;
        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });

        // First destroy throws — caught + warned.
        device!.wamControls!.destroy!();
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Failed to destroy node'),
            expect.any(Error)
        );

        // Second destroy succeeds.
        mocks.logger.warn.mockClear();
        device!.wamControls!.destroy!();
        expect(destroy).toHaveBeenCalledTimes(2);
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('buildParamAddressCache warns on duplicate bare param names and keeps the first', async () => {
        const setValueAtTime = vi.fn();
        const params = new Map<string, { setValueAtTime: typeof setValueAtTime }>([
            ['/pathA/gain', { setValueAtTime }],
            ['/pathB/gain', { setValueAtTime }], // duplicate bare name "gain"
        ]);
        const awNode = {
            parameters: params,
            keyOn: vi.fn(),
            keyOff: vi.fn(),
            setParamValue: vi.fn(),
            destroy: vi.fn(),
        };
        class FakeAudioWorkletNode {}
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        Object.setPrototypeOf(awNode, FakeAudioWorkletNode.prototype);
        mocks.createFaustNode.mockResolvedValue(awNode);

        const ctx = {} as BaseAudioContext;
        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });

        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate bare param "gain"'));
        // The cache kept the first (/pathA/gain).
        device!.wamControls!.scheduleParam('gain', 0.4, 0);
        expect(setValueAtTime).toHaveBeenCalledTimes(1);

        vi.unstubAllGlobals();
    });

    it('keyOn/keyOff no-op when the node lacks the method (no keyOn/keyOff in node)', async () => {
        // Node without keyOn/keyOff: the `'keyOn' in node` guard is false.
        const node = {
            setParamValue: vi.fn(),
            destroy: vi.fn(),
        };
        mocks.createFaustNode.mockResolvedValue(node);
        const ctx = { currentTime: 0, sampleRate: 48_000 } as unknown as AudioContext;
        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });

        expect(() => {
            device!.wamControls!.keyOn!(0, 60, 100, 1);
            device!.wamControls!.keyOff!(0, 60, 0, 1);
        }).not.toThrow();
    });

    it('buildParamAddressCache skips parameter keys whose bare name is empty', async () => {
        // A key that is just "/" splits to ['', ''], pop() → '' (falsy) → skipped.
        const setValueAtTime = vi.fn();
        const params = new Map<string, { setValueAtTime: typeof setValueAtTime }>([
            ['/', { setValueAtTime }],
            ['/real/gain', { setValueAtTime }],
        ]);
        const awNode = {
            parameters: params,
            keyOn: vi.fn(),
            keyOff: vi.fn(),
            setParamValue: vi.fn(),
            destroy: vi.fn(),
        };
        class FakeAudioWorkletNode {}
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        Object.setPrototypeOf(awNode, FakeAudioWorkletNode.prototype);
        mocks.createFaustNode.mockResolvedValue(awNode);

        const ctx = {} as BaseAudioContext;
        const device = await createFaustDeviceForTest({ ctx, faustModuleId: 'faust' });

        // 'gain' resolves to /real/gain; the empty-bare-name key was skipped
        // without polluting the cache.
        device!.wamControls!.scheduleParam('gain', 0.3, 0);
        expect(setValueAtTime).toHaveBeenCalledWith(0.3, 0);

        vi.unstubAllGlobals();
    });
});
