import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { isTauri } from '#/utils/tauriBridge';

import { type LibraryRoot, type SampleRecord, toBpm } from '../../../models/LibraryTypes';
import { addLibraryRoot, addSamples, setActiveRoot, type LibraryState } from '../../../stores/libraryStore';
import { readTauriDirectory } from '../../readTauriDirectory';
import * as helpers from '../helpers';
import { persistLibraryRoots } from '../persistLibraryRoots';
import { persistSamples, ACTIVE_ROOT_KEY } from '../persistSamples';
import { requestPermission } from '../requestPermission';
import { restoreLibrary } from '../restoreLibrary';

// Mutable stand-in for the store: the real `Store.value` is a readonly getter, so
// tests drive state through this hoisted object instead of assigning through it.
const mockLibraryStore = vi.hoisted(() => ({ value: null as LibraryState | null }));

vi.mock('../../../stores/libraryStore', () => ({
    libraryStore: mockLibraryStore,
    addLibraryRoot: vi.fn(),
    addSamples: vi.fn(),
    updateLibraryRootStatus: vi.fn(),
    setActiveRoot: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
}));

vi.mock('../../readTauriDirectory', () => ({
    readTauriDirectory: vi.fn(),
}));

const mockNotificationEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
};

function createReadRequest<TResult>(result: TResult): {
    result: TResult;
    onsuccess?: () => void;
    onerror?: () => void;
} {
    const request: { result: TResult; onsuccess?: () => void; onerror?: () => void } = { result };
    queueMicrotask(() => request.onsuccess?.());
    return request;
}

type RestoreDbInput = {
    roots: LibraryRoot[];
    handles?: Array<{ id: string; handle: FileSystemDirectoryHandle }>;
    samples?: unknown[];
};

function createRestoreDb({ roots, handles = [], samples = [] }: RestoreDbInput) {
    return {
        transaction: () => ({
            objectStore: (name: string) => ({
                getAll: () => {
                    if (name === 'roots') {
                        return createReadRequest(roots);
                    }
                    if (name === 'handles') {
                        return createReadRequest(handles);
                    }
                    if (name === 'samples') {
                        return createReadRequest(samples);
                    }
                    throw new Error(`Unexpected object store ${name}`);
                },
            }),
        }),
        close: vi.fn(),
    };
}

type PersistedHandle = { id: string; handle: FileSystemDirectoryHandle };
function clonePersistedRow<Row extends { id: string }>(row: Row): Row {
    return structuredClone(row);
}

function getPersistedRowId(key: IDBValidKey): string {
    if (typeof key === 'string') {
        return key;
    }
    throw new Error('Unexpected non-string persistence test key');
}

function createWritableStore<Row extends { id: string }>(initial: Row[] = []) {
    const rows = new Map(initial.map((row) => [row.id, clonePersistedRow(row)]));
    return {
        rows,
        put: (row: Row) => rows.set(row.id, clonePersistedRow(row)),
        delete: (key: IDBValidKey) => rows.delete(getPersistedRowId(key)),
        getAll: () => createReadRequest([...rows.values()].map(clonePersistedRow)),
        getAllKeys: () => createReadRequest([...rows.keys()]),
    };
}

type PersistenceDbInput = {
    roots?: LibraryRoot[];
    handles?: PersistedHandle[];
    samples?: Array<SampleRecord | { id: string }>;
    abortWrites?: boolean;
};

function createPersistenceDb({ roots = [], handles = [], samples = [], abortWrites = false }: PersistenceDbInput = {}) {
    const stores = {
        roots: createWritableStore(roots),
        handles: createWritableStore(handles),
        samples: createWritableStore(samples),
    };
    return {
        transaction: (_storeNames?: string | string[], mode?: IDBTransactionMode) => ({
            objectStore: (name: string) => {
                if (name === 'roots') {
                    return stores.roots;
                }
                if (name === 'handles') {
                    return stores.handles;
                }
                if (name === 'samples') {
                    return stores.samples;
                }
                throw new Error(`Unexpected object store ${name}`);
            },
            set oncomplete(cb: () => void) {
                if (!abortWrites || mode !== 'readwrite') {
                    queueMicrotask(cb);
                }
            },
            set onerror(_cb: () => void) {
                /* unused in the success path */
            },
            set onabort(cb: () => void) {
                if (abortWrites && mode === 'readwrite') {
                    queueMicrotask(cb);
                }
            },
        }),
        close: vi.fn(),
        stores,
    };
}

