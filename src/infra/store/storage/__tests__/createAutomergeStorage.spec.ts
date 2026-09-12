import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { createStore } from '../../createStore';
import {
    AutomergeStorageTransactionCommittedError,
    AutomergeStorageTransactionValidationError,
    captureAutomergeStorageTransactionScope,
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    getCurrentAutomergeStorageMutationOwner,
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;
type TestTransactionScope = Parameters<Parameters<typeof runWithAutomergeStorageTransaction>[1]>[0];

type MutationRecord = {
    docId: string;
    message: string | undefined;
    snapshotTransaction: object | undefined;
};

type CreateTestPortInput = {
    initialDoc?: TestDoc;
    hasDoc?: boolean;
    getSemanticMessage?: () => string | undefined;
};

function readCount(value: unknown): number | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const count = Object.entries(value).find(([key]) => key === 'count')?.[1];
    return typeof count === 'number' ? count : undefined;
}

function sanitizeCount(value: unknown): { count: number } | null {
    const count = readCount(value);
    return count === undefined ? null : { count };
}

const createTestPort = (
    input: CreateTestPortInput = {}
): { doc: TestDoc; mutations: MutationRecord[]; port: TestPort } => {
    const doc = input.initialDoc ?? {};
    const mutations: MutationRecord[] = [];
    const hasDoc = input.hasDoc ?? true;
    const getSemanticMessage = input.getSemanticMessage ?? (() => undefined);

    const port: TestPort = {
        getDoc: () => doc,
        getSemanticMessage,
        hasDoc: () => hasDoc,
        mutateDoc: ({ docId, changeFn, message, snapshotTransaction }) => {
            changeFn(doc);
            mutations.push({ docId, message, snapshotTransaction });
        },
    };

    return { doc, mutations, port };
};

