import { change, init, save } from '@automerge/automerge';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { holdBranchStateLock, settleBranchStateLocks } from '../../repositories/__tests__/branchStateHarness';
import { loadCrdtProject } from '../loadCrdtProject';

type TestPersistenceSnapshot = {
    authority: { epoch: string; revision: number; rootLineage: string };
    bundle: Map<string, Uint8Array> | null;
};

const mocks = vi.hoisted(() => ({
    loadAll: vi.fn<(input: { bundle: Map<string, Uint8Array>; shouldCommit?: () => boolean }) => Promise<boolean>>(),
    loadPersistenceSnapshotFromIdb: vi.fn<() => Promise<TestPersistenceSnapshot | null>>(),
    adoptSnapshot: vi.fn<(snapshot: TestPersistenceSnapshot) => void>(),
    getDoc: vi.fn<(docId: string) => unknown>(),
    replaceDoc: vi.fn<(docId: string, doc: unknown) => void>(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        loadAll: mocks.loadAll,
        getDoc: mocks.getDoc,
        replaceDoc: mocks.replaceDoc,
    },
}));
vi.mock('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb', () => ({
    loadPersistenceSnapshotFromIdb: mocks.loadPersistenceSnapshotFromIdb,
}));
vi.mock('#/modules/Command/useCases', () => ({ resetActionReplayAuthority: vi.fn(), executeUserAppAction: vi.fn() }));
vi.mock('../runCrdtPersistenceLoad', () => ({
    runCrdtPersistenceLoad: vi.fn(
        async (
            operation: (input: {
                shouldCommit: () => boolean;
            }) => Promise<{ loaded: boolean; snapshot: TestPersistenceSnapshot | null }>
        ) => {
            const result = await operation({ shouldCommit: () => true });
            if (result.snapshot) {
                mocks.adoptSnapshot(result.snapshot);
            }
            return result.loaded;
        }
    ),
}));

