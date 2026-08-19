import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMockAudioContext, type MockAudioContext } from '#/helpers/__tests__/audioContext.mock';

import {
    createAudioEngineTopologyTestHarness as createAudioEngine,
    type AudioEngineTopologyTestHarness,
} from './createAudioEngineTopologyTestHarness';

import type { KneadNodeResult } from '../../engine/KneadNode';
import type { AudioEngine, BuiltinDeviceNode } from '../../models/AudioEngineState';

const kneadFactory = vi.hoisted(() => ({ createKneadNode: vi.fn() }));

vi.mock('../../engine/KneadNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../engine/KneadNode')>()),
    createKneadNode: kneadFactory.createKneadNode,
}));

class FakeWorkletNode {
    port = { postMessage: vi.fn(), close: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
}

/**
 * The engine constructor and `KneadNodeResult` want real Web Audio nominal
 * types; the fakes match structurally. Both conversions are funnelled through
 * one helper each so the test bodies stay typed against the real interfaces.
 */
function asAudioContext(ctx: MockAudioContext): AudioContext {
    return ctx as unknown as AudioContext;
}

function asWorkletNode(node: FakeWorkletNode): AudioWorkletNode {
    return node as unknown as AudioWorkletNode;
}

type KneadDouble = {
    result: KneadNodeResult;
    /** The same node as `result.workletNode`, kept at its concrete type so a
     * test can drive its `connect` spy. */
    workletNode: FakeWorkletNode;
    resolveReady: (data: Record<string, unknown>) => void;
    rejectReady: (error: Error) => void;
};

function stubKneadNode(): KneadDouble {
    const ready = Promise.withResolvers<Record<string, unknown>>();
    const workletNode = new FakeWorkletNode();
    const result: KneadNodeResult = {
        workletNode: asWorkletNode(workletNode),
        setParam: vi.fn(),
        setBypass: vi.fn(),
        updateState: vi.fn(),
        destroy: vi.fn(),
        ready: ready.promise,
    };
    kneadFactory.createKneadNode.mockResolvedValue(result);
    return { result, workletNode, resolveReady: ready.resolve, rejectReady: ready.reject };
}

/** The single Knead device node currently occupying track `t1`'s strip. */
function kneadDeviceNode(engine: AudioEngine): BuiltinDeviceNode {
    const deviceNode = engine.getTrackStrip('t1')?.deviceNodes.find((device) => device.deviceId === 'knead-1');
    if (!deviceNode) {
        throw new Error('knead-1 is not on the strip');
    }
    return deviceNode;
}

/** Drain the descriptor's promise chain (factory → readiness → publish). */
async function settleDeviceLoad(): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

function kneadSnapshot(shift: number): Record<string, unknown> {
    return { 'clip-1': { shift, startBeat: 0, endBeat: 4 } };
}

describe('Knead state synced while its device is still loading', () => {
    let engine: AudioEngineTopologyTestHarness;
    let mockCtx: MockAudioContext;

    beforeEach(() => {
        vi.clearAllMocks();
        mockCtx = createMockAudioContext();
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        engine = createAudioEngine(asAudioContext(mockCtx));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // `syncKneadToEngine` pushes on every trackStore mutation, and adding the
    // Knead device *is* that mutation — so the only push for a freshly added
    // device lands while its WASM node is still loading. Nothing re-pushes on
    // load, so a dropped write leaves the clip playing unshifted until the user
    // happens to edit something else.
    it('hands state written during the load to the engine once it is ready', async () => {
        const knead = stubKneadNode();
        engine.addDeviceToStrip('t1', 'knead-1', 'knead');

        engine.syncKneadState('t1', kneadSnapshot(2));
        expect(knead.result.updateState).not.toHaveBeenCalled();

        knead.resolveReady({ latency: 0 });
        await settleDeviceLoad();

        expect(knead.result.updateState).toHaveBeenCalledTimes(1);
        expect(knead.result.updateState).toHaveBeenCalledWith(kneadSnapshot(2));
    });

    // The payload is a whole-track clip snapshot, not a delta, so the newest one
    // is the only one worth keeping: replaying an older snapshot after it would
    // undo edits made later in the same load.
    it('replays only the last snapshot written during the load', async () => {
        const knead = stubKneadNode();
        engine.addDeviceToStrip('t1', 'knead-1', 'knead');

        engine.syncKneadState('t1', kneadSnapshot(2));
        engine.syncKneadState('t1', kneadSnapshot(-5));

        knead.resolveReady({ latency: 0 });
        await settleDeviceLoad();

        expect(knead.result.updateState).toHaveBeenCalledTimes(1);
        expect(knead.result.updateState).toHaveBeenCalledWith(kneadSnapshot(-5));
    });

    it('keeps delivering state to the loaded engine after the swap', async () => {
        const knead = stubKneadNode();
        engine.addDeviceToStrip('t1', 'knead-1', 'knead');
        knead.resolveReady({ latency: 0 });
        await settleDeviceLoad();

        engine.syncKneadState('t1', kneadSnapshot(7));

        expect(knead.result.updateState).toHaveBeenLastCalledWith(kneadSnapshot(7));
    });

    // Removing the device aborts the load; `waitForDeviceReady` then returns
    // null after destroying the half-built node. Replaying into it would post to
    // a closed worklet port, so the latch has to stay behind the readiness gate.
    it('does not replay into a node whose load was aborted', async () => {
        const knead = stubKneadNode();
        engine.addDeviceToStrip('t1', 'knead-1', 'knead');
        engine.syncKneadState('t1', kneadSnapshot(2));

        engine.removeDeviceFromStrip('t1', 'knead-1');
        knead.resolveReady({ latency: 0 });
        await settleDeviceLoad();

        expect(knead.result.updateState).not.toHaveBeenCalled();
        expect(knead.result.destroy).toHaveBeenCalled();
    });

    // Promotion is not permanent. `completePendingDeviceLoad` schedules the
    // rebuild in a microtask that still sees a resolved pending load, so a
    // throwing `rebuildChain` runs `rollbackPromotedDevice`, which puts *this
    // exact placeholder object* back on the strip and destroys the real node.
    // From then on every `syncKneadState` lands on the placeholder's
    // `kneadControls` for the lifetime of the track. If the success path only
    // nulls `pendingState` and leaves the capturing closure installed, each of
    // those writes re-pins a whole-track clip snapshot — note blobs and their
    // per-blob `pitchCurveCents` included — with the load promise long settled
    // and nothing left to drain it.
    it('stops the placeholder latch capturing once the load resolves, even after a rollback puts it back', async () => {
        const knead = stubKneadNode();
        engine.addDeviceToStrip('t1', 'knead-1', 'knead');
        const placeholder = kneadDeviceNode(engine);
        const latchDuringLoad = placeholder.kneadControls?.updateState;

        engine.syncKneadState('t1', kneadSnapshot(2));

        // Only `rebuildChain` reaches the promoted node's `connect`; the
        // promotion itself never does, so the throw lands in the scheduled
        // microtask rather than inside `completePendingDeviceLoad`'s own try.
        knead.workletNode.connect.mockImplementation(() => {
            throw new Error('graph rebuild failed');
        });
        knead.resolveReady({ latency: 0 });
        await settleDeviceLoad();

        // The reference under test is demonstrably the capturing one: it is
        // what latched the snapshot that was just replayed.
        expect(knead.result.updateState).toHaveBeenCalledWith(kneadSnapshot(2));
        // ...and the rollback really did reinstate that same placeholder.
        expect(kneadDeviceNode(engine)).toBe(placeholder);
        expect(placeholder.kneadControls?.ready).toBe(false);
        expect(knead.result.destroy).toHaveBeenCalled();

        const latchAfterRollback = placeholder.kneadControls?.updateState;
        engine.syncKneadState('t1', kneadSnapshot(9));

        expect(latchAfterRollback).not.toBe(latchDuringLoad);
        // Inert, not merely re-wrapped: the write above changed nothing.
        expect(placeholder.kneadControls?.updateState).toBe(latchAfterRollback);
    });

    // A readiness rejection destroys the node inside `waitForDeviceReady` and
    // rethrows into the descriptor's catch. Same gate, different failure.
    it('does not replay into a node whose readiness rejected', async () => {
        const knead = stubKneadNode();
        engine.addDeviceToStrip('t1', 'knead-1', 'knead');
        engine.syncKneadState('t1', kneadSnapshot(2));

        knead.rejectReady(new Error('knead wasm init failed'));
        await settleDeviceLoad();

        expect(knead.result.updateState).not.toHaveBeenCalled();
        expect(knead.result.destroy).toHaveBeenCalled();
    });
});
