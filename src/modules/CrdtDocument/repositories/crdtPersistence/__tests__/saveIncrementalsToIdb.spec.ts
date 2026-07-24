import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { encodePersistenceAuthority } from '../encodePersistenceAuthority';
import { openDatabase } from '../helpers';
import {
    EMPTY_PERSISTENCE_AUTHORITY,
    PERSISTENCE_AUTHORITY_KEY,
    type CrdtPersistenceAuthority,
} from '../persistenceAuthorityModel';
import { saveIncrementalsToIdb, type IncrementalChunk } from '../saveIncrementalsToIdb';

vi.mock('../helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: vi.fn(),
}));

type MockRequest<T = unknown> = {
    result: T;
    error: Error | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
};

type MockStore = {
    get: Mock<() => MockRequest>;
    add: Mock<(value: unknown, key: string) => void>;
    put: Mock<(value: unknown, key: string) => void>;
    getAllKeys: Mock<() => MockRequest<IDBValidKey[]>>;
    getAll: Mock<() => MockRequest<unknown[]>>;
};

type MockTransaction = {
    objectStore: Mock<() => MockStore>;
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
    error: Error | null;
    abort: Mock<() => void>;
};

function createMockRequest<T>(result: T): MockRequest<T> {
    return { result, error: null, onsuccess: null, onerror: null };
}

/**
 * Build a (store, tx, db) triple where the authority read resolves with the
 * given authority and the transaction completes synchronously when awaited.
 */
