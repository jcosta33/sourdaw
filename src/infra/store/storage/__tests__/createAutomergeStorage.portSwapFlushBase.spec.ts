import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '../createAutomergeStorage';

type SlotState = { readonly amp: number; readonly pan: number };

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const BASE_VALUE: SlotState = { amp: 0.2, pan: 0.5 };

const createTestPort = (getDoc: () => TestDoc): TestPort => ({
    getDoc,
    getSemanticMessage: () => undefined,
    hasDoc: () => true,
    mutateDoc: ({ changeFn }) => {
        changeFn(getDoc());
    },
});

/**
 * The port-swap flush-base contract: when `configureAutomergeStoragePort`
 * swaps the backend underneath a pending write, the pending's presence
 * snapshot described the outgoing document, which no longer exists. Its flush
 * must therefore claim a null base — every field is this writer's delta and no
 * absence is decided against a document it never saw — while the pending's own
 * base stands untouched, because it is the provenance the hydrate three-way
 * rebase attributes this writer's delta with. Two ways to break it, pinned
 * separately below: flushing through the stale base decides absence against a
 * document nobody saw and skips the full-value write, and nulling the
 * pending's base recasts document content the pending merely absorbed as this
 * writer's edit.
 */
describe('createAutomergeStorage port-swap flush base', () => {
    let frames: FrameRequestCallback[];

    beforeEach(() => {
        frames = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        resetAutomergeStorageProjections('root');
        configureAutomergeStoragePort(null);
        flushAutomergeStorageWrites();
        vi.unstubAllGlobals();
    });

    it('flushes a port-swapped pending as the full value into a document that lacks the slot', () => {
        const outgoingDoc: TestDoc = { slot: BASE_VALUE };
        configureAutomergeStoragePort(createTestPort(() => outgoingDoc));
        const storage = createAutomergeStorage<SlotState>('root', 'slot');
        expect(storage.hydrate?.()).toBe(true);

        // A set whose value already equals the cache: the stranded-seed shape.
        // Only the absence decision distinguishes landing the full value from
        // skipping it, so this is the exact write a corrupted flush base loses.
        // The mutation clones before reconciling, so identity equality still
        // exercises the base-versus-desired deep-equality skip path.
        storage.set(BASE_VALUE);

        // The swap drops the presence snapshot and marks the flush base
        // unknown — the incoming document is one this write has never seen.
        const incomingDoc: TestDoc = {};
        configureAutomergeStoragePort(createTestPort(() => incomingDoc));

        flushAutomergeStorageWrites();

        expect(incomingDoc.slot).toEqual(BASE_VALUE);
        expect(storage.get()).toEqual(BASE_VALUE);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('keeps a port-swapped pending base as three-way rebase provenance when the port swaps back', () => {
        const doc: TestDoc = { slot: BASE_VALUE };
        configureAutomergeStoragePort(createTestPort(() => doc));
        const storage = createAutomergeStorage<SlotState>('root', 'slot', {
            rebasePending: rebaseThreeWay,
        });
        expect(storage.hydrate?.()).toBe(true);

        // The local edit touches `amp` only; `pan` is carried unchanged from
        // the base the pending was created with.
        storage.set({ amp: 0.8, pan: 0.5 });

        // Swap away — the pending survives, its flush base unknown — and back
        // onto the same document, which a peer moved onto a newer `pan` in the
        // meantime. Each swap is a fresh port object, so both fire.
        const awayDoc: TestDoc = {};
        configureAutomergeStoragePort(createTestPort(() => awayDoc));
        doc.slot = { amp: 0.2, pan: 0.9 };
        configureAutomergeStoragePort(createTestPort(() => doc));

        expect(storage.hydrate?.()).toBe(true);

        // The rebase keeps the local amp edit and the remote pan value: the
        // base says pan was never this writer's edit. A flush-null that had
        // consumed the base would have replayed the stale pan over the peer.
        expect(storage.get()).toEqual({ amp: 0.8, pan: 0.9 });

        // The rebased pending then flushes as a clean delta against its
        // re-anchored base, landing only the field this writer changed.
        flushAutomergeStorageWrites();
        expect(doc.slot).toEqual({ amp: 0.8, pan: 0.9 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });
});

/**
 * Three-way field merge, the law the collaboration slots carry: a pending
 * field its base says it did not touch defers to the hydrated remote value; a
 * field its base proves it changed is this writer's edit and stands. With a
 * null base every pending field counts as this writer's edit, which is
 * exactly how a corrupted provenance base betrays the remote value — the hook
 * stays this simple so the assertions above read as the base's verdict alone.
 */
function rebaseThreeWay(input: {
    baseValue: SlotState | null;
    pendingValue: SlotState | null;
    hydratedValue: SlotState;
}): SlotState {
    const { baseValue, pendingValue, hydratedValue } = input;
    if (pendingValue === null) {
        return hydratedValue;
    }
    const base: Readonly<Record<string, unknown>> | null = baseValue;
    const localEdits: Record<string, unknown> = {};
    for (const [field, pendingField] of Object.entries(pendingValue)) {
        const unchangedLocally = base !== null && Object.hasOwn(base, field) && Object.is(base[field], pendingField);
        if (!unchangedLocally) {
            localEdits[field] = pendingField;
        }
    }
    // Assembled from the hydrated shape plus the writer's own edits; every
    // override is a scalar the pending already carried.
    return { ...hydratedValue, ...localEdits };
}
