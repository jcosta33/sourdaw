import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { agentProjectRepairStateStore } from '../../stores/agentProjectRepairStateStore';
import { resetCrdtProjectAuthority } from '../resetCrdtProjectAuthority';

const mocks = vi.hoisted(() => {
    const rootDocs: Record<string, unknown>[] = [];
    const docs = new Map<string, Record<string, unknown>>();
    function createProjectImplementation(_: string): string {
        const root: Record<string, unknown> = {};
        rootDocs.push(root);
        docs.clear();
        docs.set('root', root);
        return 'root';
    }

    return {
        branchStoreSet: vi.fn(),
        rootDocs,
        docs,
        createProjectImplementation,
        createProject: vi.fn(createProjectImplementation),
        resetActionReplayAuthority: vi.fn(),
        runCrdtPersistenceOperation: vi.fn(),
    };
});

vi.mock('../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: mocks.runCrdtPersistenceOperation,
}));

vi.mock('../../stores/branchStore', () => ({
    branchStore: { set: mocks.branchStoreSet },
    MAIN_BRANCH_ID: 'main',
}));
vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: { createProject: mocks.createProject },
}));
// The capability map itself is not exported through `Command/stores`, so the
// legal observation at this boundary is the call that clears it. What clearing
// actually does to undo is pinned on the other side, in
// `Command/useCases/__tests__/resetActionReplayAuthority.spec.ts`.
vi.mock('#/modules/Command/useCases', () => ({
    resetActionReplayAuthority: mocks.resetActionReplayAuthority,
}));

