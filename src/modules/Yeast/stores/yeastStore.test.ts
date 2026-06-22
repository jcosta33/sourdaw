import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { YeastWorkletNodeResult } from '../engine/YeastWorkletNode';

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
        destroy: () => {},
    };
    return { node, calls };
}

// A controllable deferred so a test owns when worklet init resolves.
let resolveCreate: ((node: YeastWorkletNodeResult) => void) | null = null;
let rejectCreate: ((err: Error) => void) | null = null;
const createYeastWorkletNodeMock = vi.fn<() => Promise<YeastWorkletNodeResult>>();

vi.mock('../engine/YeastWorkletNode', () => ({
    createYeastWorkletNode: (): Promise<YeastWorkletNodeResult> => createYeastWorkletNodeMock(),
}));

const fakeCtx = {} as unknown as BaseAudioContext;

type StoreModule = typeof import('./yeastStore');

async function freshStore(): Promise<StoreModule> {
    vi.resetModules();
    return import('./yeastStore');
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

    it('replays setParam/setBypass/reorder issued during init onto the worklet on resolve', async () => {
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
        sync!.reorder(1, 0);

        // Nothing should have reached the real node yet.
        expect(calls).toEqual([]);

        // Worklet finishes initializing.
        resolveCreate!(node);
        await pending;

        // The buffered ops were replayed, in issue order.
        expect(calls).toEqual([
            { m: 'setParam', args: ['arp-1', 'rate', 4] },
            { m: 'setBypass', args: ['arp-1', true] },
            { m: 'reorder', args: [1, 0] },
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

describe('reorderYeastProcessor — worklet mirror', () => {
    it('mirrors a reorder to the worklet so both racks share processor order', async () => {
        vi.resetModules();
        const store = await import('./yeastStore');
        // The use case must resolve getWorkletNodeSync from the SAME module
        // instance imported after this resetModules call.
        const { reorderYeastProcessor } = await import('../useCases/reorderYeastProcessor');
        const { node, calls } = makeFakeNode(fakeCtx);

        // Begin init so getWorkletNodeSync yields the buffering recorder.
        const pending = store.getYeastWorkletNodeAsync(fakeCtx);

        // Before this fix, reorderYeastProcessor touched only the main-thread
        // rack — never the worklet — so the two racks could diverge in order.
        reorderYeastProcessor(0, 1);

        resolveCreate!(node);
        await pending;

        expect(calls).toContainEqual({ m: 'reorder', args: [0, 1] });
    });
});