function createTauriRoot(overrides: Partial<LibraryRoot> = {}): LibraryRoot {
    return {
        id: 'root-1',
        name: 'Samples',
        provider: 'tauri',
        rootRef: '/Users/jose/Samples',
        connectedAt: 1,
        status: 'offline',
        fileCount: 0,
        settings: { recursive: true },
        ...overrides,
    };
}

function createAnalyzedSample(overrides: Partial<SampleRecord> = {}): SampleRecord {
    return {
        id: 'sample-1',
        libraryRootId: 'root-1',
        relativePath: 'Loops/User.wav',
        displayName: 'User',
        ext: 'wav',
        folder: 'Loops',
        sync: { exists: true, status: 'analyzed' },
        format: {},
        analysis: { bpm: toBpm(128), descriptors: { centroid: 1234, rms: 0.25 } },
        tags: [],
        favorite: false,
        ...overrides,
    };
}

function createLibraryState(overrides: Partial<LibraryState> = {}): LibraryState {
    return {
        roots: [],
        samples: [],
        folderTrees: {},
        activeRootId: null,
        currentFolder: null,
        searchQuery: '',
        tagFilter: null,
        favoritesOnly: false,
        sortField: 'name',
        sortDirection: 'asc',
        scanning: false,
        scanProgress: 0,
        ...overrides,
    };
}