describe('createAutomergeStorage', () => {
    let frameCallback: FrameRequestCallback | null = null;
    let requestAnimationFrameMock: ReturnType<typeof vi.fn<(callback: FrameRequestCallback) => number>>;
    let cancelAnimationFrameMock: ReturnType<typeof vi.fn<(handle: number) => void>>;

    beforeEach(() => {
        frameCallback = null;
        requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback): number => {
            frameCallback = callback;
            return 42;
        });
        cancelAnimationFrameMock = vi.fn();

        vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('should no-op writes and hydrate before the CRDT port is registered', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        expect(storage.isSupported()).toBe(true);
        expect(() => storage.set({ count: 1 })).not.toThrow();
        expect(storage.get()).toEqual({ count: 1 });
        expect(frameCallback).not.toBeNull();

        frameCallback?.(100);

        expect(() => storage.clear()).not.toThrow();
        expect(storage.get()).toBeNull();
        expect(storage.hydrate?.()).toBe(false);
    });

    it('should preserve store initial data across a late CRDT port registration without writing it back', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        const store = createStore({
            storage,
            initialData: { count: 7 },
        });

        expect(store.value).toEqual({ count: 7 });
        expect(frameCallback).not.toBeNull();

        frameCallback?.(100);

        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);

        store.hydrate();

        expect(store.value).toEqual({ count: 7 });
        // Audit CC-2 — hydrate is a pure reader. The seeded value stays visible
        // to the UI, but projection must not push it into the document; only a
        // real store write (below) may do that.
        expect(mutations).toEqual([]);
        expect(Object.hasOwn(doc, 'state')).toBe(false);

        store.set({ count: 8 });
        flushAutomergeStorageWrites();

        expect(mutations).toEqual([{ docId: 'root', message: undefined, snapshotTransaction: undefined }]);
        expect(doc.state).toEqual({ count: 8 });
    });

    it('should coalesce frame writes while keeping the first semantic message', () => {
        let semanticMessage: string | undefined = 'first change';
        const { doc, mutations, port } = createTestPort({
            getSemanticMessage: () => semanticMessage,
        });
        configureAutomergeStoragePort(port);

        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        storage.set({ count: 1 });
        semanticMessage = 'second change';
        storage.set({ count: 2 });

        expect(storage.get()).toEqual({ count: 2 });
        expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

        frameCallback?.(100);

        expect(mutations).toEqual([{ docId: 'root', message: 'first change', snapshotTransaction: undefined }]);
        expect(doc.state).toEqual({ count: 2 });
    });

    it('commits the coalesced local value when a remote hydrate lands before the frame', () => {
        const { doc, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);

        storage.set({ count: 1 });
        doc.state = { count: 2 };
        expect(storage.hydrate?.()).toBe(true);

        frameCallback?.(100);

        expect(doc.state).toEqual({ count: 1 });
        expect(storage.get()).toEqual({ count: 1 });
    });

    /// Regression (template-load e2e): a scoped action write set the store,
    /// an authority swap left the doc slot missing so an interleaved hydrate
    /// rolled the visible value back to the hydrateMissing default, and the
    /// scoped commit then restored the written value inside the adapter
    /// without notifying store subscribers — the UI wedged on the hydrated
    /// snapshot while getSnapshot() already held the committed value.
    it('notifies store subscribers when a scoped commit restores the value a hydrate rolled back', () => {
        const { port } = createTestPort({ initialDoc: {} });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: 0 }),
        });
        const store = createStore({ storage });

        const seenValues: Array<{ count: number } | null> = [];
        store.subscribe((value) => {
            seenValues.push(value);
        });

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            store.set({ count: 1 });
        });
        // The doc slot is still missing (fresh authority): hydrate rolls the
        // visible value back to the default…
        store.hydrate();
        expect(seenValues.at(-1)).toEqual({ count: 0 });

        transaction.commit();

        // …and the scoped commit must re-notify subscribers with the
        // committed value, not leave them on the hydrated one.
        expect(seenValues.at(-1)).toEqual({ count: 1 });
        expect(store.value).toEqual({ count: 1 });
    });

    it('should synchronously flush a pending frame before CRDT compaction', () => {
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        storage.set({ count: 7 });

        flushAutomergeStorageWrites();

        expect(cancelAnimationFrameMock).toHaveBeenCalledWith(42);
        expect(mutations).toEqual([{ docId: 'root', message: undefined, snapshotTransaction: undefined }]);
        expect(doc.state).toEqual({ count: 7 });
    });

    it('should coalesce clear into a pending frame before deleting the CRDT key', () => {
        let semanticMessage: string | undefined = 'queued write';
        const { doc, mutations, port } = createTestPort({
            initialDoc: { state: { count: 1 } },
            getSemanticMessage: () => semanticMessage,
        });
        configureAutomergeStoragePort(port);

        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        storage.set({ count: 2 });
        semanticMessage = 'clear write';
        storage.clear();

        expect(cancelAnimationFrameMock).not.toHaveBeenCalled();
        expect(mutations).toEqual([]);
        frameCallback?.(100);
        expect(mutations).toEqual([{ docId: 'root', message: 'queued write', snapshotTransaction: undefined }]);
        expect(Object.hasOwn(doc, 'state')).toBe(false);
        expect(storage.get()).toBeNull();
    });

    it('should hydrate through JSON stripping, fromCrdt normalization, and partial CRDT merge', () => {
        type HydratedState = { count: number; local: string; normalized?: boolean };
        // At runtime hydrate hands fromCrdt the stripped CRDT slot (count only);
        // the spread keeps the mock total over the declared TData contract.
        const fromCrdt = vi.fn((value: HydratedState): HydratedState => {
            expect(Object.hasOwn(value, 'dropped')).toBe(false);
            return { ...value, count: value.count + 1, normalized: true };
        });
        const { port } = createTestPort({
            initialDoc: {
                state: {
                    count: 4,
                    dropped: undefined,
                },
            },
        });
        configureAutomergeStoragePort(port);

        const storage = createAutomergeStorage<HydratedState>('root', 'state', {
            fromCrdt,
            toCrdt: (value) => ({ count: value.count }),
        });

        storage.set({ count: 1, local: 'kept' });

        expect(storage.hydrate?.()).toBe(true);
        expect(storage.get()).toEqual({ count: 5, local: 'kept', normalized: true });
    });

    it.each([
        { label: 'false', value: false },
        { label: 'zero', value: 0 },
        { label: 'empty string', value: '' },
    ])('hydrates the valid falsy value $label', ({ value }) => {
        const { port } = createTestPort({ initialDoc: { state: value } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<boolean | number | string>('root', 'state');

        expect(storage.hydrate?.()).toBe(true);
        expect(storage.get()).toBe(value);
    });

    // Audit CC-2 — this used to assert the opposite: hydrate() wrote the cached
    // value back into the document when the slot was missing. That back-write
    // made the projection a second writer, recursed through the projection
    // bridge, and let a previous project's cache seed a fresh document. The
    // deferred write below is the only sanctioned path into the doc.
    it('should not write cached local data into the doc when hydrate finds a missing key', () => {
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);

        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        storage.set({ count: 9 });

        expect(storage.hydrate?.()).toBe(false);
        expect(mutations).toEqual([]);
        expect(Object.hasOwn(doc, 'state')).toBe(false);
        expect(storage.get()).toEqual({ count: 9 });

        flushAutomergeStorageWrites();

        expect(mutations).toEqual([{ docId: 'root', message: undefined, snapshotTransaction: undefined }]);
        expect(doc.state).toEqual({ count: 9 });
    });

    it('flushes only writes owned by the requested snapshot transaction', () => {
        const snapshotTransaction = {};
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const ownedStorage = createAutomergeStorage<{ count: number }>('root', 'owned');
        const independentStorage = createAutomergeStorage<{ count: number }>('root', 'independent');

        const transaction = runWithAutomergeStorageTransaction(snapshotTransaction, () => {
            ownedStorage.set({ count: 1 });
        });
        independentStorage.set({ count: 2 });

        flushAutomergeStorageWrites(snapshotTransaction);

        expect(mutations).toEqual([]);
        transaction.commit();

        expect(mutations).toEqual([{ docId: 'root', message: undefined, snapshotTransaction }]);
        expect(doc.owned).toEqual({ count: 1 });
        expect(doc.independent).toBeUndefined();

        flushAutomergeStorageWrites();
        expect(mutations).toEqual([
            { docId: 'root', message: undefined, snapshotTransaction },
            { docId: 'root', message: undefined, snapshotTransaction: undefined },
        ]);
        expect(doc.independent).toEqual({ count: 2 });
    });

    it('retains exact write ownership when delayed commits are flushed outside their creation scope', () => {
        const { doc, port } = createTestPort();
        const observedOwners: Array<object | undefined> = [];
        configureAutomergeStoragePort({
            ...port,
            mutateDoc: (input) => {
                observedOwners.push(getCurrentAutomergeStorageMutationOwner());
                port.mutateDoc(input);
            },
        });
        const scopedStorage = createAutomergeStorage<{ count: number }>('root', 'scoped');
        const unscopedStorage = createAutomergeStorage<{ count: number }>('root', 'unscoped');
        let scopedOwner: object | undefined;

        const scopedTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            scopedOwner = getCurrentAutomergeStorageMutationOwner();
            scopedStorage.set({ count: 1 });
        });
        expect(observedOwners).toEqual([]);
        scopedTransaction.commit();

        expect(scopedOwner).toBeDefined();
        expect(observedOwners).toEqual([scopedOwner]);

        unscopedStorage.set({ count: 2 });
        let flushCallerOwner: object | undefined;
        const flushCaller = runWithAutomergeStorageTransaction(undefined, () => {
            flushCallerOwner = getCurrentAutomergeStorageMutationOwner();
            flushAutomergeStorageWrites();
        });
        flushCaller.abort();

        expect(flushCallerOwner).toBeDefined();
        expect(flushCallerOwner).not.toBe(scopedOwner);
        expect(observedOwners).toEqual([scopedOwner, undefined]);
        expect(doc).toEqual({ scoped: { count: 1 }, unscoped: { count: 2 } });
    });

    it('does not coalesce writes with different snapshot owners in one adapter', () => {
        const snapshotTransaction = {};
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        const transaction = runWithAutomergeStorageTransaction(snapshotTransaction, () => {
            storage.set({ count: 1 });
        });
        transaction.commit();
        storage.set({ count: 2 });

        expect(mutations).toEqual([{ docId: 'root', message: undefined, snapshotTransaction }]);
        expect(doc.state).toEqual({ count: 1 });

        flushAutomergeStorageWrites();
        expect(mutations).toEqual([
            { docId: 'root', message: undefined, snapshotTransaction },
            { docId: 'root', message: undefined, snapshotTransaction: undefined },
        ]);
        expect(doc.state).toEqual({ count: 2 });
    });

    it('does not let a superseded pending write revert a newer committed value', () => {
        // The GrooveDropTarget race: an unscoped write (pre-seeded template) is
        // deferred via rAF; a scoped save commits a superset value first; under
        // CPU saturation the stale unscoped write flushes LAST and must not
        // revert the CRDT slot or the cache to its older value.
        const { doc, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ templates: string[] }>('root', 'state');

        storage.set({ templates: ['occupied-name'] });

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ templates: ['occupied-name', 'groove-clip-source-v1'] });
        });
        transaction.commit();
        expect(storage.get()).toEqual({ templates: ['occupied-name', 'groove-clip-source-v1'] });

        flushAutomergeStorageWrites();

        expect(storage.get()).toEqual({ templates: ['occupied-name', 'groove-clip-source-v1'] });
        expect(doc.state).toEqual({ templates: ['occupied-name', 'groove-clip-source-v1'] });
    });

    it('still commits a pending write whose last set is newer than the latest commit', () => {
        const { doc, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        storage.set({ count: 1 });

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 2 });
        });
        transaction.commit();

        storage.set({ count: 3 });
        flushAutomergeStorageWrites();

        expect(storage.get()).toEqual({ count: 3 });
        expect(doc.state).toEqual({ count: 3 });
    });

    it('keeps an unscoped write made after the scoped set but before its commit', () => {
        // The unscoped set is causally NEWER than the scoped set even though
        // the scoped commit lands first — the guard must compare against the
        // committed write's set-time revision, not the commit-time bump
        // (review #601).
        const { doc, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
        });
        storage.set({ count: 2 });
        transaction.commit();

        flushAutomergeStorageWrites();

        expect(storage.get()).toEqual({ count: 2 });
        expect(doc.state).toEqual({ count: 2 });
    });

    it('commits same-document keys in one Automerge mutation', () => {
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);

        const arrangementStorage = createAutomergeStorage<TestDoc>('root', 'tracks');
        const midiStorage = createAutomergeStorage<TestDoc>('root', 'midi');
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
            midiStorage.set({ imported: true });
        });
        transaction.commit();
        transaction.abort();

        frameCallback?.(100);

        expect(mutations).toHaveLength(1);
        expect(doc).toEqual({
            tracks: { imported: true },
            midi: { imported: true },
        });
    });

    it.each(['supplied', 'captured'] as const)(
        'refuses a %s transaction scope that a publication listener re-enters during commit',
        (scopeKind) => {
            const documents = new Map<string, TestDoc>([
                ['document-a', { state: { count: 0 } }],
                ['document-b', { state: { count: 0 } }],
            ]);
            const mutationCalls: string[] = [];
            const listenerFailures: unknown[] = [];
            let listenerCallbackEntries = 0;
            let publicationListener: (() => void) | undefined;
            const port: TestPort = {
                getDoc: (docId) => documents.get(docId),
                getSemanticMessage: () => undefined,
                hasDoc: (docId) => documents.has(docId),
                mutateDoc: ({ docId, changeFn }) => {
                    const current = documents.get(docId);
                    if (!current) {
                        throw new Error(`Document not found: ${docId}`);
                    }
                    const candidate = structuredClone(current);
                    changeFn(candidate);
                    documents.set(docId, candidate);
                    mutationCalls.push(docId);
                    if (docId === 'document-a' && publicationListener) {
                        const listener = publicationListener;
                        publicationListener = undefined;
                        try {
                            listener();
                        } catch (error) {
                            // The production repository catches listener failures
                            // after publishing the changed document.
                            listenerFailures.push(error);
                        }
                    }
                },
            };
            configureAutomergeStoragePort(port);
            const storageA = createAutomergeStorage<{ count: number }>('document-a', 'state');
            const storageB = createAutomergeStorage<{ count: number }>('document-b', 'state');
            expect(storageA.hydrate?.()).toBe(true);
            expect(storageB.hydrate?.()).toBe(true);

            let suppliedScope: TestTransactionScope | undefined;
            let capturedScope: TestTransactionScope | undefined;
            const transaction = runWithAutomergeStorageTransaction(undefined, (scope) => {
                suppliedScope = scope;
                capturedScope = captureAutomergeStorageTransactionScope();
                storageA.set({ count: 1 });
            });
            const selectedScope = scopeKind === 'supplied' ? suppliedScope : capturedScope;
            if (!selectedScope) {
                throw new Error(`${scopeKind} transaction scope was not captured`);
            }
            publicationListener = () =>
                selectedScope(() => {
                    listenerCallbackEntries += 1;
                    storageB.set({ count: 1 });
                });

            transaction.commit();

            expect(listenerFailures).toHaveLength(1);
            expect(listenerCallbackEntries).toBe(0);
            expect(listenerFailures[0]).toBeInstanceOf(Error);
            expect(storageA.get()).toEqual({ count: 1 });
            expect(storageB.get()).toEqual({ count: 0 });
            expect(documents.get('document-a')).toEqual({ state: { count: 1 } });
            expect(documents.get('document-b')).toEqual({ state: { count: 0 } });
            expect(mutationCalls).toEqual(['document-a']);
            expect(countPendingAutomergeStorageWrites()).toBe(0);

            flushAutomergeStorageWrites();

            expect(documents.get('document-b')).toEqual({ state: { count: 0 } });
            expect(mutationCalls).toEqual(['document-a']);
            expect(countPendingAutomergeStorageWrites()).toBe(0);
        }
    );

    it.each([
        { operation: 'set', settlement: 'commit' },
        { operation: 'clear', settlement: 'commit' },
        { operation: 'set', settlement: 'abort' },
        { operation: 'clear', settlement: 'abort' },
    ] as const)('refuses $operation from an already-entered scope after $settlement', ({ operation, settlement }) => {
        const { doc, mutations, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => undefined);

        expect(() =>
            transaction.scope(() => {
                transaction[settlement]();
                if (operation === 'set') {
                    storage.set({ count: 1 });
                } else {
                    storage.clear();
                }
            })
        ).toThrow(Error);

        expect(storage.get()).toEqual({ count: 0 });
        expect(doc).toEqual({ state: { count: 0 } });
        expect(mutations).toEqual([]);
        expect(countPendingAutomergeStorageWrites()).toBe(0);

        flushAutomergeStorageWrites();

        expect(storage.get()).toEqual({ count: 0 });
        expect(doc).toEqual({ state: { count: 0 } });
        expect(mutations).toEqual([]);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it.each([
        'supplied scope',
        'captured scope',
        'set',
        'clear',
        'commit',
        'abort',
        'commit validator registration',
        'document validator registration',
    ] as const)('freezes same-owner %s before commit validators run', (attempt) => {
        const { doc, mutations, port } = createTestPort({
            initialDoc: { primary: { count: 0 }, secondary: { count: 0 } },
        });
        configureAutomergeStoragePort(port);
        const primaryStorage = createAutomergeStorage<{ count: number }>('root', 'primary');
        const secondaryStorage = createAutomergeStorage<{ count: number }>('root', 'secondary');
        expect(primaryStorage.hydrate?.()).toBe(true);
        expect(secondaryStorage.hydrate?.()).toBe(true);

        let suppliedScope: TestTransactionScope | undefined;
        let capturedScope: TestTransactionScope | undefined;
        let validatorCallbackEntries = 0;
        const transaction = runWithAutomergeStorageTransaction(undefined, (scope) => {
            suppliedScope = scope;
            capturedScope = captureAutomergeStorageTransactionScope();
            primaryStorage.set({ count: 1 });
        });
        const validatedSuppliedScope = suppliedScope;
        const validatedCapturedScope = capturedScope;
        if (!validatedSuppliedScope || !validatedCapturedScope) {
            throw new Error('transaction scopes were not captured');
        }
        transaction.validateCommit(() => {
            switch (attempt) {
                case 'supplied scope':
                    validatedSuppliedScope(() => {
                        validatorCallbackEntries += 1;
                        secondaryStorage.set({ count: 1 });
                    });
                    break;
                case 'captured scope':
                    validatedCapturedScope(() => {
                        validatorCallbackEntries += 1;
                        secondaryStorage.set({ count: 1 });
                    });
                    break;
                case 'set':
                    secondaryStorage.set({ count: 1 });
                    break;
                case 'clear':
                    secondaryStorage.clear();
                    break;
                case 'commit':
                    transaction.commit();
                    break;
                case 'abort':
                    transaction.abort();
                    break;
                case 'commit validator registration':
                    transaction.validateCommit(() => null);
                    break;
                case 'document validator registration':
                    transaction.validateDocument('root', () => null);
                    break;
            }
            return null;
        });

        expect(() => transaction.scope(() => transaction.commit())).toThrow(/committing/);
        expect(validatorCallbackEntries).toBe(0);
        expect(mutations).toEqual([]);
        expect(doc).toEqual({ primary: { count: 0 }, secondary: { count: 0 } });

        transaction.scope(() => primaryStorage.set({ count: 0 }));
        transaction.abort();

        expect(primaryStorage.get()).toEqual({ count: 0 });
        expect(secondaryStorage.get()).toEqual({ count: 0 });
        expect(doc).toEqual({ primary: { count: 0 }, secondary: { count: 0 } });
        expect(mutations).toEqual([]);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('restores an uncommitted transaction to open after its document mutation refuses', () => {
        const doc: TestDoc = { state: { count: 0 } };
        const commitFailure = new Error('CRDT commit refused before publication');
        let mutationAttempts = 0;
        const port: TestPort = {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: () => {
                mutationAttempts += 1;
                throw commitFailure;
            },
        };
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
        });

        expect(() => transaction.commit()).toThrow(commitFailure);
        expect(storage.get()).toEqual({ count: 1 });
        expect(countPendingAutomergeStorageWrites()).toBe(1);

        transaction.scope(() => storage.set({ count: 0 }));
        transaction.abort();

        expect(mutationAttempts).toBe(1);
        expect(storage.get()).toEqual({ count: 0 });
        expect(doc).toEqual({ state: { count: 0 } });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('keeps a partially published transaction closed to every same-owner scope', () => {
        const documents = new Map<string, TestDoc>([
            ['document-a', { state: { count: 0 } }],
            ['document-b', { state: { count: 0 } }],
        ]);
        const mutationCalls: string[] = [];
        const port: TestPort = {
            getDoc: (docId) => documents.get(docId),
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => documents.has(docId),
            mutateDoc: ({ docId, changeFn }) => {
                mutationCalls.push(docId);
                if (docId === 'document-b') {
                    throw new Error('second document refused');
                }
                const candidate = structuredClone(documents.get(docId) ?? {});
                changeFn(candidate);
                documents.set(docId, candidate);
            },
        };
        configureAutomergeStoragePort(port);
        const storageA = createAutomergeStorage<{ count: number }>('document-a', 'state');
        const storageB = createAutomergeStorage<{ count: number }>('document-b', 'state');
        expect(storageA.hydrate?.()).toBe(true);
        expect(storageB.hydrate?.()).toBe(true);
        let suppliedScope: TestTransactionScope | undefined;
        let capturedScope: TestTransactionScope | undefined;
        const transaction = runWithAutomergeStorageTransaction(undefined, (scope) => {
            suppliedScope = scope;
            capturedScope = captureAutomergeStorageTransactionScope();
            storageA.set({ count: 1 });
            storageB.set({ count: 1 });
        });
        const validatedSuppliedScope = suppliedScope;
        const validatedCapturedScope = capturedScope;
        if (!validatedSuppliedScope || !validatedCapturedScope) {
            throw new Error('transaction scopes were not captured');
        }

        expect(() => transaction.commit()).toThrow(AutomergeStorageTransactionCommittedError);
        let callbackEntries = 0;
        expect(() =>
            validatedSuppliedScope(() => {
                callbackEntries += 1;
            })
        ).toThrow(Error);
        expect(() =>
            validatedCapturedScope(() => {
                callbackEntries += 1;
            })
        ).toThrow(Error);
        transaction.abort();

        expect(callbackEntries).toBe(0);
        expect(storageA.get()).toEqual({ count: 1 });
        expect(storageB.get()).toEqual({ count: 0 });
        expect(documents.get('document-a')).toEqual({ state: { count: 1 } });
        expect(documents.get('document-b')).toEqual({ state: { count: 0 } });
        expect(mutationCalls).toEqual(['document-a', 'document-b']);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('allows a distinct transaction owner to commit from a publication listener', () => {
        const documents = new Map<string, TestDoc>([
            ['document-a', { state: { count: 0 } }],
            ['document-b', { state: { count: 0 } }],
        ]);
        const mutationCalls: string[] = [];
        let publicationListener: (() => void) | undefined;
        const port: TestPort = {
            getDoc: (docId) => documents.get(docId),
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => documents.has(docId),
            mutateDoc: ({ docId, changeFn }) => {
                const candidate = structuredClone(documents.get(docId) ?? {});
                changeFn(candidate);
                documents.set(docId, candidate);
                mutationCalls.push(docId);
                if (docId === 'document-a' && publicationListener) {
                    const listener = publicationListener;
                    publicationListener = undefined;
                    listener();
                }
            },
        };
        configureAutomergeStoragePort(port);
        const storageA = createAutomergeStorage<{ count: number }>('document-a', 'state');
        const storageB = createAutomergeStorage<{ count: number }>('document-b', 'state');
        expect(storageA.hydrate?.()).toBe(true);
        expect(storageB.hydrate?.()).toBe(true);
        const outerTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            storageA.set({ count: 1 });
        });
        publicationListener = () => {
            const nestedTransaction = runWithAutomergeStorageTransaction(undefined, () => {
                storageB.set({ count: 1 });
            });
            nestedTransaction.commit();
        };

        outerTransaction.commit();

        expect(storageA.get()).toEqual({ count: 1 });
        expect(storageB.get()).toEqual({ count: 1 });
        expect(documents.get('document-a')).toEqual({ state: { count: 1 } });
        expect(documents.get('document-b')).toEqual({ state: { count: 1 } });
        expect(mutationCalls).toEqual(['document-a', 'document-b']);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('keeps both supplied and captured scopes writable before commit starts', () => {
        const { doc, mutations, port } = createTestPort({
            initialDoc: { first: { count: 0 }, second: { count: 0 } },
        });
        configureAutomergeStoragePort(port);
        const firstStorage = createAutomergeStorage<{ count: number }>('root', 'first');
        const secondStorage = createAutomergeStorage<{ count: number }>('root', 'second');
        expect(firstStorage.hydrate?.()).toBe(true);
        expect(secondStorage.hydrate?.()).toBe(true);
        let suppliedScope: TestTransactionScope | undefined;
        let capturedScope: TestTransactionScope | undefined;
        const transaction = runWithAutomergeStorageTransaction(undefined, (scope) => {
            suppliedScope = scope;
            capturedScope = captureAutomergeStorageTransactionScope();
        });
        if (!suppliedScope || !capturedScope) {
            throw new Error('transaction scopes were not captured');
        }

        suppliedScope(() => firstStorage.set({ count: 1 }));
        capturedScope(() => secondStorage.set({ count: 1 }));
        transaction.commit();

        expect(firstStorage.get()).toEqual({ count: 1 });
        expect(secondStorage.get()).toEqual({ count: 1 });
        expect(doc).toEqual({ first: { count: 1 }, second: { count: 1 } });
        expect(mutations).toHaveLength(1);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('validates the staged document inside the mutation and rolls it back on rejection', () => {
        const doc: TestDoc = { state: { count: 0 } };
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                const draft = structuredClone(doc);
                changeFn(draft);
                for (const key of Object.keys(doc)) {
                    delete doc[key];
                }
                Object.assign(doc, draft);
            },
        });
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
        });
        transaction.validateDocument('root', (stagedDocument) =>
            (stagedDocument.state as { count: number }).count === 1 ? 'staged document rejected' : null
        );

        expect(() => transaction.commit()).toThrow(AutomergeStorageTransactionValidationError);
        transaction.abort();

        expect(doc).toEqual({ state: { count: 0 } });
        expect(storage.get()).toEqual({ count: 0 });
    });

    it('does not commit a compensated action-owner write that returns to its cached base', () => {
        const { doc, mutations, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
            storage.set({ count: 0 });
        });

        frameCallback?.(100);
        expect(mutations).toEqual([]);
        transaction.abort();
        transaction.abort();
        transaction.commit();

        expect(storage.get()).toEqual({ count: 0 });
        expect(doc.state).toEqual({ count: 0 });
        expect(mutations).toEqual([]);
    });

    it('aborts every same-owner adapter before its animation frame and restores each cached base', () => {
        const { doc, mutations, port } = createTestPort({
            initialDoc: { tracks: { imported: false }, midi: { imported: false } },
        });
        configureAutomergeStoragePort(port);
        const arrangementStorage = createAutomergeStorage<TestDoc>('root', 'tracks');
        const midiStorage = createAutomergeStorage<TestDoc>('root', 'midi');
        expect(arrangementStorage.hydrate?.()).toBe(true);
        expect(midiStorage.hydrate?.()).toBe(true);

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
            midiStorage.set({ imported: true });
        });
        const scheduledFrames = requestAnimationFrameMock.mock.calls.map(([callback]) => callback);

        transaction.abort();
        for (const scheduledFrame of scheduledFrames) {
            scheduledFrame(100);
        }

        expect(cancelAnimationFrameMock).toHaveBeenCalledTimes(2);
        expect(arrangementStorage.get()).toEqual({ imported: false });
        expect(midiStorage.get()).toEqual({ imported: false });
        expect(doc).toEqual({ tracks: { imported: false }, midi: { imported: false } });
        expect(mutations).toEqual([]);
    });

    it('preserves a committed overlapping owner when an earlier owner aborts', () => {
        const { doc, mutations, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);

        const firstTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
        });
        const secondTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 2 });
        });

        secondTransaction.commit();
        firstTransaction.abort();

        expect(storage.get()).toEqual({ count: 2 });
        expect(doc.state).toEqual({ count: 2 });
        expect(mutations).toEqual([{ docId: 'root', message: undefined, snapshotTransaction: undefined }]);
    });

    it('does not resurrect an earlier aborted owner when a later overlapping owner also aborts', () => {
        const { doc, mutations, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);

        const firstTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
        });
        const secondTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 2 });
        });

        firstTransaction.abort();
        expect(storage.get()).toEqual({ count: 2 });
        secondTransaction.abort();

        expect(storage.get()).toEqual({ count: 0 });
        expect(doc.state).toEqual({ count: 0 });
        expect(mutations).toEqual([]);
    });

    it('keeps adapter cache aligned with overlapping owners committed in terminal order', () => {
        const { doc, mutations, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);

        const firstTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
        });
        const secondTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 2 });
        });

        secondTransaction.commit();
        firstTransaction.commit();

        expect(storage.get()).toEqual({ count: 1 });
        expect(doc.state).toEqual({ count: 1 });
        expect(mutations).toHaveLength(2);
    });

    it('reports ambiguous durability without persisting one key when a same-document commit fails', () => {
        const doc: TestDoc = {};
        const port: TestPort = {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                const candidate = { ...doc };
                changeFn(candidate);
                if (Object.hasOwn(candidate, 'midi')) {
                    throw new Error('MIDI write failed');
                }
                for (const key of Object.keys(doc)) {
                    delete doc[key];
                }
                Object.assign(doc, candidate);
            },
        };
        configureAutomergeStoragePort(port);

        const arrangementStorage = createAutomergeStorage<TestDoc>('root', 'tracks');
        const midiStorage = createAutomergeStorage<TestDoc>('root', 'midi');
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
            midiStorage.set({ imported: true });
        });

        expect(() => transaction.commit()).toThrow(AutomergeStorageTransactionCommittedError);
        expect(doc).toEqual({});
    });

    it('restores the adapter cache and rethrows when mutateDoc fails before it applies the change', () => {
        const doc: TestDoc = { state: { count: 0 } };
        const commitFailure = new Error('CRDT commit failed');
        const port: TestPort = {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: () => {
                throw commitFailure;
            },
        };
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
        });

        expect(() => transaction.commit()).toThrow(commitFailure);
        transaction.abort();
        flushAutomergeStorageWrites();

        expect(storage.get()).toEqual({ count: 0 });
        expect(doc.state).toEqual({ count: 0 });
    });

    it('rethrows a slot mutation that refuses, without reporting the transaction as committed', () => {
        const doc: TestDoc = { state: { count: 0 } };
        const refusal = new Error('Unsupported slot schema version: 2');
        const port: TestPort = {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            // Models Automerge's `change()`: the callback runs against the
            // document and the transaction is rolled back if it throws.
            mutateDoc: ({ changeFn }) => {
                const candidate: TestDoc = structuredClone(doc);
                changeFn(candidate);
                for (const key of Object.keys(doc)) {
                    delete doc[key];
                }
                Object.assign(doc, candidate);
            },
        };
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            mutateCrdt: () => {
                throw refusal;
            },
        });
        expect(storage.hydrate?.()).toBe(true);

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
        });

        expect(() => transaction.commit()).toThrow(refusal);
        transaction.abort();
        flushAutomergeStorageWrites();

        expect(storage.get()).toEqual({ count: 0 });
        expect(doc.state).toEqual({ count: 0 });
    });

    it('preserves semantic messages across ordinary action scopes', () => {
        let semanticMessage: string | undefined = 'First action';
        const { doc, mutations, port } = createTestPort({
            getSemanticMessage: () => semanticMessage,
        });
        configureAutomergeStoragePort(port);
        const arrangementStorage = createAutomergeStorage<TestDoc>('root', 'tracks');
        const midiStorage = createAutomergeStorage<TestDoc>('root', 'midi');

        const firstTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
        });
        firstTransaction.commit();
        semanticMessage = 'Second action';
        const secondTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            midiStorage.set({ imported: true });
        });
        secondTransaction.commit();

        flushAutomergeStorageWrites();

        expect(mutations).toEqual([
            { docId: 'root', message: 'First action', snapshotTransaction: undefined },
            { docId: 'root', message: 'Second action', snapshotTransaction: undefined },
        ]);
        expect(doc).toEqual({
            tracks: { imported: true },
            midi: { imported: true },
        });
    });

    it('flushes only the action owner whose animation frame fired', () => {
        const snapshotTransaction = {};
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const arrangementStorage = createAutomergeStorage<TestDoc>('root', 'tracks');
        const midiStorage = createAutomergeStorage<TestDoc>('root', 'midi');

        const arrangementTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
        });
        const midiTransaction = runWithAutomergeStorageTransaction(snapshotTransaction, () => {
            midiStorage.set({ imported: true });
        });

        const arrangementFrame = requestAnimationFrameMock.mock.calls[0]?.[0];
        arrangementFrame?.(100);

        expect(mutations).toEqual([]);
        arrangementTransaction.commit();
        expect(mutations).toEqual([{ docId: 'root', message: undefined, snapshotTransaction: undefined }]);
        expect(doc.tracks).toEqual({ imported: true });
        expect(doc.midi).toBeUndefined();

        midiTransaction.commit();
        expect(doc.midi).toEqual({ imported: true });
    });

    it('keeps newly scheduled unscoped adapter writes in separate owner groups', () => {
        let semanticMessage: string | undefined = 'Arrangement direct write';
        const { doc, mutations, port } = createTestPort({
            getSemanticMessage: () => semanticMessage,
        });
        configureAutomergeStoragePort(port);
        const arrangementStorage = createAutomergeStorage<TestDoc>('root', 'tracks');
        const midiStorage = createAutomergeStorage<TestDoc>('root', 'midi');

        arrangementStorage.set({ imported: true });
        semanticMessage = 'MIDI direct write';
        midiStorage.set({ imported: true });

        flushAutomergeStorageWrites();

        expect(mutations).toEqual([
            { docId: 'root', message: 'Arrangement direct write', snapshotTransaction: undefined },
            { docId: 'root', message: 'MIDI direct write', snapshotTransaction: undefined },
        ]);
        expect(doc).toEqual({
            tracks: { imported: true },
            midi: { imported: true },
        });
    });

    it('commits none of an action group when one key cannot be prepared', () => {
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const arrangementStorage = createAutomergeStorage<TestDoc>('root', 'tracks');
        const midiStorage = createAutomergeStorage<TestDoc>('root', 'midi', {
            toCrdt: () => {
                throw new Error('MIDI preparation failed');
            },
        });

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
            midiStorage.set({ imported: true });
        });

        expect(() => transaction.commit()).toThrow('MIDI preparation failed');
        expect(mutations).toEqual([]);
        expect(doc).toEqual({});
    });

    it('keeps same-action keys intact while surfacing ambiguous commit durability', () => {
        const doc: TestDoc = {
            tracks: { imported: true },
            midi: { imported: true },
        };
        const port: TestPort = {
            getDoc: () => doc,
            getSemanticMessage: () => 'Clear import',
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                const candidate = { ...doc };
                changeFn(candidate);
                if (!Object.hasOwn(candidate, 'tracks') && !Object.hasOwn(candidate, 'midi')) {
                    throw new Error('Clear commit failed');
                }
                for (const key of Object.keys(doc)) {
                    delete doc[key];
                }
                Object.assign(doc, candidate);
            },
        };
        configureAutomergeStoragePort(port);
        const arrangementStorage = createAutomergeStorage<TestDoc>('root', 'tracks');
        const midiStorage = createAutomergeStorage<TestDoc>('root', 'midi');

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.clear();
            midiStorage.clear();
        });

        expect(() => transaction.commit()).toThrow(AutomergeStorageTransactionCommittedError);
        expect(doc).toEqual({
            tracks: { imported: true },
            midi: { imported: true },
        });
    });

    it('freezes every selected write before an earlier preparation authors its successor', () => {
        const { doc, mutations, port } = createTestPort({
            initialDoc: { first: { count: 0 }, second: { count: 0 } },
        });
        configureAutomergeStoragePort(port);
        let secondStorage: ReturnType<typeof createAutomergeStorage<{ count: number }>>;
        let authorSuccessor = false;
        const firstStorage = createAutomergeStorage<{ count: number }>('root', 'first', {
            toCrdt: (value) => {
                if (authorSuccessor) {
                    authorSuccessor = false;
                    secondStorage.set({ count: 2 });
                }
                return value;
            },
        });
        secondStorage = createAutomergeStorage<{ count: number }>('root', 'second');
        expect(firstStorage.hydrate?.()).toBe(true);
        expect(secondStorage.hydrate?.()).toBe(true);
        firstStorage.set({ count: 1 });
        secondStorage.set({ count: 1 });
        authorSuccessor = true;

        flushAutomergeStorageWrites();

        expect(doc).toEqual({ first: { count: 1 }, second: { count: 1 } });
        expect(secondStorage.get()).toEqual({ count: 2 });
        expect(countPendingAutomergeStorageWrites()).toBe(1);
        expect(mutations).toHaveLength(2);

        flushAutomergeStorageWrites();
        expect(doc.second).toEqual({ count: 2 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it.each([false, true])(
        'keeps an unscoped successor authored during preparation separate (nested flush: %s)',
        (nestedFlush) => {
            const { doc, mutations, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
            configureAutomergeStoragePort(port);
            let authorSuccessor = false;
            const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
                toCrdt: (value) => {
                    if (authorSuccessor) {
                        authorSuccessor = false;
                        storage.set({ count: 2 });
                        if (nestedFlush) {
                            flushAutomergeStorageWrites();
                        }
                    }
                    return value;
                },
            });
            expect(storage.hydrate?.()).toBe(true);
            const transaction = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
            authorSuccessor = true;

            transaction.commit();

            expect(doc.state).toEqual({ count: 1 });
            expect(storage.get()).toEqual({ count: nestedFlush ? 1 : 2 });
            expect(mutations).toHaveLength(nestedFlush ? 2 : 1);
            expect(countPendingAutomergeStorageWrites()).toBe(nestedFlush ? 0 : 1);

            flushAutomergeStorageWrites();
            expect(doc.state).toEqual({ count: nestedFlush ? 1 : 2 });
            expect(storage.get()).toEqual({ count: nestedFlush ? 1 : 2 });
            expect(mutations).toHaveLength(2);
            expect(countPendingAutomergeStorageWrites()).toBe(0);
        }
    );

    it('freezes a later selected mutation before an earlier preparation changes its visible projection', () => {
        const { doc, port } = createTestPort({
            initialDoc: { first: { count: 0 }, second: { count: 0 } },
        });
        configureAutomergeStoragePort(port);
        let secondStorage: ReturnType<typeof createAutomergeStorage<{ count: number }>>;
        let projectDuringPreparation = false;
        const firstStorage = createAutomergeStorage<{ count: number }>('root', 'first', {
            toCrdt: (value) => {
                if (projectDuringPreparation) {
                    projectDuringPreparation = false;
                    secondStorage.setProjected?.({ count: 2 });
                }
                return value;
            },
        });
        secondStorage = createAutomergeStorage<{ count: number }>('root', 'second');
        expect(firstStorage.hydrate?.()).toBe(true);
        expect(secondStorage.hydrate?.()).toBe(true);
        firstStorage.set({ count: 1 });
        secondStorage.set({ count: 1 });
        projectDuringPreparation = true;

        flushAutomergeStorageWrites();

        expect(doc).toEqual({ first: { count: 1 }, second: { count: 1 } });
        expect(secondStorage.get()).toEqual({ count: 1 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('invalidates a selected execution when projection authority resets during preparation', () => {
        const { doc, mutations, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        let resetDuringPreparation = false;
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: -1 }),
            toCrdt: (value) => {
                if (resetDuringPreparation) {
                    resetDuringPreparation = false;
                    resetAutomergeStorageProjections('root');
                }
                return value;
            },
        });
        expect(storage.hydrate?.()).toBe(true);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 1 });
        });
        resetDuringPreparation = true;

        transaction.commit();

        expect(doc.state).toEqual({ count: 0 });
        expect(storage.get()).toEqual({ count: -1 });
        expect(mutations).toEqual([]);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it.each(['getDoc', 'validator'] as const)(
        'reports a trailing %s failure as committed after an earlier document publishes',
        (failureSource) => {
            const documents = new Map<string, TestDoc>([
                ['document-a', { state: { count: 0 } }],
                ['document-b', { state: { count: 0 } }],
            ]);
            let mutationCount = 0;
            configureAutomergeStoragePort({
                getDoc: (docId) => {
                    if (docId === 'document-b' && failureSource === 'getDoc') {
                        throw new Error('trailing getDoc failed');
                    }
                    return documents.get(docId);
                },
                getSemanticMessage: () => undefined,
                hasDoc: (docId) => documents.has(docId),
                mutateDoc: ({ docId, changeFn }) => {
                    const candidate = structuredClone(documents.get(docId) ?? {});
                    changeFn(candidate);
                    documents.set(docId, candidate);
                    mutationCount += 1;
                },
            });
            const storage = createAutomergeStorage<{ count: number }>('document-a', 'state');
            expect(storage.hydrate?.()).toBe(true);
            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                storage.set({ count: 1 });
            });
            transaction.validateDocument('document-b', () => {
                if (failureSource === 'validator') {
                    throw new Error('trailing validator failed');
                }
                return null;
            });

            expect(() => transaction.commit()).toThrow(AutomergeStorageTransactionCommittedError);
            expect(documents.get('document-a')).toEqual({ state: { count: 1 } });
            expect(storage.get()).toEqual({ count: 1 });
            expect(mutationCount).toBe(1);
            expect(countPendingAutomergeStorageWrites()).toBe(0);
            expect(() => transaction.scope(() => storage.set({ count: 2 }))).toThrow(/committed/);
        }
    );

    it('reads the document again before each terminal when the first projection commits a newer second slot', () => {
        const { doc, mutations, port } = createTestPort({
            initialDoc: { first: { count: 0 }, second: { count: 0 } },
        });
        configureAutomergeStoragePort(port);
        const firstStorage = createAutomergeStorage<{ count: number }>('root', 'first');
        const secondStorage = createAutomergeStorage<{ count: number }>('root', 'second');
        expect(firstStorage.hydrate?.()).toBe(true);
        expect(secondStorage.hydrate?.()).toBe(true);
        let publishNewerSecond = false;
        createStore({
            storage: firstStorage,
            sanitize: (value) => {
                if (publishNewerSecond && readCount(value) === 1) {
                    publishNewerSecond = false;
                    const nested = runWithAutomergeStorageTransaction(undefined, () => {
                        secondStorage.set({ count: 2 });
                    });
                    nested.commit();
                }
                return sanitizeCount(value);
            },
        });
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            firstStorage.set({ count: 1 });
            secondStorage.set({ count: 1 });
        });
        publishNewerSecond = true;

        transaction.commit();

        expect(doc).toEqual({ first: { count: 1 }, second: { count: 2 } });
        expect(secondStorage.get()).toEqual({ count: 2 });
        expect(mutations).toHaveLength(2);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('lets projection reset invalidate a committed execution before its terminal can reinstall stale cache', () => {
        const { doc, mutations, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: -1 }),
        });
        expect(storage.hydrate?.()).toBe(true);
        let resetDuringProjection = false;
        createStore({
            storage,
            sanitize: (value) => {
                if (resetDuringProjection && readCount(value) === 1) {
                    resetDuringProjection = false;
                    resetAutomergeStorageProjections('root');
                }
                return sanitizeCount(value);
            },
        });
        const transaction = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
        resetDuringProjection = true;

        transaction.commit();

        expect(doc.state).toEqual({ count: 1 });
        expect(storage.get()).toEqual({ count: -1 });
        expect(mutations).toHaveLength(1);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('settles a published write and reports committed when its terminal local projection throws', () => {
        const { doc, mutations, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        const projectionFailure = new Error('terminal projection failed');
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            projectCommittedLocalState: () => {
                throw projectionFailure;
            },
        });
        expect(storage.hydrate?.()).toBe(true);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));

        expect(() => transaction.commit()).toThrow(AutomergeStorageTransactionCommittedError);
        expect(doc.state).toEqual({ count: 1 });
        expect(mutations).toHaveLength(1);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        flushAutomergeStorageWrites();
        expect(mutations).toHaveLength(1);
        expect(() => transaction.scope(() => storage.set({ count: 2 }))).toThrow(/committed/);
    });

    it('continues remaining committed terminals when one fresh document read throws', () => {
        const doc: TestDoc = { first: { count: 0 }, second: { count: 0 } };
        let failNextRead = false;
        let mutationCount = 0;
        configureAutomergeStoragePort({
            getDoc: () => {
                if (failNextRead) {
                    failNextRead = false;
                    throw new Error('terminal document read failed');
                }
                return doc;
            },
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
                mutationCount += 1;
                failNextRead = true;
            },
        });
        const firstStorage = createAutomergeStorage<{ count: number }>('root', 'first');
        const secondStorage = createAutomergeStorage<{ count: number }>('root', 'second');
        expect(firstStorage.hydrate?.()).toBe(true);
        expect(secondStorage.hydrate?.()).toBe(true);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            firstStorage.set({ count: 1 });
            secondStorage.set({ count: 1 });
        });

        expect(() => transaction.commit()).toThrow(AutomergeStorageTransactionCommittedError);
        expect(doc).toEqual({ first: { count: 1 }, second: { count: 1 } });
        expect(firstStorage.get()).toEqual({ count: 0 });
        expect(secondStorage.get()).toEqual({ count: 1 });
        expect(mutationCount).toBe(1);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        flushAutomergeStorageWrites();
        expect(mutationCount).toBe(1);
    });

    it('preserves same-slot authority committed by a terminal local-state callback', () => {
        const { doc, mutations, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        let publishNested = false;
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            projectCommittedLocalState: ({ authorityValue }) => {
                if (publishNested) {
                    publishNested = false;
                    const nested = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 2 }));
                    nested.commit();
                }
                return authorityValue;
            },
        });
        expect(storage.hydrate?.()).toBe(true);
        const outer = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
        publishNested = true;

        outer.commit();

        expect(doc.state).toEqual({ count: 2 });
        expect(storage.get()).toEqual({ count: 2 });
        expect(mutations).toHaveLength(2);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('does not stamp stale hydrate metadata after pending rebase resets projection authority', () => {
        const { doc, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        let resetDuringRebase = false;
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: -1 }),
            rebasePending: ({ pendingValue }) => {
                if (resetDuringRebase) {
                    resetDuringRebase = false;
                    resetAutomergeStorageProjections('root');
                }
                return pendingValue;
            },
        });
        expect(storage.hydrate?.()).toBe(true);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
        doc.state = { count: 2 };
        resetDuringRebase = true;

        expect(storage.hydrate?.()).toBe(false);
        expect(storage.get()).toEqual({ count: -1 });

        expect(storage.hydrate?.()).toBe(true);
        expect(storage.get()).toEqual({ count: 2 });
        expect(doc.state).toEqual({ count: 2 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        transaction.abort();
    });

    it('projects current document authority after publication throws', () => {
        const doc: TestDoc = { state: { count: 0 } };
        let mutationCount = 0;
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
                mutationCount += 1;
                doc.state = { count: 2 };
                throw new Error('publication receipt failed');
            },
        });
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));

        expect(() => transaction.commit()).toThrow(AutomergeStorageTransactionCommittedError);

        const freshStorage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(freshStorage.hydrate?.()).toBe(true);
        expect(doc.state).toEqual({ count: 2 });
        expect(storage.get()).toEqual({ count: 2 });
        expect(freshStorage.get()).toEqual({ count: 2 });
        expect(mutationCount).toBe(1);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        flushAutomergeStorageWrites();
        expect(mutationCount).toBe(1);
    });

    it('keeps a clear committed by a listener after the outer publication', () => {
        const doc: TestDoc = { state: { count: 0 } };
        let afterPublication: (() => void) | undefined;
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
                const listener = afterPublication;
                afterPublication = undefined;
                listener?.();
            },
        });
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: -1 }),
        });
        expect(storage.hydrate?.()).toBe(true);
        const outer = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
        afterPublication = () => {
            const clearing = runWithAutomergeStorageTransaction(undefined, () => storage.clear());
            clearing.commit();
        };

        outer.commit();

        expect(Object.hasOwn(doc, 'state')).toBe(false);
        expect(storage.get()).toBeNull();
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('keeps the outer value when a nested clear lands during its preparation', () => {
        const { doc, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        let clearDuringPreparation = false;
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: -1 }),
            toCrdt: (value) => {
                if (clearDuringPreparation) {
                    clearDuringPreparation = false;
                    const clearing = runWithAutomergeStorageTransaction(undefined, () => storage.clear());
                    clearing.commit();
                }
                return value;
            },
        });
        expect(storage.hydrate?.()).toBe(true);
        const outer = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
        clearDuringPreparation = true;

        outer.commit();

        expect(doc.state).toEqual({ count: 1 });
        expect(storage.get()).toEqual({ count: 1 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('freezes owner metadata captured before hydration and passes it to rebase and mutation', () => {
        type Metadata = { steps: Array<{ before: number | null; next: number | null }> };
        const { doc, port } = createTestPort({ initialDoc: { state: { count: 0 } } });
        configureAutomergeStoragePort(port);
        const rebasedMetadata: Metadata[] = [];
        const mutatedMetadata: Metadata[] = [];
        const storage = createAutomergeStorage<{ count: number }, Metadata>('root', 'state', {
            writeMetadata: {
                capture: ({ beforeValue, nextValue }) => ({
                    steps: [{ before: beforeValue?.count ?? null, next: nextValue?.count ?? null }],
                }),
                reduce: ({ current, captured }) => ({
                    steps: (current?.steps ?? []).concat(captured.steps),
                }),
            },
            rebasePending: ({ hydratedValue, metadata }) => {
                expect(Object.isFrozen(metadata)).toBe(true);
                expect(Object.isFrozen(metadata?.steps)).toBe(true);
                rebasedMetadata.push(structuredClone(metadata!));
                return { count: metadata?.steps.at(-1)?.next ?? hydratedValue.count };
            },
            mutateCrdt: ({ baseValue, metadata, reconcile, value }) => {
                expect(Object.isFrozen(metadata)).toBe(true);
                expect(Object.isFrozen(metadata?.steps)).toBe(true);
                mutatedMetadata.push(structuredClone(metadata!));
                reconcile(value, baseValue);
            },
        });
        expect(storage.hydrate?.()).toBe(true);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
        doc.state = { count: 2 };

        expect(storage.hydrate?.()).toBe(true);
        transaction.commit();

        const expected = { steps: [{ before: 0, next: 1 }] };
        expect(rebasedMetadata).toEqual([expected]);
        expect(mutatedMetadata).toEqual([expected]);
        expect(doc.state).toEqual({ count: 1 });
    });

    it('lets an opted-in mutation hook process a clear with its captured preimage', () => {
        type Metadata = { before: number | null; next: number | null };
        const { doc, port } = createTestPort({ initialDoc: { state: { count: 4 } } });
        configureAutomergeStoragePort(port);
        const observed: Array<{ metadata: Metadata | null; value: { count: number } | null }> = [];
        const storage = createAutomergeStorage<{ count: number }, Metadata>('root', 'state', {
            writeMetadata: {
                capture: ({ beforeValue, nextValue }) => ({
                    before: beforeValue?.count ?? null,
                    next: nextValue?.count ?? null,
                }),
                reduce: ({ captured }) => captured,
            },
            mutateCrdt: ({ baseValue, metadata, reconcile, value }) => {
                observed.push({ metadata: structuredClone(metadata), value });
                reconcile(value, baseValue);
            },
        });
        expect(storage.hydrate?.()).toBe(true);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => storage.clear());

        transaction.commit();

        expect(observed).toEqual([{ metadata: { before: 4, next: null }, value: null }]);
        expect(Object.hasOwn(doc, 'state')).toBe(false);
    });

    it('captures one-shot metadata before semantic-message callbacks can author another write', () => {
        type Metadata = { intent: string | null };
        let activeIntent: string | null = 'outer-intent';
        let semanticCallbackRan = false;
        let nestedStorage: ReturnType<typeof createAutomergeStorage<{ count: number }, Metadata>>;
        const observed: Array<{ key: string; metadata: Metadata | null }> = [];
        const { port } = createTestPort({ initialDoc: { outer: { count: 0 }, nested: { count: 0 } } });
        configureAutomergeStoragePort({
            ...port,
            getSemanticMessage: () => {
                if (!semanticCallbackRan) {
                    semanticCallbackRan = true;
                    nestedStorage.set({ count: 1 });
                }
                return undefined;
            },
        });
        const options = {
            writeMetadata: {
                capture: () => {
                    const intent = activeIntent;
                    activeIntent = null;
                    return { intent };
                },
                reduce: ({ captured }: { captured: Metadata }) => captured,
            },
            mutateCrdt: ({
                baseValue,
                key,
                metadata,
                reconcile,
                value,
            }: {
                baseValue: Partial<{ count: number }> | null;
                key: string;
                metadata: Metadata | null;
                reconcile(value: { count: number } | null, baseValue: Partial<{ count: number }> | null): void;
                value: { count: number } | null;
            }) => {
                observed.push({ key, metadata: structuredClone(metadata) });
                reconcile(value, baseValue);
            },
        };
        const outerStorage = createAutomergeStorage<{ count: number }, Metadata>('root', 'outer', options);
        nestedStorage = createAutomergeStorage<{ count: number }, Metadata>('root', 'nested', options);
        expect(outerStorage.hydrate?.()).toBe(true);
        expect(nestedStorage.hydrate?.()).toBe(true);

        outerStorage.set({ count: 1 });
        flushAutomergeStorageWrites();

        expect(semanticCallbackRan).toBe(true);
        expect(observed).toEqual([
            { key: 'nested', metadata: { intent: null } },
            { key: 'outer', metadata: { intent: 'outer-intent' } },
        ]);
    });
});
