import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { libraryStore } from '../../../stores/libraryStore';
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

const mockNotificationEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
};

describe('Library Persistence', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: mockNotificationEventBus });
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
    });
});
