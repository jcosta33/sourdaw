import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { createStore } from '../../createStore';
import { configureAutomergeStoragePort, createAutomergeStorage } from '../createAutomergeStorage';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

type MutationRecord = {
    docId: string;
    message: string | undefined;
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
        mutateDoc: ({ docId, changeFn, message }) => {
            changeFn(doc);
            mutations.push({ docId, message });
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
        expect(mutations).toEqual([{ docId: 'root', message: undefined }]);
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

        expect(mutations).toEqual([{ docId: 'root', message: 'first change' }]);
        expect(doc.state).toEqual({ count: 2 });
    });

    it('should cancel a pending frame and immediately delete the CRDT key on clear', () => {
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

        expect(cancelAnimationFrameMock).toHaveBeenCalledWith(42);
        expect(mutations).toEqual([{ docId: 'root', message: 'clear write' }]);
        expect(Object.hasOwn(doc, 'state')).toBe(false);
        expect(storage.get()).toBeNull();
    });

    it('should hydrate through JSON stripping, fromCrdt normalization, and partial CRDT merge', () => {
        const fromCrdt = vi.fn(
            (value: { count: number; dropped?: undefined }): { count: number; normalized: boolean } => {
                expect(Object.hasOwn(value, 'dropped')).toBe(false);
                return { count: value.count + 1, normalized: true };
            }
        );
        const { port } = createTestPort({
            initialDoc: {
                state: {
                    count: 4,
                    dropped: undefined,
                },
            },
        });
        configureAutomergeStoragePort(port);

        const storage = createAutomergeStorage<{ count: number; local: string; normalized?: boolean }>(
            'root',
            'state',
            {
                fromCrdt,
                toCrdt: (value) => ({ count: value.count }),
            }
        );

        storage.set({ count: 1, local: 'kept' });

        expect(storage.hydrate?.()).toBe(true);
        expect(storage.get()).toEqual({ count: 5, local: 'kept', normalized: true });
    });

    it('should write cached local data into the doc when hydrate finds a missing key', () => {
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);

        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        storage.set({ count: 9 });

        expect(storage.hydrate?.()).toBe(false);
        expect(mutations).toEqual([{ docId: 'root', message: undefined }]);
        expect(doc.state).toEqual({ count: 9 });
    });

    it('should project an explicit missing value without copying cached source data', () => {
        const { doc, mutations, port } = createTestPort();
        configureAutomergeStoragePort(port);

        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: 0 }),
        });
        storage.set({ count: 9 });

        expect(storage.hydrate?.()).toBe(true);
        expect(storage.get()).toEqual({ count: 0 });
        expect(mutations).toEqual([]);
        expect(doc.state).toBeUndefined();
    });
});
