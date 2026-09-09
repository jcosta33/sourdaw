import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockOpenRequest = {
    result: MockDatabase;
    error: DOMException | null;
    onupgradeneeded: (() => void) | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onblocked: (() => void) | null;
    transaction: { objectStore: ReturnType<typeof vi.fn> };
};

type MockObjectStore = {
    createIndex: ReturnType<typeof vi.fn>;
    indexNames: { contains: (name: string) => boolean };
};

type MockDatabase = {
    objectStoreNames: { contains: (name: string) => boolean };
    createObjectStore: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onversionchange: (() => void) | null;
};

function createMockObjectStore(): MockObjectStore {
    return { createIndex: vi.fn(), indexNames: { contains: () => false } };
}

function createMockDatabase(stores = new Map<string, MockObjectStore>()): MockDatabase {
    const createObjectStore = vi.fn((name: string) => {
        const store = createMockObjectStore();
        stores.set(name, store);
        return store;
    });
    return {
        objectStoreNames: { contains: () => true },
        createObjectStore,
        close: vi.fn(),
        onversionchange: null,
    };
}

function createMockRequest(database: MockDatabase, stores = new Map<string, MockObjectStore>()): MockOpenRequest {
    return {
        result: database,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        transaction: { objectStore: vi.fn((name: string) => stores.get(name)) },
    };
}