function setupTransaction(
    authority: CrdtPersistenceAuthority | undefined,
    store?: Partial<MockStore>
): { store: MockStore; tx: MockTransaction; db: { transaction: Mock } } {
    const fullStore: MockStore = {
        get: vi.fn<() => MockRequest>().mockImplementation(() => {
            const request: MockRequest = {
                result: authority === undefined ? undefined : encodePersistenceAuthority(authority),
                error: null,
                onsuccess: null,
                onerror: null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        }),
        add: vi.fn<(value: unknown, key: string) => void>(),
        put: vi.fn<(value: unknown, key: string) => void>(),
        getAllKeys: vi.fn(() => createMockRequest<IDBValidKey[]>(['root'])),
        getAll: vi.fn(() => createMockRequest<unknown[]>([new Uint8Array([1])])),
        ...store,
    };
    const tx: MockTransaction = {
        objectStore: vi.fn(() => fullStore),
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        abort: vi.fn(),
    };
    const db = { transaction: vi.fn(() => tx) };
    return { store: fullStore, tx, db };
}

function auth(epoch: string, revision: number, rootLineage = 'main'): CrdtPersistenceAuthority {
    return { epoch, revision, rootLineage };
}

/** Drain the microtask queue enough for the mocked authority read to resolve. */
async function flushAuthorityRead(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('saveIncrementalsToIdb', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('empty-input short-circuit', () => {
        it('returns committed with the EMPTY authority when given no chunks and no expected authority', async () => {
            const result = await saveIncrementalsToIdb([]);

            expect(result).toEqual({ status: 'committed', authority: EMPTY_PERSISTENCE_AUTHORITY });
            expect(openDatabase).not.toHaveBeenCalled();
        });

        it('returns committed with the expected authority when all chunks are zero-length', async () => {
            const expected = auth('e1', 3);
            const chunks: IncrementalChunk[] = [
                { id: 'root', chunk: new Uint8Array() },
                { id: 'branch', chunk: new Uint8Array() },
            ];

            const result = await saveIncrementalsToIdb(chunks, { expectedAuthority: expected });

            // Empty chunks are dropped before any persistence — the authority is
            // returned UNADVANCED because nothing was actually written.
            expect(result).toEqual({ status: 'committed', authority: expected });
            expect(openDatabase).not.toHaveBeenCalled();
        });

        it('drops zero-length chunks but persists the remaining non-empty ones', async () => {
            const expected = auth('e1', 3);
            const { store, tx, db } = setupTransaction(expected);
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

            const promise = saveIncrementalsToIdb(
                [
                    { id: 'root', chunk: new Uint8Array() },
                    { id: 'root', chunk: new Uint8Array([9, 9]) },
                ],
                { expectedAuthority: expected }
            );
            await flushAuthorityRead();
            tx.oncomplete!();
            const result = await promise;

            expect(result).toMatchObject({ status: 'committed' });
            expect(store.add).toHaveBeenCalledTimes(1);
            expect(store.add).toHaveBeenCalledWith(new Uint8Array([9, 9]), expect.stringMatching(/^root:incremental:/));
        });
    });

    describe('unavailable persistence', () => {
        it('returns committed with an ADVANCED authority when IndexedDB is unavailable', async () => {
            vi.mocked(openDatabase).mockResolvedValue(null);

            const result = await saveIncrementalsToIdb([{ id: 'root', chunk: new Uint8Array([1]) }], {
                expectedAuthority: auth('e1', 4),
            });

            // No durable store, but the write is acknowledged with a bumped
            // revision so in-memory authority stays ahead of any later reload.
            expect(result).toEqual({ status: 'committed', authority: auth('e1', 5) });
        });

        it('advances the EMPTY authority when IDB is unavailable and no expected authority was supplied', async () => {
            vi.mocked(openDatabase).mockResolvedValue(null);

            const result = await saveIncrementalsToIdb([{ id: 'root', chunk: new Uint8Array([1]) }]);

            expect(result).toEqual({ status: 'committed', authority: auth('', 1) });
        });
    });

    describe('happy-path commit', () => {
        it('assigns monotonically increasing seq suffixes across multiple chunks in one write', async () => {
            const expected = auth('e1', 2);
            const { store, tx, db } = setupTransaction(expected);
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

            const promise = saveIncrementalsToIdb(
                [
                    { id: 'beta', chunk: new Uint8Array([1]) },
                    { id: 'alpha', chunk: new Uint8Array([2]) },
                    { id: 'gamma', chunk: new Uint8Array([3]) },
                ],
                { expectedAuthority: expected }
            );
            await flushAuthorityRead();
            tx.oncomplete!();
            const result = await promise;

            expect(result).toMatchObject({ status: 'committed', authority: auth('e1', 3) });

            // Keys must be sorted by id (alpha < beta < gamma) and carry a seq
            // that increments from the current revision (2 -> base36 "2","3","4").
            const calls = store.add.mock.calls as [Uint8Array, string][];
            const ids = calls.map(([, key]) => key.substring(0, key.indexOf(':incremental:')));
            expect(ids).toEqual(['alpha', 'beta', 'gamma']);
            const seqs = calls.map(([, key]) => {
                const token = key.split(':').pop()!;
                return token.slice(token.indexOf('-') + 1);
            });
            expect(seqs).toEqual(['2', '3', '4']);
            // The advanced authority is persisted under its reserved key.
            expect(store.put).toHaveBeenCalledWith(
                encodePersistenceAuthority(auth('e1', 3)),
                PERSISTENCE_AUTHORITY_KEY
            );
        });

        it('commits without an expected-authority check when none is supplied', async () => {
            const current = auth('e1', 10);
            const { store, tx, db } = setupTransaction(current);
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

            const promise = saveIncrementalsToIdb([{ id: 'root', chunk: new Uint8Array([1]) }]);
            await flushAuthorityRead();
            tx.oncomplete!();
            const result = await promise;

            expect(result).toMatchObject({ status: 'committed', authority: auth('e1', 11) });
            expect(store.getAllKeys).not.toHaveBeenCalled();
            expect(store.getAll).not.toHaveBeenCalled();
        });

        it('writes each same-id chunk as its own append-only record', async () => {
            const expected = auth('e1', 5);
            const { store, tx, db } = setupTransaction(expected);
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

            const promise = saveIncrementalsToIdb(
                [
                    { id: 'root', chunk: new Uint8Array([1]) },
                    { id: 'root', chunk: new Uint8Array([2]) },
                ],
                { expectedAuthority: expected }
            );
            await flushAuthorityRead();
            tx.oncomplete!();
            await promise;

            // Two distinct append-only records under the same doc id, each with a
            // strictly increasing seq derived from the current revision (5,6).
            const calls = store.add.mock.calls as [Uint8Array, string][];
            expect(calls).toHaveLength(2);
            const seqs = calls.map(([, key]) => {
                const token = key.split(':').pop()!;
                return token.slice(token.indexOf('-') + 1);
            });
            expect(seqs).toEqual(['5', '6']);
        });
    });

    describe('conflict detection', () => {
        it('returns conflict with the stored bundle when the IDB authority diverges from expected', async () => {
            const expected = auth('e1', 2);
            const stored = auth('e1', 9); // someone else wrote ahead
            const { store, tx, db } = setupTransaction(stored);
            store.getAllKeys.mockReturnValue(createMockRequest<IDBValidKey[]>(['root', PERSISTENCE_AUTHORITY_KEY]));
            store.getAll.mockReturnValue(
                createMockRequest<unknown[]>([new Uint8Array([7, 7]), encodePersistenceAuthority(stored)])
            );
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

            const promise = saveIncrementalsToIdb([{ id: 'root', chunk: new Uint8Array([1]) }], {
                expectedAuthority: expected,
            });
            await flushAuthorityRead();
            tx.oncomplete!();
            const result = await promise;

            // Critical data-safety invariant: a divergent authority must NOT let
            // the writer append chunks; instead it reports the current state.
            expect(result.status).toBe('conflict');
            if (result.status !== 'conflict') {
                throw new Error('expected conflict');
            }
            expect(result.authority).toEqual(stored);
            expect(store.add).not.toHaveBeenCalled();
            // The conflict bundle reflects what is actually on disk, minus the
            // reserved authority key.
            expect([...result.bundle.keys()]).toEqual(['root']);
            expect(result.bundle.get('root')).toEqual(new Uint8Array([7, 7]));
        });

        it('does not treat a matching expected authority as a conflict', async () => {
            const matching = auth('e1', 2);
            const { store, tx, db } = setupTransaction(matching);
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

            const promise = saveIncrementalsToIdb([{ id: 'root', chunk: new Uint8Array([1]) }], {
                expectedAuthority: matching,
            });
            await flushAuthorityRead();
            tx.oncomplete!();
            const result = await promise;

            expect(result.status).toBe('committed');
            expect(store.getAllKeys).not.toHaveBeenCalled();
        });

        it('rejects when the conflict snapshot cannot be decoded (corrupted record)', async () => {
            const expected = auth('e1', 2);
            const stored = auth('e1', 9);
            const { store, tx, db } = setupTransaction(stored);
            // A persisted value that is not a Uint8Array is invalid; decoding it
            // must throw rather than silently produce a malformed bundle.
            store.getAllKeys.mockReturnValue(createMockRequest<IDBValidKey[]>(['root']));
            store.getAll.mockReturnValue(createMockRequest<unknown[]>(['not-bytes']));
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

            const promise = saveIncrementalsToIdb([{ id: 'root', chunk: new Uint8Array([1]) }], {
                expectedAuthority: expected,
            });
            await flushAuthorityRead();
            tx.oncomplete!();

            await expect(promise).rejects.toThrow('Invalid persisted record');
        });
    });

    describe('failure handling', () => {
        it('rejects when the transaction aborts', async () => {
            const { tx, db } = setupTransaction(auth('e1', 1));
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

            const promise = saveIncrementalsToIdb([{ id: 'root', chunk: new Uint8Array([1]) }]);
            await Promise.resolve();
            tx.error = new Error('aborted by queue');
            tx.onabort!();

            await expect(promise).rejects.toThrow('aborted by queue');
        });

        it('rejects with a fallback message when the transaction aborts without an error', async () => {
            const { tx, db } = setupTransaction(auth('e1', 1));
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

            const promise = saveIncrementalsToIdb([{ id: 'root', chunk: new Uint8Array([1]) }]);
            await Promise.resolve();
            tx.onabort!();

            await expect(promise).rejects.toThrow('IDB transaction aborted');
        });

        it('rejects when the transaction errors', async () => {
            const { tx, db } = setupTransaction(auth('e1', 1));
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);
            const failure = new Error('quota exceeded');

            const promise = saveIncrementalsToIdb([{ id: 'root', chunk: new Uint8Array([1]) }]);
            await Promise.resolve();
            tx.error = failure;
            tx.onerror!();

            await expect(promise).rejects.toBe(failure);
        });

        it('rejects when the authority read request errors', async () => {
            const store: MockStore = {
                get: vi.fn(() => {
                    const request: MockRequest = {
                        result: undefined,
                        error: null,
                        onsuccess: null,
                        onerror: null,
                    };
                    queueMicrotask(() => request.onerror?.());
                    return request;
                }),
                add: vi.fn(),
                put: vi.fn(),
                getAllKeys: vi.fn(),
                getAll: vi.fn(),
            };
            const tx: MockTransaction = {
                objectStore: vi.fn(() => store),
                oncomplete: null,
                onerror: null,
                onabort: null,
                error: null,
                abort: vi.fn(),
            };
            const db = { transaction: vi.fn(() => tx) };
            vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

            const promise = saveIncrementalsToIdb([{ id: 'root', chunk: new Uint8Array([1]) }]);
            await Promise.resolve();
            await Promise.resolve();
            // The authority request errored; surface its error.
            (store.get.mock.results[0]!.value as MockRequest).error = new Error('authority read failed');
            // onerror was already scheduled above; the rejection uses the request error.
            await expect(promise).rejects.toThrow('authority read failed');
        });
    });
});
