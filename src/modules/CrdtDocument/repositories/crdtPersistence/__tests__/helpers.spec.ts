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

    it('allows a later open after an upgrade request rolls back', async () => {
        const firstRequest = createMockRequest(createMockDatabase());
        const secondDatabase = createMockDatabase();
        const secondRequest = createMockRequest(secondDatabase);
        open.mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
        const { openDatabase } = await import('../helpers');

        const firstOpen = openDatabase();
        firstRequest.error = new DOMException('upgrade failed', 'AbortError');
        firstRequest.onerror?.();

        await expect(firstOpen).resolves.toBeNull();

        const secondOpen = openDatabase();
        expect(open).toHaveBeenCalledTimes(2);
        secondRequest.onsuccess?.();

        await expect(secondOpen).resolves.toBe(secondDatabase);
    });

    it('creates the document store during the initial upgrade', async () => {
        const database = createMockDatabase();
        database.objectStoreNames.contains = () => false;
        const request = createMockRequest(database);
        open.mockReturnValue(request);
        const { openDatabase } = await import('../helpers');

        const openPromise = openDatabase();
        request.onupgradeneeded?.();

        expect(database.createObjectStore).toHaveBeenCalledWith('documents');
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

    it('treats a synchronous IndexedDB open failure as unavailable and retries later', async () => {
        const database = createMockDatabase();
        const request = createMockRequest(database);
        open.mockImplementationOnce(() => {
            throw new DOMException('access denied', 'SecurityError');
        });
        open.mockReturnValueOnce(request);
        const { openDatabase } = await import('../helpers');

        await expect(openDatabase()).resolves.toBeNull();

        const retry = openDatabase();
        expect(open).toHaveBeenCalledTimes(2);
        request.onsuccess?.();

        await expect(retry).resolves.toBe(database);
    });
});