describe('crdt persistence database helper', () => {
    let open: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        open = vi.fn();
        vi.stubGlobal('indexedDB', { open });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('rejects an upgrade request failure and allows a later open', async () => {
        const firstRequest = createMockRequest(createMockDatabase());
        const secondDatabase = createMockDatabase();
        const secondRequest = createMockRequest(secondDatabase);
        open.mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
        const { openDatabase } = await import('../helpers');

        const firstOpen = openDatabase();
        firstRequest.error = new DOMException('upgrade failed', 'AbortError');
        firstRequest.onerror?.();

        const firstError = await firstOpen.catch((error: unknown) => error);
        expect(firstError).toMatchObject({
            message: '[CrdtPersistence] Failed to open IndexedDB',
            cause: firstRequest.error,
        });

        const secondOpen = openDatabase();
        expect(open).toHaveBeenCalledTimes(2);
        secondRequest.onsuccess?.();

        await expect(secondOpen).resolves.toBe(secondDatabase);
    });

    it('creates the document and checkpoint stores during the initial upgrade', async () => {
        const stores = new Map<string, MockObjectStore>();
        const database = createMockDatabase(stores);
        database.objectStoreNames.contains = () => false;
        const request = createMockRequest(database, stores);
        open.mockReturnValue(request);
        const { openDatabase } = await import('../helpers');

        const openPromise = openDatabase();
        request.onupgradeneeded?.();

        expect(database.createObjectStore).toHaveBeenCalledWith('documents');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-artifacts');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-catalog');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-owner-catalogs');
        expect(stores.get('checkpoint-artifacts')?.createIndex).toHaveBeenCalledWith(
            'ownerProjectId',
            'ownerProjectId'
        );
        expect(stores.get('checkpoint-catalog')?.createIndex).toHaveBeenCalledWith('ownerProjectId', 'ownerProjectId');
        request.onsuccess?.();

        await expect(openPromise).resolves.toBe(database);
    });

    it('adds checkpoint stores when upgrading an existing document database', async () => {
        const stores = new Map<string, MockObjectStore>();
        const database = createMockDatabase(stores);
        database.objectStoreNames.contains = (name) => name === 'documents';
        const request = createMockRequest(database, stores);
        open.mockReturnValue(request);
        const { openDatabase } = await import('../helpers');

        const openPromise = openDatabase();
        request.onupgradeneeded?.();

        expect(open).toHaveBeenCalledWith('sourdaw-crdt-docs', 3);
        expect(database.createObjectStore).not.toHaveBeenCalledWith('documents');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-artifacts');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-catalog');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-owner-catalogs');
        expect(stores.get('checkpoint-artifacts')?.createIndex).toHaveBeenCalledWith(
            'ownerProjectId',
            'ownerProjectId'
        );
        expect(stores.get('checkpoint-catalog')?.createIndex).toHaveBeenCalledWith('ownerProjectId', 'ownerProjectId');
        request.onsuccess?.();

        await expect(openPromise).resolves.toBe(database);
    });

    it('adds owner indexes and state when upgrading an existing checkpoint database', async () => {
        const stores = new Map<string, MockObjectStore>([
            ['checkpoint-artifacts', createMockObjectStore()],
            ['checkpoint-catalog', createMockObjectStore()],
        ]);
        const database = createMockDatabase(stores);
        database.objectStoreNames.contains = (name) =>
            name === 'documents' || name === 'checkpoint-artifacts' || name === 'checkpoint-catalog';
        const request = createMockRequest(database, stores);
        open.mockReturnValue(request);
        const { openDatabase } = await import('../helpers');

        const openPromise = openDatabase();
        request.onupgradeneeded?.();

        expect(database.createObjectStore).not.toHaveBeenCalledWith('checkpoint-artifacts');
        expect(database.createObjectStore).not.toHaveBeenCalledWith('checkpoint-catalog');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-owner-catalogs');
        expect(request.transaction.objectStore).toHaveBeenCalledWith('checkpoint-artifacts');
        expect(request.transaction.objectStore).toHaveBeenCalledWith('checkpoint-catalog');
        expect(stores.get('checkpoint-artifacts')?.createIndex).toHaveBeenCalledWith(
            'ownerProjectId',
            'ownerProjectId'
        );
        expect(stores.get('checkpoint-catalog')?.createIndex).toHaveBeenCalledWith('ownerProjectId', 'ownerProjectId');
        request.onsuccess?.();

        await expect(openPromise).resolves.toBe(database);
    });

    it('closes and invalidates the cached connection during a version change', async () => {
        const firstDatabase = createMockDatabase();
        const firstRequest = createMockRequest(firstDatabase);
        const secondDatabase = createMockDatabase();
        const secondRequest = createMockRequest(secondDatabase);
        open.mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
        const { openDatabase } = await import('../helpers');

        const firstOpen = openDatabase();
        firstRequest.onsuccess?.();
        await expect(firstOpen).resolves.toBe(firstDatabase);

        firstDatabase.onversionchange?.();
        expect(firstDatabase.close).toHaveBeenCalledOnce();

        const secondOpen = openDatabase();
        expect(open).toHaveBeenCalledTimes(2);
        secondRequest.onsuccess?.();

        await expect(secondOpen).resolves.toBe(secondDatabase);
    });

    it('rejects a synchronous IndexedDB open failure and retries later', async () => {
        const database = createMockDatabase();
        const request = createMockRequest(database);
        const failure = new DOMException('access denied', 'SecurityError');
        open.mockImplementationOnce(() => {
            throw failure;
        });
        open.mockReturnValueOnce(request);
        const { openDatabase } = await import('../helpers');

        const firstOpen = openDatabase();
        const concurrentOpen = openDatabase();
        expect(concurrentOpen).toBe(firstOpen);
        const firstError = await firstOpen.catch((error: unknown) => error);
        expect(firstError).toMatchObject({
            message: '[CrdtPersistence] Failed to open IndexedDB',
            cause: failure,
        });
        await expect(concurrentOpen).rejects.toBe(firstError);

        const retry = openDatabase();
        expect(open).toHaveBeenCalledTimes(2);
        request.onsuccess?.();

        await expect(retry).resolves.toBe(database);
    });

    it('settles concurrent callers with one operational failure and permits a retry', async () => {
        const firstRequest = createMockRequest(createMockDatabase());
        const secondDatabase = createMockDatabase();
        const secondRequest = createMockRequest(secondDatabase);
        open.mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
        const { openDatabase } = await import('../helpers');

        const firstOpen = openDatabase();
        const concurrentOpen = openDatabase();
        expect(concurrentOpen).toBe(firstOpen);

        firstRequest.error = new DOMException('blocked', 'InvalidStateError');
        firstRequest.onerror?.();

        const firstError = await firstOpen.catch((error: unknown) => error);
        expect(firstError).toMatchObject({
            message: '[CrdtPersistence] Failed to open IndexedDB',
            cause: firstRequest.error,
        });
        await expect(concurrentOpen).rejects.toBe(firstError);

        const retry = openDatabase();
        expect(open).toHaveBeenCalledTimes(2);
        secondRequest.onsuccess?.();

        await expect(retry).resolves.toBe(secondDatabase);
    });

    it('keeps a newer connection when a stale request reports failure', async () => {
        const firstDatabase = createMockDatabase();
        const firstRequest = createMockRequest(firstDatabase);
        const secondDatabase = createMockDatabase();
        const secondRequest = createMockRequest(secondDatabase);
        open.mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
        const { openDatabase } = await import('../helpers');

        const firstOpen = openDatabase();
        firstRequest.onsuccess?.();
        await expect(firstOpen).resolves.toBe(firstDatabase);

        firstDatabase.onversionchange?.();
        const secondOpen = openDatabase();
        firstRequest.error = new DOMException('stale failure', 'AbortError');
        firstRequest.onerror?.();
        secondRequest.onsuccess?.();

        await expect(secondOpen).resolves.toBe(secondDatabase);
        await expect(openDatabase()).resolves.toBe(secondDatabase);
    });

    it('returns null only when IndexedDB is unsupported', async () => {
        vi.stubGlobal('indexedDB', undefined);
        const { openDatabase } = await import('../helpers');

        await expect(openDatabase()).resolves.toBeNull();
    });

    it('invalidates an open disposed before upgrade and uses a fresh successor without resetting the helper', async () => {
        const { installTransactionalIndexedDb } = await import('#/infra/testing/installTransactionalIndexedDb');
        const first = installTransactionalIndexedDb();
        let second: ReturnType<typeof installTransactionalIndexedDb> | null = null;

        try {
            const { openDatabase } = await import('../helpers');
            const firstOpen = openDatabase();
            const disposal = first.dispose();
            await expect(firstOpen).resolves.not.toBeNull();
            await disposal;

            second = installTransactionalIndexedDb();
            const secondOpen = openDatabase();
            const secondDatabase = await secondOpen;

            expect(secondOpen).not.toBe(firstOpen);
            expect(secondDatabase).not.toBeNull();
            expect(secondDatabase?.objectStoreNames.contains('documents')).toBe(true);
        } finally {
            await second?.dispose();
            await first.dispose();
        }
    });

    it('invalidates an open disposed inside upgrade and uses a fresh successor without resetting the helper', async () => {
        const { installTransactionalIndexedDb } = await import('#/infra/testing/installTransactionalIndexedDb');
        const first = installTransactionalIndexedDb();
        const firstFactory = indexedDB;
        const open = firstFactory.open.bind(firstFactory);
        const lifecycle: { disposal: Promise<void> | null } = { disposal: null };
        firstFactory.open = (name, version) => {
            const request = version === undefined ? open(name) : open(name, version);
            request.addEventListener('upgradeneeded', () => {
                lifecycle.disposal = first.dispose();
            });
            return request;
        };

        let second: ReturnType<typeof installTransactionalIndexedDb> | null = null;
        try {
            const { openDatabase } = await import('../helpers');
            const firstOpen = openDatabase();
            await expect(firstOpen).resolves.not.toBeNull();
            if (!lifecycle.disposal) {
                throw new Error('Expected disposal to start during upgrade');
            }
            await lifecycle.disposal;

            second = installTransactionalIndexedDb();
            const secondOpen = openDatabase();
            const secondDatabase = await secondOpen;

            expect(secondOpen).not.toBe(firstOpen);
            expect(secondDatabase).not.toBeNull();
            expect(secondDatabase?.objectStoreNames.contains('documents')).toBe(true);
        } finally {
            await second?.dispose();
            await first.dispose();
        }
    });
});
