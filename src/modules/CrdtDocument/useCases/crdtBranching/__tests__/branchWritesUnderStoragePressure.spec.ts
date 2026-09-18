import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These specs drive the real branch-state authority with a `setItem` that
 * throws, which is what a full origin quota and blocked storage access both
 * look like. The point is the caller's own invariant under a refused durable
 * write, not that a `catch` exists.
 */
const { mockAutomergeRepo, mockCompactProject, mockLoadCrdtProject, mockProjectCrdtToStores, mockRunPersistenceOp } =
    vi.hoisted(() => ({
        mockAutomergeRepo: {
            getDoc: vi.fn(() => null),
            getRootId: vi.fn(() => 'root'),
            getRootIdentityEpoch: vi.fn(() => 1),
            hasDoc: vi.fn(() => false),
            removeDoc: vi.fn(),
            replaceDoc: vi.fn(),
            replaceRootContentPreservingIdentity: vi.fn(),
            insertDoc: vi.fn(),
        },
        mockCompactProject: vi.fn(() => Promise.resolve()),
        mockLoadCrdtProject: vi.fn(() => Promise.resolve(true)),
        mockProjectCrdtToStores: vi.fn(),
        mockRunPersistenceOp: vi.fn(() => Promise.resolve()),
    }));

vi.mock('@automerge/automerge', () => ({ clone: (doc: unknown) => doc }));
// Only the flush is replaced. `captureAutomergeStorageTransactionScope` is the
// real one: with no app action running it returns the pass-through scope, which
// is exactly the production behaviour for a branch write outside an action.
vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>()),
    flushAutomergeStorageWrites: vi.fn(),
}));
vi.mock('../../../repositories/automergeRepository', () => ({ automergeRepository: mockAutomergeRepo }));
vi.mock('../../compactProject', () => ({ compactProject: mockCompactProject }));
vi.mock('../../loadCrdtProject', () => ({ loadCrdtProject: mockLoadCrdtProject }));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mockProjectCrdtToStores }));
vi.mock('../../runCrdtPersistenceOperation', () => ({ runCrdtPersistenceOperation: mockRunPersistenceOp }));

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import { MAIN_BRANCH_ID, type BranchStoreState } from '../../../stores/branchStore';

const BRANCH_STATE_STORAGE_KEY = 'sourdaw-branch-state';

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

const hotfixBranch = {
    branchId: 'hotfix',
    name: 'Hotfix',
    rootDocId: 'branch_hotfix',
    sourceBranchId: MAIN_BRANCH_ID,
    createdAt: 300,
    createdFromHeads: [],
    note: '',
};

const twoBranchState: BranchStoreState = {
    branches: [mainBranch, featureBranch],
    activeBranchId: MAIN_BRANCH_ID,
};

const SEEDED_REVISION = 1;

function writeStoredEnvelope(revision: number, current: BranchStoreState): void {
    window.localStorage.setItem(
        BRANCH_STATE_STORAGE_KEY,
        JSON.stringify({ version: 1, revision, current, session: null })
    );
}

function readStoredEnvelope(): { revision: number; current: BranchStoreState } {
    const raw = window.localStorage.getItem(BRANCH_STATE_STORAGE_KEY);
    if (raw === null) {
        throw new Error('Expected a durable branch-state envelope');
    }
    return JSON.parse(raw) as { revision: number; current: BranchStoreState };
}

function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

/**
 * One case, one module graph.
 *
 * The authority keeps the live revision, the memoized boot promise and the
 * session holds in module state, so two cases sharing a graph share them: the
 * first `commit` of the file settles the boot, and a later case inherits both
 * that decision and the revision it left behind. Reloading the graph — and
 * seeding the envelope the graph boots from — is what makes each case stand
 * alone.
 */
async function loadBranchTransitionGraph(): Promise<{
    authority: (typeof import('../../../repositories/branchStateAuthority'))['branchStateAuthority'];
    branchStore: (typeof import('../../../stores/branchStore'))['branchStore'];
    deleteBranch: (typeof import('../deleteBranch'))['deleteBranch'];
    runBranchLineageTransition: (typeof import('../runBranchLineageTransition'))['runBranchLineageTransition'];
}> {
    vi.resetModules();
    const [authorityModule, storeModule, deleteModule, lineageModule] = await Promise.all([
        import('../../../repositories/branchStateAuthority'),
        import('../../../stores/branchStore'),
        import('../deleteBranch'),
        import('../runBranchLineageTransition'),
    ]);
    return {
        authority: authorityModule.branchStateAuthority,
        branchStore: storeModule.branchStore,
        deleteBranch: deleteModule.deleteBranch,
        runBranchLineageTransition: lineageModule.runBranchLineageTransition,
    };
}