describe('Library Persistence', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: mockNotificationEventBus });
        localStorage.clear();
        vi.clearAllMocks();
    });

    describe('persistLibraryRoots', () => {
        it('should do nothing if state is missing', async () => {
            vi.spyOn(helpers, 'openDb').mockRejectedValue(new Error('no db'));
            mockLibraryStore.value = null;
            await persistLibraryRoots();
            expect(helpers.openDb).not.toHaveBeenCalled();
        });

        it('serializes roots without their runtime handle and stores browser handles separately', async () => {
            const handle = { kind: 'directory' } as unknown as FileSystemDirectoryHandle;
            const browserRoot = createTauriRoot({ id: 'b1', provider: 'browser', handle });
            const tauriRoot = createTauriRoot({ id: 't1' });
            const db = createPersistenceDb();
            vi.spyOn(helpers, 'openDb').mockResolvedValue(db as any);
            mockLibraryStore.value = createLibraryState({ roots: [browserRoot, tauriRoot] });

            await persistLibraryRoots();

            expect(db.stores.roots.rows.get('b1')).toEqual(expect.objectContaining({ id: 'b1', handle: undefined }));
            expect(db.stores.handles.rows.get('b1')).toEqual({ id: 'b1', handle });
            expect(db.stores.handles.rows.has('t1')).toBe(false);
        });

        it.each([
            [
                'QuotaExceededError',
                'Storage is full — connected folders could not be saved. Free up disk space and try again.',
            ],
            ['UnknownError', 'Could not save your connected folders; they may not reappear on reload.'],
        ])('notifies on a %s persistence failure', async (name, expectedMessage) => {
            vi.spyOn(helpers, 'openDb').mockResolvedValue({
                transaction: () => {
                    throw new DOMException('fail', name);
                },
                close: vi.fn(),
            } as any);
            mockLibraryStore.value = createLibraryState({ roots: [createTauriRoot()] });

            await persistLibraryRoots();

            expect(mockNotificationEventBus.emit).toHaveBeenCalledWith('ui.notify', {
                message: expectedMessage,
                level: 'error',
            });
        });
    });

    describe('persistSamples', () => {
        it('should do nothing if state is missing', async () => {
            vi.spyOn(helpers, 'openDb').mockRejectedValue(new Error('no db'));
            mockLibraryStore.value = null;
            await persistSamples();
            expect(helpers.openDb).not.toHaveBeenCalled();
        });

        it('reconciles IndexedDB: prunes orphaned samples and removed-root rows', async () => {
            // A minimal in-memory IDB object store keyed by an `id` property.
            type Row = { id: string };
            function makeStore(initial: Row[]) {
                const rows = new Map(initial.map((r) => [r.id, r]));
                return {
                    rows,
                    put: (row: Row) => rows.set(row.id, row),
                    delete: (key: string) => rows.delete(key),
                    getAllKeys: () => {
                        const req: { result: string[]; onsuccess?: () => void; onerror?: () => void } = {
                            result: [...rows.keys()],
                        };
                        queueMicrotask(() => req.onsuccess?.());
                        return req;
                    },
                };
            }

            // Persisted before the reconcile: a live sample (s1), an orphaned
            // sample whose file is gone (s2), a sample belonging to a removed
            // root (s3), the removed root's row, and its handle row.
            const sampleStore = makeStore([{ id: 's1' }, { id: 's2' }, { id: 's3' }]);
            const rootStore = makeStore([{ id: 'r1' }, { id: 'gone' }]);
            const handleStore = makeStore([{ id: 'r1' }, { id: 'gone' }]);
            const stores: Record<string, ReturnType<typeof makeStore>> = {
                samples: sampleStore,
                roots: rootStore,
                handles: handleStore,
            };

            // Fire oncomplete as soon as the reconcile attaches its handler, so
            // the awaited completion Promise resolves regardless of microtask
            // ordering.
            let completeCb: (() => void) | undefined;
            const tx = {
                objectStore: (name: string) => stores[name],
                set oncomplete(cb: () => void) {
                    completeCb = cb;
                    queueMicrotask(() => completeCb?.());
                },
                set onerror(_cb: () => void) {
                    /* unused in the success path */
                },
            };
            const db = {
                transaction: () => tx,
                close: vi.fn(),
            };
            vi.spyOn(helpers, 'openDb').mockResolvedValue(db as any);

            // Current in-memory truth: only r1 with sample s1 survives.
            mockLibraryStore.value = {
                samples: [{ id: 's1', libraryRootId: 'r1' }],
                roots: [{ id: 'r1' }],
                activeRootId: 'r1',
            } as any;

            await persistSamples();

            // Orphaned sample and removed-root sample are pruned; live sample stays.
            expect([...sampleStore.rows.keys()].sort()).toEqual(['s1']);
            // Removed root's root + handle rows are pruned; live root stays.
            expect([...rootStore.rows.keys()].sort()).toEqual(['r1']);
            expect([...handleStore.rows.keys()].sort()).toEqual(['r1']);
        });

        it('should restore favorite and existing tags after the real persistSamples to restoreLibrary path', async () => {
            const root = createTauriRoot({ id: 'root-1', status: 'ready' });
            const sample = {
                id: 'sample-1',
                libraryRootId: 'root-1',
                relativePath: 'Drums/Kick.wav',
                displayName: 'Kick',
                ext: 'wav',
                folder: 'Drums',
                sync: { exists: true, status: 'indexed' },
                format: { durationSec: 0.5, sampleRate: 48000, channels: 2, bitDepth: 24 },
                tags: ['drum', 'one-shot', 'kick'],
                favorite: true,
            } satisfies SampleRecord;
            const db = createPersistenceDb({ roots: [root] });
            vi.spyOn(helpers, 'openDb').mockResolvedValue(db as any);
            vi.mocked(isTauri).mockReturnValue(false);
            mockLibraryStore.value = createLibraryState({
                roots: [root],
                samples: [sample],
                activeRootId: root.id,
            });

            await persistSamples();
            mockLibraryStore.value = createLibraryState();

            await restoreLibrary();

            expect(addSamples).toHaveBeenCalledWith([
                expect.objectContaining({
                    id: 'sample-1',
                    favorite: true,
                    tags: ['drum', 'one-shot', 'kick'],
                }),
            ]);
        });
    });

    describe('requestPermission', () => {
        it('should return false if root or handle missing', async () => {
            mockLibraryStore.value = { roots: [] } as any;
            const res = await requestPermission('r1');
            expect(res).toBe(false);
        });

        it('should return true and update status if granted', async () => {
            const handle = { requestPermission: vi.fn().mockResolvedValue('granted') };
            mockLibraryStore.value = { roots: [{ id: 'r1', handle }] } as any;

            const res = await requestPermission('r1');
            expect(res).toBe(true);
            expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
        });
    });

    describe('restoreLibrary', () => {
        it('should catch errors silently if DB fails to open', async () => {
            vi.spyOn(helpers, 'openDb').mockRejectedValue(new Error('no db'));
            await restoreLibrary();
            expect(helpers.openDb).toHaveBeenCalled();
        });

        it('should probe restored Tauri roots through the native directory reader', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(readTauriDirectory).mockResolvedValue([]);
            const root = createTauriRoot();
            vi.spyOn(helpers, 'openDb').mockResolvedValue(createRestoreDb({ roots: [root] }) as any);

            const restoredRootIds = await restoreLibrary();

            expect(readTauriDirectory).toHaveBeenCalledWith({ path: '/Users/jose/Samples' });
            expect(addLibraryRoot).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'root-1',
                    status: 'ready',
                }),
                { activate: false }
            );
            expect(restoredRootIds).toEqual(['root-1']);
        });

        it('removes all unversioned analysis and rewrites the persisted rows', async () => {
            const userSample = createAnalyzedSample();
            const factorySample = createAnalyzedSample({
                id: 'factory-sample',
                libraryRootId: 'factory',
                analysis: { bpm: toBpm(120) },
            });
            const db = createPersistenceDb({ samples: [userSample, factorySample] });
            vi.spyOn(helpers, 'openDb').mockResolvedValue(db as any);

            await restoreLibrary();

            const restoredSamples = vi.mocked(addSamples).mock.calls[0]?.[0];
            expect(restoredSamples?.map((sample) => sample.sync.status)).toEqual(['indexed', 'indexed']);
            expect(restoredSamples?.[0]).not.toHaveProperty('analysis');
            expect(restoredSamples?.[1]).not.toHaveProperty('analysis');
            expect(db.stores.samples.rows.get('sample-1')).not.toHaveProperty('analysis');
            expect(db.stores.samples.rows.get('factory-sample')).not.toHaveProperty('analysis');
        });

        it('quarantines malformed rows without blocking cleanup of valid rows', async () => {
            const malformedSample = { ...createAnalyzedSample({ id: 'malformed' }), sync: null };
            const db = createPersistenceDb({ samples: [malformedSample, createAnalyzedSample()] });
            vi.spyOn(helpers, 'openDb').mockResolvedValue(db as any);

            await restoreLibrary();

            const restoredSamples = vi.mocked(addSamples).mock.calls[0]?.[0];
            expect(restoredSamples?.map((sample) => sample.id)).toEqual(['sample-1']);
            expect(restoredSamples?.[0]).not.toHaveProperty('analysis');
            expect(db.stores.samples.rows.get('malformed')).toHaveProperty('analysis');
            expect(db.stores.samples.rows.get('sample-1')).not.toHaveProperty('analysis');
        });

        it('does not expose partial restore state when cleanup aborts', async () => {
            const root = createTauriRoot();
            const db = createPersistenceDb({ roots: [root], samples: [createAnalyzedSample()], abortWrites: true });
            vi.spyOn(helpers, 'openDb').mockResolvedValue(db as any);

            const restoredRootIds = await restoreLibrary();

            expect(restoredRootIds).toEqual([]);
            expect(addLibraryRoot).not.toHaveBeenCalled();
            expect(addSamples).not.toHaveBeenCalled();
            expect(db.close).toHaveBeenCalledTimes(1);
        });

        it('should mark restored Tauri roots missing when the native directory reader reports a missing path', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(readTauriDirectory).mockRejectedValue('File not found or not accessible');
            const root = createTauriRoot();
            vi.spyOn(helpers, 'openDb').mockResolvedValue(createRestoreDb({ roots: [root] }) as any);

            await restoreLibrary();

            expect(addLibraryRoot).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'root-1',
                    status: 'path_missing',
                }),
                { activate: false }
            );
        });

        it('should keep restored Tauri roots ready when a child entry fails after the root opens', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(readTauriDirectory).mockRejectedValue('Failed to read entry: Operation not permitted');
            const root = createTauriRoot();
            vi.spyOn(helpers, 'openDb').mockResolvedValue(createRestoreDb({ roots: [root] }) as any);

            await restoreLibrary();

            expect(addLibraryRoot).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'root-1',
                    status: 'ready',
                }),
                { activate: false }
            );
        });

        it('should keep restored Tauri roots ready when child metadata fails after the root opens', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(readTauriDirectory).mockRejectedValue('Failed to read metadata: Operation not permitted');
            const root = createTauriRoot();
            vi.spyOn(helpers, 'openDb').mockResolvedValue(createRestoreDb({ roots: [root] }) as any);

            await restoreLibrary();

            expect(addLibraryRoot).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'root-1',
                    status: 'ready',
                }),
                { activate: false }
            );
        });

        it('should mark restored Tauri roots offline when the root cannot be read', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(readTauriDirectory).mockRejectedValue('Failed to read directory: Operation not permitted');
            const root = createTauriRoot();
            vi.spyOn(helpers, 'openDb').mockResolvedValue(createRestoreDb({ roots: [root] }) as any);

            await restoreLibrary();

            expect(addLibraryRoot).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'root-1',
                    status: 'offline',
                }),
                { activate: false }
            );
        });

        it('restores a browsed root handle and marks it ready when read permission is granted', async () => {
            const handle = {
                queryPermission: vi.fn().mockResolvedValue('granted'),
            } as unknown as FileSystemDirectoryHandle;
            const root = createTauriRoot({ id: 'b1', provider: 'browser', status: 'offline' });
            vi.spyOn(helpers, 'openDb').mockResolvedValue(
                createRestoreDb({ roots: [root], handles: [{ id: 'b1', handle }] }) as any
            );

            await restoreLibrary();

            expect(addLibraryRoot).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'b1', status: 'ready', handle }),
                { activate: false }
            );
        });

        it('flags a browsed root permission_required when read permission has lapsed', async () => {
            const handle = {
                queryPermission: vi.fn().mockResolvedValue('prompt'),
            } as unknown as FileSystemDirectoryHandle;
            const root = createTauriRoot({ id: 'b1', provider: 'browser', status: 'offline' });
            vi.spyOn(helpers, 'openDb').mockResolvedValue(
                createRestoreDb({ roots: [root], handles: [{ id: 'b1', handle }] }) as any
            );

            await restoreLibrary();

            expect(addLibraryRoot).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'b1', status: 'permission_required', handle }),
                { activate: false }
            );
        });

        it('marks a browsed root offline when checking its permission throws', async () => {
            const handle = {
                queryPermission: vi.fn().mockRejectedValue(new Error('detached')),
            } as unknown as FileSystemDirectoryHandle;
            const root = createTauriRoot({ id: 'b1', provider: 'browser', status: 'offline' });
            vi.spyOn(helpers, 'openDb').mockResolvedValue(
                createRestoreDb({ roots: [root], handles: [{ id: 'b1', handle }] }) as any
            );

            await restoreLibrary();

            expect(addLibraryRoot).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', status: 'offline' }), {
                activate: false,
            });
        });

        it('marks a browsed root offline when its persisted handle cannot be found', async () => {
            const root = createTauriRoot({ id: 'b1', provider: 'browser', status: 'offline' });
            vi.spyOn(helpers, 'openDb').mockResolvedValue(createRestoreDb({ roots: [root], handles: [] }) as any);

            await restoreLibrary();

            expect(addLibraryRoot).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', status: 'offline' }), {
                activate: false,
            });
        });

        it('restores the previously focused root id from localStorage', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(readTauriDirectory).mockResolvedValue([]);
            const root = createTauriRoot({ id: 'root-1' });
            localStorage.setItem(ACTIVE_ROOT_KEY, 'root-1');
            vi.spyOn(helpers, 'openDb').mockResolvedValue(createRestoreDb({ roots: [root] }) as any);
            // setActiveRoot only fires for a saved id that matches a root the
            // in-memory store already knows about; addLibraryRoot is mocked, so
            // that root must be seeded here rather than relying on the restore.
            mockLibraryStore.value = createLibraryState({ roots: [root] });

            await restoreLibrary();

            expect(setActiveRoot).toHaveBeenCalledWith('root-1');
        });
    });
});
