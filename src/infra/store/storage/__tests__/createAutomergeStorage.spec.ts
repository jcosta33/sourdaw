import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { createStore } from '../../createStore';
import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

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

    it('should preserve store initial data until late CRDT port registration hydrates it', () => {
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
        expect(mutations).toEqual([{ docId: 'root', message: undefined, snapshotTransaction: undefined }]);
        expect(doc.state).toEqual({ count: 7 });
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

    it('should write cached local data into the doc when hydrate finds a missing key', () => {
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);

        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        storage.set({ count: 9 });

        expect(storage.hydrate?.()).toBe(false);
        expect(mutations).toEqual([{ docId: 'root', message: undefined, snapshotTransaction: undefined }]);
        expect(doc.state).toEqual({ count: 9 });
    });

    it('flushes only writes owned by the requested snapshot transaction', () => {
        const snapshotTransaction = {};
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const ownedStorage = createAutomergeStorage<{ count: number }>('root', 'owned');
        const independentStorage = createAutomergeStorage<{ count: number }>('root', 'independent');

        runWithAutomergeStorageTransaction(snapshotTransaction, () => {
            ownedStorage.set({ count: 1 });
        });
        independentStorage.set({ count: 2 });

        flushAutomergeStorageWrites(snapshotTransaction);

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

    it('does not coalesce writes with different snapshot owners in one adapter', () => {
        const snapshotTransaction = {};
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        runWithAutomergeStorageTransaction(snapshotTransaction, () => {
            storage.set({ count: 1 });
        });
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

    it('commits same-document keys in one Automerge mutation', () => {
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);

        const arrangementStorage = createAutomergeStorage<TestDoc>('root', 'tracks');
        const midiStorage = createAutomergeStorage<TestDoc>('root', 'midi');
        runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
            midiStorage.set({ imported: true });
        });

        frameCallback?.(100);

        expect(mutations).toHaveLength(1);
        expect(doc).toEqual({
            tracks: { imported: true },
            midi: { imported: true },
        });
    });

    it('does not persist one key when a same-document multi-key commit fails', () => {
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
        runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
            midiStorage.set({ imported: true });
        });

        expect(() => flushAutomergeStorageWrites()).toThrow('MIDI write failed');
        expect(doc).toEqual({});
    });

    it('preserves semantic messages across ordinary action scopes', () => {
        let semanticMessage: string | undefined = 'First action';
        const { doc, mutations, port } = createTestPort({
            getSemanticMessage: () => semanticMessage,
        });
        configureAutomergeStoragePort(port);
        const arrangementStorage = createAutomergeStorage<TestDoc>('root', 'tracks');
        const midiStorage = createAutomergeStorage<TestDoc>('root', 'midi');

        runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
        });
        semanticMessage = 'Second action';
        runWithAutomergeStorageTransaction(undefined, () => {
            midiStorage.set({ imported: true });
        });

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

        runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
        });
        runWithAutomergeStorageTransaction(snapshotTransaction, () => {
            midiStorage.set({ imported: true });
        });

        const arrangementFrame = requestAnimationFrameMock.mock.calls[0]?.[0];
        arrangementFrame?.(100);

        expect(mutations).toEqual([{ docId: 'root', message: undefined, snapshotTransaction: undefined }]);
        expect(doc.tracks).toEqual({ imported: true });
        expect(doc.midi).toBeUndefined();

        flushAutomergeStorageWrites(snapshotTransaction);
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

        runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.set({ imported: true });
            midiStorage.set({ imported: true });
        });

        expect(() => flushAutomergeStorageWrites()).toThrow('MIDI preparation failed');
        expect(mutations).toEqual([]);
        expect(doc).toEqual({});
    });

    it('atomically clears same-action keys and surfaces commit failure', () => {
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

        runWithAutomergeStorageTransaction(undefined, () => {
            arrangementStorage.clear();
            midiStorage.clear();
        });

        expect(() => flushAutomergeStorageWrites()).toThrow('Clear commit failed');
        expect(doc).toEqual({
            tracks: { imported: true },
            midi: { imported: true },
        });
    });
});
