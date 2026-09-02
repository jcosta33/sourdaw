import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These specs drive the real `branchStore` — and therefore the real
 * `createLocalStorage` adapter — with a `setItem` that throws, which is what a
 * full origin quota and blocked storage access both look like. The point is the
 * caller's own invariant under that throw, not that a `catch` exists.
 */
const { mockAutomergeRepo, mockCompactProject, mockLoadCrdtProject, mockProjectCrdtToStores, mockRunPersistenceOp } =
    vi.hoisted(() => ({
        mockAutomergeRepo: {
            getDoc: vi.fn(() => null),
            hasDoc: vi.fn(() => false),
            removeDoc: vi.fn(),
            replaceDoc: vi.fn(),
            insertDoc: vi.fn(),
        },
        mockCompactProject: vi.fn(() => Promise.resolve()),
        mockLoadCrdtProject: vi.fn(() => Promise.resolve(true)),
        mockProjectCrdtToStores: vi.fn(),
        mockRunPersistenceOp: vi.fn(() => Promise.resolve()),
    }));

vi.mock('@automerge/automerge', () => ({ clone: (doc: unknown) => doc }));
vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({ flushAutomergeStorageWrites: vi.fn() }));
vi.mock('../../../repositories/automergeRepository', () => ({ automergeRepository: mockAutomergeRepo }));
vi.mock('../../compactProject', () => ({ compactProject: mockCompactProject }));
vi.mock('../../loadCrdtProject', () => ({ loadCrdtProject: mockLoadCrdtProject }));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mockProjectCrdtToStores }));
vi.mock('../../runCrdtPersistenceOperation', () => ({ runCrdtPersistenceOperation: mockRunPersistenceOp }));

import { branchStore, MAIN_BRANCH_ID, type BranchStoreState } from '../../../stores/branchStore';
import { deleteBranch } from '../deleteBranch';
import { runBranchLineageTransition } from '../runBranchLineageTransition';

const mainBranch = {
    branchId: MAIN_BRANCH_ID,
    name: 'Main',
    rootDocId: 'root',
    sourceBranchId: null,
    createdAt: 100,
    createdFromHeads: [],
    note: '',
};

const featureBranch = {
    branchId: 'feature',
    name: 'Feature',
    rootDocId: 'branch_feature',
    sourceBranchId: MAIN_BRANCH_ID,
    createdAt: 200,
    createdFromHeads: [],
    note: '',
};

const twoBranchState: BranchStoreState = {
    branches: [mainBranch, featureBranch],
    activeBranchId: MAIN_BRANCH_ID,
};

function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

describe('branch writes when localStorage refuses the write', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        branchStore.set(twoBranchState);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    describe('runBranchLineageTransition rollback', () => {
        it('completes the rollback projection when the recovered branch state cannot be persisted', async () => {
            const transitionFailure = new Error('lineage transition failed');
            blockEveryDurableWrite();

            await expect(
                runBranchLineageTransition({
                    affectedDocIds: ['doc-a'],
                    apply: () => {
                        throw transitionFailure;
                    },
                    from: MAIN_BRANCH_ID,
                    previousState: twoBranchState,
                    to: featureBranch.branchId,
                })
            ).rejects.toThrow(transitionFailure);

            // The rollback restored the documents; the stores must be brought
            // back in step with them or the rollback is itself half-applied.
            expect(mockProjectCrdtToStores).toHaveBeenCalledTimes(1);
            expect(branchStore.value).toEqual(twoBranchState);
        });
    });

    describe('deleteBranch', () => {
        it('leaves the branch and its document intact when the branch list cannot be persisted', () => {
            blockEveryDurableWrite();

            expect(() => {
                deleteBranch(featureBranch.branchId);
            }).toThrow();

            // Nothing destroyed: the document is still in the repository, no
            // compaction was fired against a reduced document set, and the
            // branch is still listed.
            expect(mockAutomergeRepo.removeDoc).not.toHaveBeenCalled();
            expect(mockCompactProject).not.toHaveBeenCalled();
            expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
                MAIN_BRANCH_ID,
                featureBranch.branchId,
            ]);
        });

        it('still removes the document and compacts when the branch list persists', () => {
            deleteBranch(featureBranch.branchId);

            expect(mockAutomergeRepo.removeDoc).toHaveBeenCalledWith(featureBranch.rootDocId);
            expect(mockCompactProject).toHaveBeenCalledTimes(1);
            expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([MAIN_BRANCH_ID]);
        });
    });
});
