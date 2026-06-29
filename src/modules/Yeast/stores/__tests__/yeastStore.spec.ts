import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { YeastWorkletNodeResult } from '../../engine/YeastWorkletNode';

/**
 * A fake worklet node that records every mutation method call in order, so a
 * test can assert exactly what the store replayed onto it after the worklet
 * finished initializing.
 */
type Recorded =
    | { m: 'addProcessor'; args: [string, string] }
    | { m: 'removeProcessor'; args: [string] }
    | { m: 'reorder'; args: [number, number] }
    | { m: 'setParam'; args: [string, string, number] }
    | { m: 'setBypass'; args: [string, boolean] };

function makeFakeNode(ctx: BaseAudioContext): { node: YeastWorkletNodeResult; calls: Recorded[] } {
    const calls: Recorded[] = [];
    const node: YeastWorkletNodeResult = {
        context: ctx,
        processBlock: () => Promise.resolve([]),
        addProcessor: (type, id) => {
            calls.push({ m: 'addProcessor', args: [type, id] });
        },
        removeProcessor: (id) => {
            calls.push({ m: 'removeProcessor', args: [id] });
        },
        reorder: (from, to) => {
            calls.push({ m: 'reorder', args: [from, to] });
        },
        setParam: (id, name, value) => {
            calls.push({ m: 'setParam', args: [id, name, value] });
        },
        setBypass: (id, bypassed) => {
            calls.push({ m: 'setBypass', args: [id, bypassed] });
        },
        allNotesOff: () => {},
        onNotesOff: () => () => {},
        destroy: () => {},
    };
    return { node, calls };
}

// A controllable deferred so a test owns when worklet init resolves.
let resolveCreate: ((node: YeastWorkletNodeResult) => void) | null = null;
let rejectCreate: ((err: Error) => void) | null = null;
const createYeastWorkletNodeMock = vi.fn<() => Promise<YeastWorkletNodeResult>>();

vi.mock('../../engine/YeastWorkletNode', () => ({
    createYeastWorkletNode: (): Promise<YeastWorkletNodeResult> => createYeastWorkletNodeMock(),
}));

const fakeCtx = {} as unknown as BaseAudioContext;

type StoreModule = typeof import('../yeastStore');

async function freshStore(): Promise<StoreModule> {
    vi.resetModules();
    return import('../yeastStore');
}

