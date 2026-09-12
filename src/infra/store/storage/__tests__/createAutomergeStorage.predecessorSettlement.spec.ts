import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AutomergeStorageSnapshotTransactionBlockedError,
    AutomergeStorageWriteConflictError,
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    getCurrentAutomergeStorageMutationOwner,
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

type State = { readonly items: readonly string[]; readonly selected: string | null };
type Operation =
    | { readonly kind: 'insert'; readonly item: string }
    | { readonly kind: 'remove'; readonly item: string }
    | { readonly kind: 'select'; readonly expected: string | null; readonly replacement: string | null };

function captureOperations(before: State | null, next: State | null): readonly Operation[] {
    if (!before || !next) {
        return [];
    }
    const operations: Operation[] = before.items
        .filter((item) => !next.items.includes(item))
        .map((item) => ({ kind: 'remove', item }));
    operations.push(
        ...next.items.filter((item) => !before.items.includes(item)).map((item) => ({ kind: 'insert' as const, item }))
    );
    if (before.selected !== next.selected) {
        operations.push({ kind: 'select', expected: before.selected, replacement: next.selected });
    }
    return operations;
}

function replayOperations(authority: State, operations: readonly Operation[]): State | null {
    let result: State = structuredClone(authority);
    for (const operation of operations) {
        if (operation.kind === 'insert') {
            if (result.items.includes(operation.item)) {
                return null;
            }
            result = { ...result, items: [...result.items, operation.item] };
            continue;
        }
        if (operation.kind === 'remove') {
            if (!result.items.includes(operation.item)) {
                return null;
            }
            result = { ...result, items: result.items.filter((item) => item !== operation.item) };
            continue;
        }
        if (result.selected !== operation.expected) {
            return null;
        }
        if (operation.replacement !== null && !result.items.includes(operation.replacement)) {
            return null;
        }
        result = { ...result, selected: operation.replacement };
    }
    return result;
}

function createJournalStorage() {
    return createAutomergeStorage<State, readonly Operation[]>('root', 'state', {
        writeMetadata: {
            capture: ({ beforeValue, nextValue }) => captureOperations(beforeValue, nextValue),
            reduce: ({ current, captured }) => (current ? [...current, ...captured] : [...captured]),
        },
        rebasePending: ({ hydratedValue, metadata }) =>
            metadata ? (replayOperations(hydratedValue, metadata) ?? hydratedValue) : hydratedValue,
        mutateCrdtWithMetadata: ({ authorityValue, metadata, reconcile, value }) => {
            if (!authorityValue || !metadata) {
                reconcile(value, authorityValue);
                return;
            }
            const replayed = replayOperations(authorityValue, metadata);
            if (!replayed) {
                throw new AutomergeStorageWriteConflictError('journal conflict');
            }
            reconcile(replayed, authorityValue);
        },
    });
}

function createReplacementStorage() {
    return createAutomergeStorage<State, { readonly value: State | null }>('root', 'state', {
        writeMetadata: {
            capture: ({ nextValue }) => ({ value: structuredClone(nextValue) }),
            reduce: ({ captured }) => captured,
        },
        rebasePending: ({ metadata }) => structuredClone(metadata?.value ?? null),
        mutateCrdtWithMetadata: ({ authorityValue, metadata, reconcile }) => {
            reconcile(structuredClone(metadata?.value ?? null), authorityValue);
        },
    });
}