describe('resetCrdtProjectAuthority', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.branchStoreSet.mockReset();
        mocks.createProject.mockReset();
        mocks.createProject.mockImplementation(mocks.createProjectImplementation);
        mocks.resetActionReplayAuthority.mockReset();
        mocks.runCrdtPersistenceOperation.mockReset();
        mocks.rootDocs.length = 0;
        mocks.docs.clear();
        const initialRoot = {};
        mocks.rootDocs.push(initialRoot);
        mocks.docs.set('root', initialRoot);
        agentProjectRepairStateStore.set(null);
        configureAutomergeStoragePort({
            getDoc: (docId) => mocks.docs.get(docId),
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => mocks.docs.has(docId),
            mutateDoc: ({ docId, changeFn }) => {
                const doc = mocks.docs.get(docId);
                if (!doc) {
                    throw new Error(`Missing test document: ${docId}`);
                }
                changeFn(doc);
            },
        });
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 42)
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('replaces the document authority before publishing the new branch state', () => {
        resetCrdtProjectAuthority('Imported');

        expect(mocks.branchStoreSet).toHaveBeenCalledWith({
            branches: [expect.objectContaining({ branchId: 'main', rootDocId: 'root', sourceBranchId: null })],
            activeBranchId: 'main',
        });
        expect(mocks.createProject.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.branchStoreSet.mock.invocationCallOrder[0]!
        );
        expect(mocks.createProject).toHaveBeenCalledWith('Imported');
    });

    it('clears repair state owned by the replaced project authority', () => {
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-revision',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            status: 'repair-required',
            repairCandidates: [],
        });

        resetCrdtProjectAuthority('Imported');

        expect(agentProjectRepairStateStore.value).toBeNull();
    });

    it('drains old deferred writes before replacing authority and sends new branch state to the new root', () => {
        const oldRootStorage = createAutomergeStorage<{ value: string }>('root', 'oldProject');
        const newBranchStorage = createAutomergeStorage<{ value: string }>('root', 'newBranch');
        const oldRoot = mocks.rootDocs[0];

        oldRootStorage.set({ value: 'old' });
        mocks.branchStoreSet.mockImplementationOnce(() => {
            newBranchStorage.set({ value: 'new' });
        });

        resetCrdtProjectAuthority('New Project');
        const newRoot = mocks.rootDocs[1];

        flushAutomergeStorageWrites();

        expect(oldRoot).toEqual({ oldProject: { value: 'old' } });
        expect(newRoot).toEqual({ newBranch: { value: 'new' } });
    });

    // Audit CC-2 stale-bleed. The projected caches used to survive the
    // authority switch, and the first hydrate against the fresh (slot-less)
    // document wrote them straight back — a blank project silently inheriting
    // the previous project's tracks, then persisting and syncing them.
    it('drops the outgoing project caches so a fresh document cannot inherit them', () => {
        const trackProjection = createAutomergeStorage<{ tracks: string[] }>('root', 'tracks', {
            hydrateMissing: () => ({ tracks: [] }),
        });
        trackProjection.set({ tracks: ['previous-project-track'] });

        resetCrdtProjectAuthority('New Project');
        const newRoot = mocks.rootDocs[1];

        expect(trackProjection.get()).toEqual({ tracks: [] });

        // A projection pass against the new empty document must stay a pure
        // read: no slot appears, and the stale value is gone for good.
        trackProjection.hydrate?.();
        flushAutomergeStorageWrites();

        expect(newRoot && Object.hasOwn(newRoot, 'tracks')).toBe(false);
        expect(trackProjection.get()).toEqual({ tracks: [] });
    });

    /**
     * An aborting caller has to know which side of the point of no return it
     * landed on. Before `createProject` the previous project is untouched and
     * restoring it is right; after it, the root is replaced and every root-doc
     * projection has been reset to its default (the test above measures exactly
     * that: `{ tracks: [] }`), so there is nothing left to restore and acting as
     * if there were hides the loss.
     */
    describe('point-of-no-return reporting', () => {
        it('says nothing was replaced, and leaves undo alone, when it throws before the swap', () => {
            const onAuthorityReplaced = vi.fn();
            mocks.runCrdtPersistenceOperation.mockImplementationOnce(() => {
                throw new Error('persistence reset failed');
            });

            expect(() => resetCrdtProjectAuthority('New Project', onAuthorityReplaced)).toThrow(
                'persistence reset failed'
            );

            expect(mocks.createProject).not.toHaveBeenCalled();
            expect(onAuthorityReplaced).not.toHaveBeenCalled();
            // The previous document is still the authority, so the inverse
            // actions describing it must still be replayable.
            expect(mocks.resetActionReplayAuthority).not.toHaveBeenCalled();
        });

        it('reports a replacement even when the swap throws partway, because it is not atomic', () => {
            const onAuthorityReplaced = vi.fn();
            // `createProject` clears the document map before installing the new
            // root, so a throw inside it still leaves the repository emptied.
            // Reporting "nothing happened" would send the caller down the
            // recoverable path, restoring flags and restarting autosave into a
            // compact against an empty document set.
            mocks.createProject.mockImplementation(() => {
                throw new Error('createProject failed');
            });

            expect(() => resetCrdtProjectAuthority('New Project', onAuthorityReplaced)).toThrow('createProject failed');

            expect(onAuthorityReplaced).toHaveBeenCalledTimes(1);
            // The swap did not complete, so nothing after it ran.
            expect(mocks.resetActionReplayAuthority).not.toHaveBeenCalled();
        });

        it('does not let a full quota escape the authority switch it cannot undo', () => {
            const onAuthorityReplaced = vi.fn();
            // `branchStore` is localStorage-backed, that adapter propagates a
            // failed write by design, and this is the last statement of the
            // switch. It used to throw straight through a caller that had
            // already replaced the project.
            mocks.branchStoreSet.mockImplementationOnce(() => {
                throw new DOMException('exceeded the quota', 'QuotaExceededError');
            });

            expect(() => resetCrdtProjectAuthority('New Project', onAuthorityReplaced)).not.toThrow();

            expect(onAuthorityReplaced).toHaveBeenCalledTimes(1);
            // The document these entries describe is gone, so they must go too.
            expect(mocks.resetActionReplayAuthority).toHaveBeenCalledTimes(1);
        });

        it('reports the replacement before anything that runs after it', () => {
            const onAuthorityReplaced = vi.fn();
            // Any post-swap step can still fail; the caller must already know
            // the switch happened by the time one does.
            mocks.resetActionReplayAuthority.mockImplementationOnce(() => {
                throw new Error('replay authority reset failed');
            });

            expect(() => resetCrdtProjectAuthority('New Project', onAuthorityReplaced)).toThrow(
                'replay authority reset failed'
            );

            expect(onAuthorityReplaced).toHaveBeenCalledTimes(1);
            expect(mocks.createProject.mock.invocationCallOrder[0]!).toBeLessThan(
                onAuthorityReplaced.mock.invocationCallOrder[0]!
            );
            expect(onAuthorityReplaced.mock.invocationCallOrder[0]!).toBeLessThan(
                mocks.resetActionReplayAuthority.mock.invocationCallOrder[0]!
            );
        });
    });
});
