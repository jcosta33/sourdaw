import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

// Audit CC-5 / CC-7 — the two non-committing terminals of a pending write.
//
// `recordCommittedWrite` (commit) and `abortPendingWrite` (abort) both
// recompute the visible value and re-notify subscribers. The other two exits
// did not:
//   * CC-5 `didDiscard` — reached when `prepare()` returns null. Sound for the
//     superseded-unscoped trigger, but for the doc-absent trigger it left the
//     cache serving an optimistic value that never reached the document.
//   * CC-7 `preparationFailed` — reached when `prepare()` throws. The pending
//     was left in the write set with its animation frame already cancelled and
//     never re-armed, so the adapter stopped persisting entirely.
//
// Both are the same invariant: a write that did not reach the document must
// not leave the cache claiming that it did.

type TestDoc = { [key: string]: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

type TestPortHandle = {
    doc: TestDoc;
    port: TestPort;
    setHasDoc: (value: boolean) => void;
};

function createTestPort(): TestPortHandle {
    const doc: TestDoc = {};
    let hasDoc = true;
    return {
        doc,
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => hasDoc,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
            },
        },
        setHasDoc: (value) => {
            hasDoc = value;
        },
    };
}

describe('createAutomergeStorage — non-committing write terminals', () => {
    // A faithful animation-frame queue: only callbacks that are still armed
    // run. A stale handle that `cancelAnimationFrame` removed must never fire,
    // which is exactly what makes the CC-7 orphan observable.
    let armedFrames: Map<number, FrameRequestCallback>;
    let nextFrameHandle: number;

    const runArmedFrames = (): void => {
        const due = [...armedFrames.entries()];
        armedFrames.clear();
        for (const [, callback] of due) {
            callback(0);
        }
    };

    beforeEach(() => {
        armedFrames = new Map();
        nextFrameHandle = 1;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            const handle = nextFrameHandle;
            nextFrameHandle += 1;
            armedFrames.set(handle, callback);
            return handle;
        });
        vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
            armedFrames.delete(handle);
        });
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    describe('deferred pre-authority seed', () => {
        it('keeps a seed visible when the port appears before a document exists', () => {
            const { doc, port, setHasDoc } = createTestPort();
            const storage = createAutomergeStorage<{ count: number }>('root', 'state');

            storage.set({ count: 1 });
            setHasDoc(false);
            configureAutomergeStoragePort(port);

            flushAutomergeStorageWrites();

            expect(Object.hasOwn(doc, 'state')).toBe(false);
            expect(storage.get()).toEqual({ count: 1 });

            storage.set({ count: 2 });
            flushAutomergeStorageWrites();
            expect(storage.get()).toEqual({ count: 2 });

            setHasDoc(true);
            storage.set({ count: 3 });
            runArmedFrames();

            expect(doc.state).toEqual({ count: 3 });
            expect(storage.get()).toEqual({ count: 3 });
        });
    });

    describe('discarded write (audit CC-5)', () => {
        it('rolls the cache back to the last committed value when the document is absent', () => {
            const { doc, port, setHasDoc } = createTestPort();
            configureAutomergeStoragePort(port);
            const storage = createAutomergeStorage<{ count: number }>('root', 'state');
            const notified: Array<{ count: number } | null> = [];
            storage.subscribe?.(() => {
                notified.push(storage.get());
            });

            storage.set({ count: 1 });
            flushAutomergeStorageWrites();
            expect(doc.state).toEqual({ count: 1 });

            // Authority dropped away between a project reset and the next load,
            // so `createMutation` cannot reach a document and returns null.
            setHasDoc(false);
            storage.set({ count: 2 });
            expect(storage.get()).toEqual({ count: 2 });

            flushAutomergeStorageWrites();

            // The optimistic value never reached the document…
            expect(doc.state).toEqual({ count: 1 });
            // …so the adapter must stop serving it and re-notify subscribers.
            expect(storage.get()).toEqual({ count: 1 });
            expect(notified.at(-1)).toEqual({ count: 1 });
        });

        it('stays silent when the discarded write was merely superseded', () => {
            // The superseded-unscoped trigger is already sound: the discarded
            // pending is not the visible value, so recomputing must not
            // produce a spurious notification. This pins that the CC-5 fix
            // does not turn a correct quiet discard into a UI churn source.
            const { doc, port } = createTestPort();
            configureAutomergeStoragePort(port);
            const storage = createAutomergeStorage<{ count: number }>('root', 'state');

            storage.set({ count: 1 });

            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                storage.set({ count: 2 });
            });
            transaction.commit();
            expect(doc.state).toEqual({ count: 2 });

            const notifiedAfterCommit: Array<{ count: number } | null> = [];
            storage.subscribe?.(() => {
                notifiedAfterCommit.push(storage.get());
            });

            // The older unscoped pending now flushes and is correctly skipped.
            flushAutomergeStorageWrites();

            expect(doc.state).toEqual({ count: 2 });
            expect(storage.get()).toEqual({ count: 2 });
            expect(notifiedAfterCommit).toEqual([]);
        });
    });

    describe('failed preparation (audit CC-7)', () => {
        it('keeps persisting later writes after a serialization failure', () => {
            const { doc, port } = createTestPort();
            configureAutomergeStoragePort(port);
            let serializationFails = false;
            const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
                toCrdt: (value) => {
                    if (serializationFails) {
                        throw new Error('value is not serializable');
                    }
                    return value;
                },
            });

            storage.set({ count: 1 });
            runArmedFrames();
            expect(doc.state).toEqual({ count: 1 });

            serializationFails = true;
            storage.set({ count: 2 });
            expect(() => {
                flushAutomergeStorageWrites();
            }).toThrow('value is not serializable');

            // The failed write cannot ever reach the document, so the adapter
            // must not keep serving it as though it had.
            expect(storage.get()).toEqual({ count: 1 });

            // Recovery: a later, serializable write must still persist through
            // the ordinary animation-frame path. The orphaned pending used to
            // occupy the owner slot with a cancelled frame, so no later write
            // ever armed a frame again and the store silently stopped saving.
            serializationFails = false;
            storage.set({ count: 3 });
            runArmedFrames();

            expect(doc.state).toEqual({ count: 3 });
            expect(storage.get()).toEqual({ count: 3 });
        });

        it('surfaces the preparation failure to a scoped transaction commit', () => {
            const { doc, port } = createTestPort();
            configureAutomergeStoragePort(port);
            const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
                toCrdt: () => {
                    throw new Error('value is not serializable');
                },
            });

            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                storage.set({ count: 1 });
            });

            expect(() => {
                transaction.commit();
            }).toThrow('value is not serializable');
            expect(Object.hasOwn(doc, 'state')).toBe(false);
            expect(storage.get()).toBeNull();
        });
    });
});
