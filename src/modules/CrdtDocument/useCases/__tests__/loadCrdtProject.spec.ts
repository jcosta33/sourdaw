import { change, init, save } from '@automerge/automerge';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadCrdtProject } from '../loadCrdtProject';

type TestPersistenceSnapshot = {
    authority: { epoch: string; revision: number; rootLineage: string };
    bundle: Map<string, Uint8Array> | null;
};

const mocks = vi.hoisted(() => ({
    loadAll: vi.fn<(input: { bundle: Map<string, Uint8Array>; shouldCommit?: () => boolean }) => Promise<boolean>>(),
    loadPersistenceSnapshotFromIdb: vi.fn<() => Promise<TestPersistenceSnapshot | null>>(),
    adoptSnapshot: vi.fn<(snapshot: TestPersistenceSnapshot) => void>(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        loadAll: mocks.loadAll,
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
});