describe('createAutomergeStorage metadata predecessor settlement', () => {
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

    it('settles the private unscoped predecessor before the first scoped write and preserves peer state', () => {
        const doc: { state: State } = { state: { items: [], selected: null } };
        const mutations: Array<{
            message: string | undefined;
            owner: object | undefined;
            snapshotTransaction: object | undefined;
        }> = [];
        let message: string | undefined = 'Create A';
        let introducePeer = true;
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => message,
            hasDoc: () => true,
            mutateDoc: ({ changeFn, message: mutationMessage, snapshotTransaction }) => {
                if (introducePeer) {
                    introducePeer = false;
                    doc.state = { items: ['peer-b'], selected: null };
                }
                changeFn(doc);
                mutations.push({
                    message: mutationMessage,
                    owner: getCurrentAutomergeStorageMutationOwner(),
                    snapshotTransaction,
                });
            },
        });
        const storage = createJournalStorage();
        expect(storage.hydrate?.()).toBe(true);
        storage.set({ items: ['a'], selected: null });

        message = 'Select A';
        let scopedOwner: object | undefined;
        const snapshotTransaction = {};
        const transaction = runWithAutomergeStorageTransaction(snapshotTransaction, () => {
            scopedOwner = getCurrentAutomergeStorageMutationOwner();
            storage.set({ items: ['a'], selected: 'a' });
        });
        transaction.commit();

        expect(mutations).toEqual([
            { message: 'Create A', owner: undefined, snapshotTransaction: undefined },
            { message: 'Select A', owner: scopedOwner, snapshotTransaction },
        ]);
        expect(doc.state).toEqual({ items: ['peer-b', 'a'], selected: 'a' });
        expect(storage.get()).toEqual(doc.state);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('refuses a blocked scoped entry before installing its owner or changing the cache', () => {
        const doc: { state: State } = { state: { items: [], selected: null } };
        const mutateDoc = vi.fn();
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            isMutationBlockedBySnapshotTransaction: () => true,
            mutateDoc,
        });
        const storage = createJournalStorage();
        expect(storage.hydrate?.()).toBe(true);
        storage.set({ items: ['a'], selected: null });

        const transaction = runWithAutomergeStorageTransaction({}, () => {
            storage.set({ items: ['a'], selected: 'a' });
        });

        expect(transaction.status).toBe('threw');
        if (transaction.status !== 'threw') {
            throw new Error('Expected the scoped write to be refused');
        }
        expect(transaction.error).toBeInstanceOf(AutomergeStorageSnapshotTransactionBlockedError);
        expect(storage.get()).toEqual({ items: ['a'], selected: null });
        expect(countPendingAutomergeStorageWrites()).toBe(1);
        expect(mutateDoc).not.toHaveBeenCalled();
        transaction.abort();
    });

    it('preflights every selected owner before a global flush claims any write', () => {
        const doc: Record<string, unknown> = {};
        const mutateDoc = vi.fn();
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            isMutationBlockedBySnapshotTransaction: (docId) => docId === 'blocked',
            mutateDoc,
        });
        const admitted = createAutomergeStorage<{ count: number }>('admitted', 'state');
        const blocked = createAutomergeStorage<{ count: number }>('blocked', 'state');
        admitted.set({ count: 1 });
        blocked.set({ count: 2 });

        expect(() => flushAutomergeStorageWrites()).toThrow(AutomergeStorageSnapshotTransactionBlockedError);

        expect(mutateDoc).not.toHaveBeenCalled();
        expect(countPendingAutomergeStorageWrites()).toBe(2);
        expect(admitted.get()).toEqual({ count: 1 });
        expect(blocked.get()).toEqual({ count: 2 });
        expect(cancelAnimationFrame).not.toHaveBeenCalled();
        resetAutomergeStorageProjections('admitted');
        resetAutomergeStorageProjections('blocked');
    });

    it('settles no foreign scoped owner and preserves a later unscoped successor', () => {
        const doc: { state: State } = { state: { items: [], selected: null } };
        const mutationOwners: Array<object | undefined> = [];
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
                mutationOwners.push(getCurrentAutomergeStorageMutationOwner());
            },
        });
        const storage = createJournalStorage();
        expect(storage.hydrate?.()).toBe(true);
        let foreignOwner: object | undefined;
        const foreign = runWithAutomergeStorageTransaction(undefined, () => {
            foreignOwner = getCurrentAutomergeStorageMutationOwner();
            storage.set({ items: ['foreign-a'], selected: null });
        });
        storage.set({ items: ['foreign-a', 'unscoped-b'], selected: null });
        let currentOwner: object | undefined;
        const current = runWithAutomergeStorageTransaction(undefined, () => {
            currentOwner = getCurrentAutomergeStorageMutationOwner();
            storage.set({ items: ['foreign-a', 'unscoped-b'], selected: 'unscoped-b' });
        });

        expect(mutationOwners).toEqual([undefined]);
        expect(countPendingAutomergeStorageWrites()).toBe(2);
        current.commit();
        expect(mutationOwners).toEqual([undefined, currentOwner]);
        expect(doc.state).toEqual({ items: ['unscoped-b'], selected: 'unscoped-b' });

        foreign.commit();
        expect(mutationOwners).toEqual([undefined, currentOwner, foreignOwner]);
        expect(doc.state).toEqual({ items: ['unscoped-b', 'foreign-a'], selected: 'unscoped-b' });

        const successorTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ items: ['foreign-a', 'unscoped-b', 'scoped-c'], selected: 'unscoped-b' });
        });
        storage.set({ items: ['foreign-a', 'unscoped-b', 'scoped-c', 'successor-d'], selected: 'unscoped-b' });
        successorTransaction.scope(() => {
            storage.set({
                items: ['foreign-a', 'unscoped-b', 'scoped-c', 'successor-d'],
                selected: 'scoped-c',
            });
        });
        successorTransaction.commit();
        expect(countPendingAutomergeStorageWrites()).toBe(1);
        flushAutomergeStorageWrites();
        expect(doc.state).toEqual({
            items: ['unscoped-b', 'foreign-a', 'scoped-c', 'successor-d'],
            selected: 'scoped-c',
        });
    });

    it('keeps a committed predecessor when the current scoped journal is later refused', () => {
        const doc: { state: State } = { state: { items: [], selected: null } };
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => changeFn(doc),
        });
        const storage = createJournalStorage();
        expect(storage.hydrate?.()).toBe(true);
        storage.set({ items: ['a'], selected: null });
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ items: ['a'], selected: 'a' });
        });
        expect(doc.state).toEqual({ items: ['a'], selected: null });
        doc.state = { items: ['peer-b', 'a'], selected: 'peer-b' };

        expect(() => transaction.commit()).toThrow(AutomergeStorageWriteConflictError);
        transaction.abort();

        expect(doc.state.items).toContain('a');
        expect(doc.state).toEqual({ items: ['peer-b', 'a'], selected: 'peer-b' });
        expect(storage.get()).toEqual(doc.state);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it.each([
        ['set', 'abort', 'commit'],
        ['clear', 'abort', 'commit'],
        ['set', 'replace', 'commit'],
        ['set', 'replace', 'abort'],
        ['clear', 'replace', 'commit'],
        ['clear', 'replace', 'abort'],
    ] as const)(
        'refuses scoped %s when predecessor settlement synchronously triggers %s before later %s',
        (operation, intervention, terminal) => {
            let doc: { state: State } = { state: { items: [], selected: null } };
            let transaction!: ReturnType<typeof runWithAutomergeStorageTransaction>;
            let storage!: ReturnType<typeof createReplacementStorage>;
            let intervene = true;
            configureAutomergeStoragePort({
                getDoc: () => doc,
                getSemanticMessage: () => undefined,
                hasDoc: () => true,
                mutateDoc: ({ changeFn }) => {
                    changeFn(doc);
                    if (!intervene) {
                        return;
                    }
                    intervene = false;
                    if (intervention === 'abort') {
                        transaction.abort();
                        return;
                    }
                    doc = { state: { items: ['a'], selected: null } };
                    resetAutomergeStorageProjections('root');
                    expect(storage.hydrate?.()).toBe(true);
                },
            });
            storage = createReplacementStorage();
            expect(storage.hydrate?.()).toBe(true);
            storage.set({ items: ['a'], selected: null });
            transaction = runWithAutomergeStorageTransaction(undefined, () => undefined);

            expect(() =>
                transaction.scope(() => {
                    if (operation === 'clear') {
                        storage.clear();
                        return;
                    }
                    storage.set({ items: ['a'], selected: 'a' });
                })
            ).toThrow(AutomergeStorageWriteConflictError);
            expect({ raw: doc.state, cached: storage.get(), pending: countPendingAutomergeStorageWrites() }).toEqual({
                raw: { items: ['a'], selected: null },
                cached: { items: ['a'], selected: null },
                pending: 0,
            });

            transaction[terminal]();
            flushAutomergeStorageWrites();

            expect({ raw: doc.state, cached: storage.get(), pending: countPendingAutomergeStorageWrites() }).toEqual({
                raw: { items: ['a'], selected: null },
                cached: { items: ['a'], selected: null },
                pending: 0,
            });
        }
    );

    it('does not start a snapshot retry for an arbitrary port failure', () => {
        const doc: { state: State } = { state: { items: [], selected: null } };
        const waitForSnapshotTransaction = vi.fn(() => Promise.resolve());
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            isMutationBlockedBySnapshotTransaction: () => false,
            mutateDoc: () => {
                throw new Error('port unavailable');
            },
            waitForSnapshotTransaction,
        });
        const storage = createJournalStorage();
        expect(storage.hydrate?.()).toBe(true);
        storage.set({ items: ['a'], selected: null });

        frames.shift()?.(0);

        expect(waitForSnapshotTransaction).not.toHaveBeenCalled();
        expect(frames).toHaveLength(0);
        expect(storage.get()).toEqual({ items: ['a'], selected: null });
        expect(countPendingAutomergeStorageWrites()).toBe(1);
    });

    it('waits once when a frame is blocked by a snapshot and commits the latest coalesced value afterward', async () => {
        const doc: { state: State } = { state: { items: [], selected: null } };
        let blocked = true;
        let releaseSnapshot!: () => void;
        const snapshotFinished = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });
        const waitForSnapshotTransaction = vi.fn(() => snapshotFinished);
        const mutateDoc = vi.fn(({ changeFn }: { changeFn: (document: { state: State }) => void }) => changeFn(doc));
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            isMutationBlockedBySnapshotTransaction: () => blocked,
            mutateDoc,
            waitForSnapshotTransaction,
        });
        const storage = createJournalStorage();
        expect(storage.hydrate?.()).toBe(true);
        storage.set({ items: ['a'], selected: null });

        frames.shift()?.(0);
        storage.set({ items: ['a', 'c'], selected: null });

        expect(mutateDoc).not.toHaveBeenCalled();
        expect(waitForSnapshotTransaction).toHaveBeenCalledTimes(1);
        expect(frames).toHaveLength(0);
        expect(storage.get()).toEqual({ items: ['a', 'c'], selected: null });
        expect(countPendingAutomergeStorageWrites()).toBe(1);

        blocked = false;
        const retryContinuationCompleted = snapshotFinished.then(() => undefined);
        releaseSnapshot();
        await retryContinuationCompleted;
        expect(frames).toHaveLength(1);
        frames.shift()?.(0);

        expect(mutateDoc).toHaveBeenCalledTimes(1);
        expect(doc.state).toEqual({ items: ['a', 'c'], selected: null });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('invalidates a snapshot waiter when its projection is reset', async () => {
        const doc: { state: State } = { state: { items: [], selected: null } };
        let releaseSnapshot!: () => void;
        const snapshotFinished = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });
        const mutateDoc = vi.fn();
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            isMutationBlockedBySnapshotTransaction: () => true,
            mutateDoc,
            waitForSnapshotTransaction: () => snapshotFinished,
        });
        const storage = createJournalStorage();
        expect(storage.hydrate?.()).toBe(true);
        storage.set({ items: ['a'], selected: null });
        frames.shift()?.(0);

        resetAutomergeStorageProjections('root');
        const staleContinuationCompleted = snapshotFinished.then(() => undefined);
        releaseSnapshot();
        await staleContinuationCompleted;

        expect(frames).toHaveLength(0);
        expect(mutateDoc).not.toHaveBeenCalled();
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });
});
