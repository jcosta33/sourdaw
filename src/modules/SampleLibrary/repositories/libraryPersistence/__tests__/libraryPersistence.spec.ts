import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { isTauri } from '#/utils/tauriBridge';

import { type LibraryRoot, type SampleRecord } from '../../../models/LibraryTypes';
import { addLibraryRoot, addSamples, type LibraryState, libraryStore } from '../../../stores/libraryStore';
import { readTauriDirectory } from '../../readTauriDirectory';
import * as helpers from '../helpers';
import { persistLibraryRoots } from '../persistLibraryRoots';
import { persistSamples } from '../persistSamples';
import { requestPermission } from '../requestPermission';
import { restoreLibrary } from '../restoreLibrary';

vi.mock('../../../stores/libraryStore', () => ({
    libraryStore: { value: { roots: [], samples: [] } },
    addLibraryRoot: vi.fn(),
    addSamples: vi.fn(),
    updateLibraryRootStatus: vi.fn(),
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
type PersistedRow = LibraryRoot | SampleRecord | PersistedHandle;

function clonePersistedRow<Row extends PersistedRow>(row: Row): Row {
    return structuredClone(row);
}

function getPersistedRowId(key: IDBValidKey): string {
    if (typeof key === 'string') {
        return key;
    }
    throw new Error('Unexpected non-string persistence test key');
}

function createWritableStore<Row extends PersistedRow>(initial: Row[] = []) {
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
    samples?: SampleRecord[];
};

function createPersistenceDb({ roots = [], handles = [], samples = [] }: PersistenceDbInput = {}) {
    const stores = {
        roots: createWritableStore(roots),
        handles: createWritableStore(handles),
        samples: createWritableStore(samples),
    };
    return {
        transaction: () => ({
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
                queueMicrotask(cb);
            },
            set onerror(_cb: () => void) {
                /* unused in the success path */
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
            vi.mocked(libraryStore).value = null as any;
            await persistLibraryRoots();
            expect(helpers.openDb).not.toHaveBeenCalled();
        });
    });

    describe('persistSamples', () => {
        it('should do nothing if state is missing', async () => {
            vi.spyOn(helpers, 'openDb').mockRejectedValue(new Error('no db'));
            vi.mocked(libraryStore).value = null as any;
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
            vi.mocked(libraryStore).value = {
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
            vi.mocked(libraryStore).value = createLibraryState({
                roots: [root],
                samples: [sample],
                activeRootId: root.id,
            });

            await persistSamples();
            vi.mocked(libraryStore).value = createLibraryState();

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
            vi.mocked(libraryStore).value = { roots: [] } as any;
            const res = await requestPermission('r1');
            expect(res).toBe(false);
        });

        it('should return true and update status if granted', async () => {
            const handle = { requestPermission: vi.fn().mockResolvedValue('granted') };
            vi.mocked(libraryStore).value = { roots: [{ id: 'r1', handle }] } as any;

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
    });
});
