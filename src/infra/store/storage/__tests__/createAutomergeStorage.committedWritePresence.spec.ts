import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

type SlotState = Record<string, number>;

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const createTestPort = (doc: TestDoc): TestPort => ({
    getDoc: () => doc,
    getSemanticMessage: () => undefined,
    hasDoc: () => true,
    mutateDoc: ({ changeFn }) => {
        changeFn(doc);
    },
});

/**
 * The committed-write re-anchor contract: when one pending's commit re-anchors
 * the adapter's other pendings, the fresh `baseValue` and the fresh presence
 * snapshot describe the same document instant. The stale-presence mutation —
 * `remaining.baseDocumentPresence = remaining.baseDocumentPresence ??
 * baseDocumentPresence` — keeps a snapshot from before the intervening commit
 * while the base moves to after it, and this is the shape that catches it: the
 * re-anchored pending's flush then reads the peer's newer deletion through a
 * document that (at its base moment) held the slot, treats the row as its own
 * stranded seed, and resurrects what a peer dropped. With the fresh snapshot
 * the same absence is a peer deletion that stands.
 */
describe('createAutomergeStorage committed-write presence refresh', () => {
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

    it('flushes a re-anchored pending against the presence of its re-anchor moment, not its creation', () => {
        const doc: TestDoc = {};
        configureAutomergeStoragePort(createTestPort(doc));
        const storage = createAutomergeStorage<SlotState>('root', 'slot');

        // The foreign pending is created while the document lacks the slot, so
        // its creation-time snapshot proves an absence. It stays unflushed.
        const foreign = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ a: 1, x: 2 });
        });

        // The intervening commit lands the slot and re-anchors the foreign
        // pending: its base becomes the post-commit projection, and its
        // presence must be captured from that same post-commit document —
        // which now holds the slot.
        const current = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ a: 1, x: 2 });
        });
        current.commit();
        expect(doc.slot).toEqual({ a: 1, x: 2 });

        // A peer deletes the whole slot after the re-anchor moment.
        delete doc.slot;

        // The re-anchored pending flushes its unchanged copy: the base and the
        // fresh snapshot agree the document held the slot when the base was
        // captured, so the absence is a peer's newer deletion and stands. A
        // stale creation-time snapshot would read the absence as proven-never,
        // take the copy for this writer's own stranded seed, and resurrect
        // the deleted slot.
        foreign.commit();

        expect(doc.slot).toBeUndefined();
        expect(storage.get()).toBeNull();
    });
});