beforeEach(() => {
    createYeastWorkletNodeMock.mockReset();
    resolveCreate = null;
    rejectCreate = null;
    createYeastWorkletNodeMock.mockImplementation(
        () =>
            new Promise<YeastWorkletNodeResult>((resolve, reject) => {
                resolveCreate = resolve;
                rejectCreate = reject;
            })
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('getWorkletNodeSync — buffering during init', () => {
    it('returns null before any worklet is requested', async () => {
        const store = await freshStore();
        expect(store.getWorkletNodeSync()).toBeNull();
    });

    it('replays setParam/setBypass issued during init onto the worklet on resolve', async () => {
        const store = await freshStore();
        const { node, calls } = makeFakeNode(fakeCtx);

        // Kick off init; the create Promise is now in flight (not resolved).
        const pending = store.getYeastWorkletNodeAsync(fakeCtx);

        // While init is in flight, getWorkletNodeSync hands back a recorder.
        const sync = store.getWorkletNodeSync();
        expect(sync).not.toBeNull();

        // Mutations applied during init — these are lost without buffering.
        sync!.setParam('arp-1', 'rate', 4);
        sync!.setBypass('arp-1', true);

        // Nothing should have reached the real node yet.
        expect(calls).toEqual([]);

        // Worklet finishes initializing.
        resolveCreate!(node);
        await pending;

        // The buffered ops were replayed, in issue order. (reorder is NOT
        // buffered — the resolve handler reconciles chain order from the rack's
        // id order; with no processors in the rack here there is nothing to move.)
        expect(calls).toEqual([
            { m: 'setParam', args: ['arp-1', 'rate', 4] },
            { m: 'setBypass', args: ['arp-1', true] },
        ]);
    });

    it('returns the live node after init resolves (no recorder)', async () => {
        const store = await freshStore();
        const { node, calls } = makeFakeNode(fakeCtx);

        const pending = store.getYeastWorkletNodeAsync(fakeCtx);
        resolveCreate!(node);
        await pending;

        const sync = store.getWorkletNodeSync();
        expect(sync).toBe(node);
        sync!.setParam('x', 'y', 1);
        // Goes straight to the live node, not the buffer.
        expect(calls).toEqual([{ m: 'setParam', args: ['x', 'y', 1] }]);
    });

    it('replays added processors (type map) before buffered param/bypass ops', async () => {
        const store = await freshStore();
        const { node, calls } = makeFakeNode(fakeCtx);

        // Register a processor type (as addYeastProcessor would) before init.
        store.registerProcessorType('arp-1', 'arpeggiator');

        const pending = store.getYeastWorkletNodeAsync(fakeCtx);
        store.getWorkletNodeSync()!.setBypass('arp-1', true);

        resolveCreate!(node);
        await pending;

        // addProcessor (from the type map) is replayed first, then the buffered op.
        expect(calls).toEqual([
            { m: 'addProcessor', args: ['arpeggiator', 'arp-1'] },
            { m: 'setBypass', args: ['arp-1', true] },
        ]);
    });

    it('drops buffered ops and returns null when worklet init fails', async () => {
        const store = await freshStore();

        const pending = store.getYeastWorkletNodeAsync(fakeCtx);
        store.getWorkletNodeSync()!.setParam('arp-1', 'rate', 4);

        rejectCreate!(new Error('worklet boom'));
        await expect(pending).resolves.toBeNull();

        // After failure the main-thread rack is authoritative; no recorder.
        expect(store.getWorkletNodeSync()).toBeNull();

        // A later successful init must NOT replay the stale buffered op.
        const { node, calls } = makeFakeNode(fakeCtx);
        const second = store.getYeastWorkletNodeAsync(fakeCtx);
        resolveCreate!(node);
        await second;
        expect(calls).toEqual([]);
    });
});

describe('getYeastWorkletNodeAsync — context swap during init (obs #2)', () => {
    it('does not return the in-flight promise bound to the old ctx when the ctx changes mid-init', async () => {
        const store = await freshStore();

        // Two distinct AudioContexts; the second arrives while the first is in
        // flight (the addModule+construct window).
        const ctxA = { id: 'A' } as unknown as BaseAudioContext;
        const ctxB = { id: 'B' } as unknown as BaseAudioContext;

        // Capture each createYeastWorkletNode call's deferred separately so the
        // test owns when each resolves.
        const deferreds: Array<{ resolve: (n: YeastWorkletNodeResult) => void }> = [];
        createYeastWorkletNodeMock.mockImplementation(
            () =>
                new Promise<YeastWorkletNodeResult>((resolve) => {
                    deferreds.push({ resolve });
                })
        );

        // Kick off init against ctxA — now in flight.
        const pendingA = store.getYeastWorkletNodeAsync(ctxA);
        expect(deferreds).toHaveLength(1);

        // ctx swaps to ctxB while ctxA is still resolving. The bug: the in-flight
        // branch returned the stale ctxA promise (no ctx comparison), so the
        // node would be bound to the wrong BaseAudioContext. The fix starts a
        // fresh creation against ctxB.
        const pendingB = store.getYeastWorkletNodeAsync(ctxB);
        expect(pendingB).not.toBe(pendingA);
        expect(deferreds).toHaveLength(2);

        // Resolve ctxA's stale creation: its node must NOT become the live node,
        // and it must be torn down (destroy called) rather than bound. Before the
        // fix, pendingA === pendingB, so resolving ctxA bound nodeA as the live
        // node against the wrong context.
        const { node: nodeA } = makeFakeNode(ctxA);
        let nodeADestroyed = false;
        nodeA.destroy = () => {
            nodeADestroyed = true;
        };
        deferreds[0]!.resolve(nodeA);
        const resolvedA = await pendingA;
        expect(resolvedA).toBeNull();
        expect(nodeADestroyed).toBe(true);

        // Resolve ctxB's creation: it binds against the current ctx.
        const { node: nodeB } = makeFakeNode(ctxB);
        deferreds[1]!.resolve(nodeB);
        const resolvedB = await pendingB;
        expect(resolvedB).toBe(nodeB);
        expect(store.getWorkletNodeSync()).toBe(nodeB);
        expect(nodeB.context).toBe(ctxB);
    });
});

describe('reorderYeastProcessor — worklet mirror', () => {
    it('mirrors a reorder to the worklet so both racks share processor order', async () => {
        vi.resetModules();
        const store = await import('../yeastStore');
        // The use case must resolve getWorkletNodeSync from the SAME module
        // instance imported after this resetModules call.
        const { reorderYeastProcessor } = await import('../../useCases/reorderYeastProcessor');
        const { node, calls } = makeFakeNode(fakeCtx);

        // Begin init so getWorkletNodeSync yields the buffering recorder.
        const pending = store.getYeastWorkletNodeAsync(fakeCtx);

        // Before this fix, reorderYeastProcessor touched only the main-thread
        // rack — never the worklet — so the two racks could diverge in order.
        reorderYeastProcessor(0, 1);

        resolveCreate!(node);
        await pending;

        // The reorder is no longer mirrored verbatim during init; instead the
        // resolve handler reconciles the worklet chain to the rack's id order.
        // With no processors registered, that reconcile is a no-op — the
        // post-fix contract is verified end-to-end by the reconcile test below.
        expect(calls.filter((c) => c.m === 'reorder')).toEqual([]);
    });
});

describe('worklet-init order reconcile — reorder/remove interleave (MINOR-4)', () => {
    /** Minimal processor the rack accepts; only id/order matter for this test. */
    function fakeProcessor(id: string) {
        return {
            id,
            name: id,
            processMidi: () => {},
            reset: () => [],
            setBypassed: () => {},
            isBypassed: () => false,
            setParam: () => {},
            latencySamples: () => 0,
        };
    }

    it('reconciles the worklet chain to the rack id order when a reorder and a remove interleave during init', async () => {
        const store = await freshStore();
        const { node, calls } = makeFakeNode(fakeCtx);

        const rack = store.getYeastRack();
        // Build a 4-processor chain: a b c d. Register each type so the
        // add-replay (which iterates processorTypeMap) knows to add them.
        for (const id of ['a', 'b', 'c', 'd']) {
            rack.addProcessor(fakeProcessor(id) as unknown as Parameters<typeof rack.addProcessor>[0]);
            store.registerProcessorType(id, 'arpeggiator');
        }

        // Begin init: the worklet is in flight, so the recorder buffers nothing
        // useful for order — reorders/removes only touch the main-thread rack.
        const pending = store.getYeastWorkletNodeAsync(fakeCtx);

        // Interleave a reorder and a remove on the rack during init. After this:
        //   start:        a b c d
        //   reorder(0,3): b c d a
        //   remove b:     c d a   (also unregister its type)
        rack.reorder(0, 3);
        store.getWorkletNodeSync()!.reorder(0, 3); // recorder no-op post-fix
        rack.removeProcessor('b');
        store.unregisterProcessorType('b');
        store.getWorkletNodeSync()!.removeProcessor('b'); // recorder no-op

        expect(rack.getProcessorIds()).toEqual(['c', 'd', 'a']);

        resolveCreate!(node);
        await pending;

        // Reconstruct the worklet chain order from the replayed add + reorder
        // calls and assert it matches the rack's authoritative id order. A raw
        // (fromIdx,toIdx) replay would diverge here because the remove shifted
        // the indices the reorder was recorded against.
        const worklet: string[] = [];
        for (const c of calls) {
            if (c.m === 'addProcessor') {
                worklet.push(c.args[1]);
            } else if (c.m === 'reorder') {
                const [from, to] = c.args;
                const [moved] = worklet.splice(from, 1);
                worklet.splice(to, 0, moved!);
            }
        }
        expect(worklet).toEqual(['c', 'd', 'a']);
    });
});
