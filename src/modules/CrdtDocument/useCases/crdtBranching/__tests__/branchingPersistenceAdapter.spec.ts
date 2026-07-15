import { clone as cloneDoc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort, createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore, type BranchRecord, MAIN_BRANCH_ID } from '../../../stores/branchStore';
import { forkProjectBranch } from '../forkProjectBranch';
import { switchBranch } from '../switchBranch';

vi.mock('../../compactProject', () => ({
    compactProject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../crdtPersistenceQueue', () => ({
    runCrdtPersistenceOperation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../projection/projectProjection', () => ({
    projectCrdtToStores: vi.fn(),
}));

function createBranchRecord(branchId: string, rootDocId: string): BranchRecord {
    return {
        branchId,
        name: branchId,
        rootDocId,
        sourceBranchId: branchId === MAIN_BRANCH_ID ? null : MAIN_BRANCH_ID,
        createdAt: 0,
        createdFromHeads: [],
        note: '',
    };
}

function configureRealStorageAdapter(): void {
    configureAutomergeStoragePort({
        getSemanticMessage: () => undefined,
        hasDoc: (docId) => automergeRepository.hasDoc(docId),
        getDoc: (docId) => automergeRepository.getDoc<Record<string, unknown>>(docId),
        mutateDoc: ({ docId, changeFn, message }) => {
            automergeRepository.changeDoc(docId, changeFn, message);
        },
    });
}

describe('CRDT branch persistence adapter interleavings', () => {
    let nextAnimationFrameId = 0;
    let scheduledFrames: Map<number, FrameRequestCallback>;

    beforeEach(() => {
        nextAnimationFrameId = 0;
        scheduledFrames = new Map();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            const id = ++nextAnimationFrameId;
            scheduledFrames.set(id, callback);
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            scheduledFrames.delete(id);
        });

        automergeRepository.reset();
        configureRealStorageAdapter();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('captures a queued pre-fork edit in the source snapshot without contaminating it later', async () => {
        automergeRepository.createProject('project');
        branchStore.set({
            branches: [createBranchRecord(MAIN_BRANCH_ID, 'root')],
            activeBranchId: MAIN_BRANCH_ID,
        });

        const storage = createAutomergeStorage<Record<string, unknown>>('root', 'state');
        storage.set({ queuedBeforeFork: true });
        expect(automergeRepository.getDoc('root')).not.toMatchObject({
            state: { queuedBeforeFork: true },
        });

        const forkId = await forkProjectBranch('feature');
        const branch = branchStore.value?.branches.find(({ branchId }) => branchId === forkId);
        if (!branch) {
            throw new Error('Expected the fork branch record');
        }
        expect(automergeRepository.getDoc(branch.rootDocId)).not.toBe(automergeRepository.getDoc('root'));
        const sourceSnapshot = cloneDoc(automergeRepository.getDoc(branch.rootDocId)!);

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.state = { queuedBeforeFork: true, afterFork: true };
        });

        expect(sourceSnapshot).toMatchObject({ state: { queuedBeforeFork: true } });
        expect(automergeRepository.getDoc(branch.rootDocId)).toMatchObject({
            state: { queuedBeforeFork: true },
        });
        expect(automergeRepository.getDoc(branch.rootDocId)).not.toMatchObject({
            state: { afterFork: true },
        });
    });

    it('writes a queued pre-switch edit to the outgoing snapshot before loading the target', () => {
        automergeRepository.createProject('project');
        automergeRepository.createChildDoc('branch_target');
        automergeRepository.insertDoc('branch_feat', cloneDoc(automergeRepository.getDoc('root')!));
        automergeRepository.changeDoc('branch_target', (doc: Record<string, unknown>) => {
            doc.state = { target: true };
        });

        branchStore.set({
            branches: [
                createBranchRecord(MAIN_BRANCH_ID, 'root'),
                createBranchRecord('feat', 'branch_feat'),
                createBranchRecord('target', 'branch_target'),
            ],
            activeBranchId: 'feat',
        });

        const storage = createAutomergeStorage<Record<string, unknown>>('root', 'state');
        storage.set({ queuedBeforeSwitch: true });

        switchBranch('target');

        expect(automergeRepository.getDoc('branch_feat')).toMatchObject({
            state: { queuedBeforeSwitch: true },
        });
        expect(automergeRepository.getDoc('root')).toMatchObject({ state: { target: true } });
        expect(automergeRepository.getDoc('root')).not.toMatchObject({
            state: { queuedBeforeSwitch: true },
        });
    });

    it('keeps main and its fork isolated across switches and a binary reload', async () => {
        automergeRepository.createProject('project');
        branchStore.set({
            branches: [createBranchRecord(MAIN_BRANCH_ID, 'root')],
            activeBranchId: MAIN_BRANCH_ID,
        });
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.sharedBeforeFork = true;
        });

        const featureId = await forkProjectBranch('feature');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.featureOnly = true;
        });

        switchBranch(MAIN_BRANCH_ID);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            sharedBeforeFork: true,
        });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('featureOnly');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.mainOnly = true;
        });

        switchBranch(featureId);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            sharedBeforeFork: true,
            featureOnly: true,
        });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('mainOnly');

        const persistedBundle = automergeRepository.saveAll();
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle: persistedBundle, shouldCommit: () => true })).resolves.toBe(
            true
        );

        switchBranch(MAIN_BRANCH_ID);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            sharedBeforeFork: true,
            mainOnly: true,
        });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('featureOnly');

        switchBranch(featureId);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            sharedBeforeFork: true,
            featureOnly: true,
        });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('mainOnly');
    });
});