describe('branch writes when localStorage refuses the write', () => {
    let graph: Awaited<ReturnType<typeof loadBranchTransitionGraph>>;

    beforeEach(async () => {
        vi.clearAllMocks();
        window.localStorage.clear();
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        // Durable first, memory second: the authority hydrates from the envelope,
        // so seeding the store without one would have the boot read empty
        // storage and replace the seeded list with a default Main.
        writeStoredEnvelope(SEEDED_REVISION, twoBranchState);
        graph = await loadBranchTransitionGraph();
        expect(graph.authority.hydrateFromDurableState()).toBe('hydrated');
        expect(graph.authority.captureRevision()).toBe(SEEDED_REVISION);
        expect(graph.branchStore.value).toEqual(twoBranchState);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        window.localStorage.clear();
    });

    describe('runBranchLineageTransition rollback', () => {
        it('completes the rollback projection when the recovered branch state cannot be persisted', async () => {
            const transitionFailure = new Error('lineage transition failed');
            // The transition's own commit lands; storage only refuses once the
            // rollback tries to swap that revision back.
            mockCompactProject.mockImplementationOnce(() => {
                blockEveryDurableWrite();
                return Promise.reject(transitionFailure);
            });

            await expect(
                graph.runBranchLineageTransition({
                    affectedDocIds: ['doc-a'],
                    apply: () => ({
                        nextState: { ...twoBranchState, activeBranchId: featureBranch.branchId },
                        result: 'switched',
                    }),
                    from: MAIN_BRANCH_ID,
                    previousState: twoBranchState,
                    to: featureBranch.branchId,
                })
            ).rejects.toThrow(transitionFailure);

            // The rollback restored the documents; the stores must be brought
            // back in step with them or the rollback is itself half-applied —
            // one projection for the applied transition, one for the rollback.
            expect(mockProjectCrdtToStores).toHaveBeenCalledTimes(2);
            expect(graph.branchStore.value).toEqual(twoBranchState);
        });

        it('keeps the list a conflicting instance left durable instead of the caller pre-transition list', async () => {
            // Another instance committed between this transition's revision
            // capture and its commit: the envelope moved on, the captured
            // revision did not.
            const foreignList: BranchStoreState = {
                branches: [mainBranch, featureBranch, hotfixBranch],
                activeBranchId: MAIN_BRANCH_ID,
            };
            writeStoredEnvelope(SEEDED_REVISION + 1, foreignList);

            await expect(
                graph.runBranchLineageTransition({
                    affectedDocIds: ['doc-a'],
                    apply: () => ({
                        nextState: { ...twoBranchState, activeBranchId: featureBranch.branchId },
                        result: 'switched',
                    }),
                    from: MAIN_BRANCH_ID,
                    previousState: twoBranchState,
                    to: featureBranch.branchId,
                })
            ).rejects.toThrow(/Branch state could not be persisted \(conflict\)/);

            // The refused commit hydrated the store from the fresh envelope, and
            // the rollback has no revision of its own to undo, so the newer list
            // is what both memory and storage keep. Putting `previousState` back
            // here would erase the branch that other instance had just created.
            expect(graph.branchStore.value).toEqual(foreignList);
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: SEEDED_REVISION + 1,
                current: foreignList,
                session: null,
            });
        });
    });

    describe('deleteBranch', () => {
        it('leaves the branch and its document intact when the branch list cannot be persisted', async () => {
            blockEveryDurableWrite();

            await expect(graph.deleteBranch(featureBranch.branchId)).rejects.toThrow(
                /Branch deletion could not be persisted/
            );

            // Nothing destroyed: the document is still in the repository, no
            // compaction was fired against a reduced document set, and the
            // branch is still listed.
            expect(mockAutomergeRepo.removeDoc).not.toHaveBeenCalled();
            expect(mockCompactProject).not.toHaveBeenCalled();
            expect(graph.branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
                MAIN_BRANCH_ID,
                featureBranch.branchId,
            ]);
        });

        it('still removes the document and compacts when the branch list persists', async () => {
            await graph.deleteBranch(featureBranch.branchId);

            expect(mockAutomergeRepo.removeDoc).toHaveBeenCalledWith(featureBranch.rootDocId);
            expect(mockCompactProject).toHaveBeenCalledTimes(1);
            expect(graph.branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([MAIN_BRANCH_ID]);
        });
    });
});