describe('loadCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loadAll.mockResolvedValue(true);
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: { epoch: 'test-project', revision: 1, rootLineage: 'main' },
            bundle: null,
        });
    });

    it('should load from IDB and update the repository', async () => {
        const mockBundle = new Map<string, Uint8Array>();
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: { epoch: 'test-project', revision: 1, rootLineage: 'main' },
            bundle: mockBundle,
        });

        const result = await loadCrdtProject();

        expect(result).toBe(true);
        const loadInput = mocks.loadAll.mock.calls[0]?.[0];
        expect(loadInput?.bundle).toBe(mockBundle);
        expect(loadInput?.shouldCommit).toEqual(expect.any(Function));
        expect(mocks.adoptSnapshot).toHaveBeenCalledWith({
            authority: { epoch: 'test-project', revision: 1, rootLineage: 'main' },
            bundle: mockBundle,
        });
    });

    it('returns absence from one empty persistence read without committing', async () => {
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue(null);

        await expect(loadCrdtProject()).resolves.toBe(false);

        expect(mocks.loadAll).not.toHaveBeenCalled();
        expect(mocks.adoptSnapshot).not.toHaveBeenCalled();
    });

    it('does not adopt empty persistence authority after commit is superseded', async () => {
        const shouldCommit = vi.fn(() => false);

        await expect(loadCrdtProject({ shouldCommit })).resolves.toBe(false);

        expect(mocks.loadAll).not.toHaveBeenCalled();
        expect(mocks.adoptSnapshot).not.toHaveBeenCalled();
    });

    it('keeps the loaded root authoritative over an older active-branch snapshot', async () => {
        const loadedRoot = save(
            change(init<Record<string, unknown>>(), (document) => {
                document.project = 'loaded';
            })
        );
        const olderBranchSnapshot = save(
            change(init<Record<string, unknown>>(), (document) => {
                document.project = 'older';
            })
        );
        const bundle = new Map([
            ['root', loadedRoot],
            ['branch_feat', olderBranchSnapshot],
        ]);
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: { epoch: 'test-project', revision: 1, rootLineage: 'main' },
            bundle,
        });

        await expect(loadCrdtProject()).resolves.toBe(true);

        const loadInput = mocks.loadAll.mock.calls[0]?.[0];
        expect(loadInput?.bundle).toBe(bundle);
        expect(loadInput?.shouldCommit).toEqual(expect.any(Function));
    });

    it('does not restore branch state when repository commit is canceled', async () => {
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: { epoch: 'test-project', revision: 1, rootLineage: 'main' },
            bundle: new Map<string, Uint8Array>(),
        });
        mocks.loadAll.mockResolvedValue(false);

        const result = await loadCrdtProject();

        expect(result).toBe(false);
        const loadInput = mocks.loadAll.mock.calls[0]?.[0];
        expect(loadInput?.bundle).toBeInstanceOf(Map);
        expect(loadInput?.shouldCommit?.()).toBe(true);
        expect(mocks.adoptSnapshot).not.toHaveBeenCalled();
    });

    it('does not restore branch state when authority is revoked after repository commit', async () => {
        let shouldCommit = true;
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: { epoch: 'test-project', revision: 1, rootLineage: 'main' },
            bundle: new Map<string, Uint8Array>(),
        });
        mocks.loadAll.mockImplementationOnce(() => {
            shouldCommit = false;
            return Promise.resolve(true);
        });

        const result = await loadCrdtProject({ shouldCommit: () => shouldCommit });

        expect(result).toBe(false);
    });

    /**
     * The branch list an abandoned collaboration session projected is still the
     * durable one until the boot recovery puts the pre-session backup back. A
     * load that resolves the active branch before that has happened opens the
     * session's branch and makes it the live root.
     */
    describe('while the boot branch recovery is still pending', () => {
        const mainBranch = {
            branchId: 'main',
            name: 'Main',
            rootDocId: DOC_PREFIX_ROOT,
            sourceBranchId: null,
            createdAt: 100,
            createdFromHeads: [],
            note: '',
        };
        const projectedBranch = { ...mainBranch, branchId: 'projected', name: 'Projected' };
        const restoredBranch = { ...mainBranch, branchId: 'restored', name: 'Restored' };
        const sessionProjectedList = {
            branches: [mainBranch, { ...projectedBranch, rootDocId: 'branch_projected', sourceBranchId: 'main' }],
            activeBranchId: 'projected',
        };
        const preSessionList = {
            branches: [mainBranch, { ...restoredBranch, rootDocId: 'branch_restored', sourceBranchId: 'main' }],
            activeBranchId: 'restored',
        };
        const PROJECTED_DOC = { tag: 'projected' };
        const RESTORED_DOC = { tag: 'restored' };

        afterEach(() => {
            vi.unstubAllGlobals();
            window.localStorage.clear();
        });

        it('resolves the active branch from the recovered list, not the one the session projected', async () => {
            window.localStorage.clear();
            window.localStorage.setItem(
                'sourdaw-branch-state',
                JSON.stringify({
                    version: 1,
                    revision: 5,
                    current: sessionProjectedList,
                    // The instance that began this session is gone, so its
                    // lifetime lock is free and the boot may restore the backup.
                    session: { owner: 'gone-owner', backup: preSessionList, baseRevision: 5, sequence: 1 },
                })
            );
            const manager = createControlledLockManager();
            vi.stubGlobal('navigator', { ...navigator, locks: manager.locks });
            mocks.getDoc.mockImplementation((docId) => {
                if (docId === 'branch_projected') {
                    return PROJECTED_DOC;
                }
                return docId === 'branch_restored' ? RESTORED_DOC : undefined;
            });

            vi.resetModules();
            const [{ branchStateAuthority }, { branchStore }, { loadCrdtProject: loadFreshGraph }] = await Promise.all([
                import('../../repositories/branchStateAuthority'),
                import('../../stores/branchStore'),
                import('../loadCrdtProject'),
            ]);

            // The recovery has to take the transaction lock to write the backup
            // back, and this holds it, so the boot stays pending for as long as
            // the test wants it to.
            const releaseTransactionLock = holdBranchStateLock(manager, 'sourdaw:branch-state');
            expect(branchStateAuthority.hydrateFromDurableState()).toBe('hydrated');
            expect(branchStore.value).toEqual(sessionProjectedList);
            const boot = branchStateAuthority.settleBoot();
            await settleBranchStateLocks();

            mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
                authority: { epoch: 'test-project', revision: 1, rootLineage: 'main' },
                bundle: new Map<string, Uint8Array>(),
            });
            // Released a macrotask out, so a load that does not wait for the
            // recovery reaches the active-branch slot while the store still
            // holds the projected list.
            mocks.loadAll.mockImplementation(() => {
                setTimeout(releaseTransactionLock, 0);
                return Promise.resolve(true);
            });

            await expect(loadFreshGraph()).resolves.toBe(true);

            await expect(boot).resolves.toBe('restored');
            expect(branchStore.value).toEqual(preSessionList);
            expect(mocks.replaceDoc).toHaveBeenCalledTimes(1);
            expect(mocks.replaceDoc).toHaveBeenCalledWith(DOC_PREFIX_ROOT, RESTORED_DOC);
        });
    });
});
