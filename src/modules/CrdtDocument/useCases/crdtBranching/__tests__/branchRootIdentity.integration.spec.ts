import { change, clone as cloneDoc, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore, type BranchRecord } from '../../../stores/branchStore';
import { captureProjectRootIdentity } from '../../captureProjectRootIdentity';
import { forkProjectBranch } from '../forkProjectBranch';
import { mergeBranch } from '../mergeBranch';
import { switchBranch } from '../switchBranch';

const mocks = vi.hoisted(() => ({
    compactProject: vi.fn<() => Promise<void>>(),
    loadCrdtProject: vi.fn<() => Promise<boolean>>(),
    projectCrdtToStores: vi.fn(),
    runCrdtPersistenceOperation: vi.fn<() => Promise<void>>(),
}));

vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>()),
    flushAutomergeStorageWrites: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', () => ({
    captureUndoHistory: vi.fn(() => ({ past: [], future: [], undoTree: null })),
    clearUndoHistory: vi.fn(),
    restoreUndoHistory: vi.fn(),
}));
vi.mock('../../compactProject', () => ({ compactProject: mocks.compactProject }));
vi.mock('../../loadCrdtProject', () => ({ loadCrdtProject: mocks.loadCrdtProject }));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mocks.projectCrdtToStores }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: mocks.runCrdtPersistenceOperation,
}));

type Deferred = {
    readonly promise: Promise<void>;
    readonly reject: (error: Error) => void;
};

function createDeferred(): Deferred {
    let rejectDeferred!: (error: Error) => void;
    const promise = new Promise<void>((_resolve, reject) => {
        rejectDeferred = reject;
    });
    return { promise, reject: rejectDeferred };
}

function branchRecord({
    branchId,
    rootDocId,
    sourceBranchId,
}: {
    branchId: string;
    rootDocId: string;
    sourceBranchId: string | null;
}): BranchRecord {
    return {
        branchId,
        name: branchId,
        rootDocId,
        sourceBranchId,
        createdAt: 1,
        createdFromHeads: [],
        note: '',
    };
}

function requireRoot(): Doc<Record<string, unknown>> {
    const root = automergeRepository.getDoc<Record<string, unknown>>('root');
    if (!root) {
        throw new Error('Expected installed root');
    }
    return root;
}

function installBranchFixture(): void {
    automergeRepository.createProject('branch identity');
    automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
        document.branch = 'A';
        document.aOnly = true;
    });
    const rootA = requireRoot();
    const rootB = change(cloneDoc(rootA, { actor: 'aaaaaaaaaaaaaaaa' }), (document) => {
        document.branch = 'B';
        document.bOnly = true;
    });
    const source = change(cloneDoc(rootA, { actor: 'bbbbbbbbbbbbbbbb' }), (document) => {
        document.sourceOnly = true;
    });
    automergeRepository.insertDoc('branch_b', rootB);
    automergeRepository.insertDoc('branch_source', source);
    branchStore.set({
        branches: [
            branchRecord({ branchId: 'main', rootDocId: 'root', sourceBranchId: null }),
            branchRecord({ branchId: 'b', rootDocId: 'branch_b', sourceBranchId: 'main' }),
            branchRecord({ branchId: 'source', rootDocId: 'branch_source', sourceBranchId: 'main' }),
        ],
        activeBranchId: 'main',
    });
}

describe('branch root identity integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        automergeRepository.reset();
        mocks.compactProject.mockResolvedValue(undefined);
        mocks.loadCrdtProject.mockResolvedValue(false);
        mocks.runCrdtPersistenceOperation.mockResolvedValue(undefined);
        installBranchFixture();
    });

    afterEach(() => {
        automergeRepository.reset();
    });

    it('invalidates successful switch, fork, and ABA root installations', async () => {
        const originalAIdentity = captureProjectRootIdentity();

        await switchBranch('b');
        const bIdentity = captureProjectRootIdentity();
        expect(bIdentity).not.toBe(originalAIdentity);
        expect(requireRoot()).toMatchObject({ branch: 'B', bOnly: true });

        await switchBranch('main');
        const returnedAIdentity = captureProjectRootIdentity();
        expect(returnedAIdentity).not.toBe(bIdentity);
        expect(returnedAIdentity).not.toBe(originalAIdentity);
        expect(requireRoot()).toMatchObject({ branch: 'A', aOnly: true });

        const beforeForkIdentity = captureProjectRootIdentity();
        await forkProjectBranch('fork');
        expect(captureProjectRootIdentity()).not.toBe(beforeForkIdentity);
    });

    it('invalidates the post-swap token when a failed switch restores the prior root without loading', async () => {
        const persistence = createDeferred();
        mocks.runCrdtPersistenceOperation.mockReturnValueOnce(persistence.promise);
        const originalAIdentity = captureProjectRootIdentity();

        const transition = switchBranch('b');
        const installedBIdentity = captureProjectRootIdentity();
        expect(installedBIdentity).not.toBe(originalAIdentity);
        expect(requireRoot()).toMatchObject({ branch: 'B', bOnly: true });

        const failure = new Error('deferred persistence failed');
        persistence.reject(failure);
        await expect(transition).rejects.toBe(failure);

        const restoredAIdentity = captureProjectRootIdentity();
        expect(requireRoot()).toMatchObject({ branch: 'A', aOnly: true });
        expect(restoredAIdentity).not.toBe(installedBIdentity);
        expect(restoredAIdentity).not.toBe(originalAIdentity);
        expect(mocks.loadCrdtProject).toHaveBeenCalledOnce();
    });

    it('preserves identity when a same-target merge succeeds', async () => {
        const rootIdentity = captureProjectRootIdentity();

        await mergeBranch('source');

        expect(requireRoot()).toMatchObject({ branch: 'A', aOnly: true, sourceOnly: true });
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
    });

    it('restores a failed same-target merge without changing identity when no load commits', async () => {
        const persistence = createDeferred();
        mocks.runCrdtPersistenceOperation.mockReturnValueOnce(persistence.promise);
        const rootIdentity = captureProjectRootIdentity();

        const merge = mergeBranch('source');
        expect(requireRoot()).toMatchObject({ sourceOnly: true });
        expect(captureProjectRootIdentity()).toBe(rootIdentity);

        const failure = new Error('deferred persistence failed');
        persistence.reject(failure);
        await expect(merge).rejects.toBe(failure);

        expect(requireRoot()).toMatchObject({ branch: 'A', aOnly: true });
        expect(requireRoot()).not.toHaveProperty('sourceOnly');
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(mocks.loadCrdtProject).toHaveBeenCalledOnce();
    });
});
