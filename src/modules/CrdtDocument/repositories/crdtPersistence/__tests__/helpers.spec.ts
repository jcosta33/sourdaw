import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockOpenRequest = {
    result: MockDatabase;
    error: DOMException | null;
    onupgradeneeded: (() => void) | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onblocked: (() => void) | null;
};

type MockDatabase = {
    objectStoreNames: { contains: (name: string) => boolean };
    createObjectStore: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onversionchange: (() => void) | null;
};

function createMockDatabase(): MockDatabase {
    return {
        objectStoreNames: { contains: () => true },
        createObjectStore: vi.fn(),
        close: vi.fn(),
        onversionchange: null,
    };
}

function createMockRequest(database: MockDatabase): MockOpenRequest {
    return {
        result: database,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
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
        const database = createMockDatabase();
        database.objectStoreNames.contains = () => false;
        const request = createMockRequest(database);
        open.mockReturnValue(request);
        const { openDatabase } = await import('../helpers');

        const openPromise = openDatabase();
        request.onupgradeneeded?.();

        expect(database.createObjectStore).toHaveBeenCalledWith('documents');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-artifacts');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-catalog');
        request.onsuccess?.();

        await expect(openPromise).resolves.toBe(database);
    });

    it('adds checkpoint stores when upgrading an existing document database', async () => {
        const database = createMockDatabase();
        database.objectStoreNames.contains = (name) => name === 'documents';
        const request = createMockRequest(database);
        open.mockReturnValue(request);
        const { openDatabase } = await import('../helpers');

        const openPromise = openDatabase();
        request.onupgradeneeded?.();

        expect(open).toHaveBeenCalledWith('sourdaw-crdt-docs', 2);
        expect(database.createObjectStore).not.toHaveBeenCalledWith('documents');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-artifacts');
        expect(database.createObjectStore).toHaveBeenCalledWith('checkpoint-catalog');
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
});
