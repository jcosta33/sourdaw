import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore, MAIN_BRANCH_ID, type BranchRecord } from '../../../stores/branchStore';
import { compactProject } from '../../../useCases/compactProject';
import { createDeleteDrumPreviewBranchesHandler } from '../handleDeleteDrumPreviewBranches';

vi.mock('../../../useCases/compactProject', () => ({
    compactProject: vi.fn(),
}));
vi.mock('../../../useCases/loadCrdtProject', () => ({
    loadCrdtProject: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../../useCases/projection/projectProjection', () => ({
    projectCrdtToStores: vi.fn(),
}));

type DeleteDrumPreviewBranchesAction = Extract<AppAction, { type: 'deleteDrumPreviewBranches' }>;

const ownerId = 'preview-owner';

function createCandidateRecords(sourceBranchId = MAIN_BRANCH_ID): BranchRecord[] {
    return ['candidate-1', 'candidate-2', 'candidate-3'].map((branchId, index) => {
        const rootDocId = `branch_${branchId}`;
        automergeRepository.createChildDoc(rootDocId);
        automergeRepository.changeDoc<Record<string, unknown>>(rootDocId, (draft) => {
            draft.candidate = index;
        });
        return {
            branchId,
            name: `Candidate ${String(index + 1)}`,
            rootDocId,
            sourceBranchId,
            createdAt: 100 + index,
            createdFromHeads: ['source-head'],
            note: `agent-preview:${ownerId}`,
        };
    });
}

function createDeleteAction(
    records: readonly BranchRecord[],
    expectedSourceBranchId = MAIN_BRANCH_ID
): DeleteDrumPreviewBranchesAction {
    return {
        type: 'deleteDrumPreviewBranches',
        payload: {
            ownerId,
            expectedSourceBranchId,
            branches: records.map(({ branchId, name, rootDocId }) => ({
                branchId,
                branchName: name,
                rootDocId,
                expectedHeads: [...(automergeRepository.getHeads(rootDocId) ?? [])].map(String).toSorted(),
            })),
        },
    };
}

function installBranchState(records: readonly BranchRecord[], activeBranchId = MAIN_BRANCH_ID): void {
    branchStore.set({
        activeBranchId,
        branches: [
            {
                branchId: MAIN_BRANCH_ID,
                name: 'Main',
                rootDocId: 'root',
                sourceBranchId: null,
                createdAt: 0,
                createdFromHeads: [],
                note: '',
            },
            ...records,
        ],
    });
}

describe('createDeleteDrumPreviewBranchesHandler', () => {
    beforeEach(() => {
        vi.mocked(compactProject).mockReset().mockResolvedValue(undefined);
        automergeRepository.reset();
        automergeRepository.createProject('project');
    });

    it('advertises guarded compensation and validates the exact live preview branches', () => {
        const records = createCandidateRecords();
        const action = createDeleteAction(records);
        installBranchState(records);
        const handler = createDeleteDrumPreviewBranchesHandler({ canMutateBranchMetadata: () => true });

        expect(handler.canReapplyAfterDivergence?.(action)).toBe(true);
        expect(handler.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
    });

    it('rejects deletion after a collaborator changes a target branch', () => {
        const records = createCandidateRecords();
        const action = createDeleteAction(records);
        installBranchState(records);
        automergeRepository.changeDoc<Record<string, unknown>>(records[0]!.rootDocId, (draft) => {
            draft.collaboratorEdit = true;
        });
        const handler = createDeleteDrumPreviewBranchesHandler({ canMutateBranchMetadata: () => true });

        expect(handler.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
    });

    it('rejects a target whose ownership metadata no longer matches', () => {
        const records = createCandidateRecords();
        const action = createDeleteAction(records);
        records[0] = { ...records[0]!, note: 'agent-preview:collaborator' };
        installBranchState(records);
        const handler = createDeleteDrumPreviewBranchesHandler({ canMutateBranchMetadata: () => true });

        expect(handler.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
    });

    it('removes only the guarded targets and preserves the active source and collaborator branches', async () => {
        const sourceRootDocId = 'branch_source';
        automergeRepository.createChildDoc(sourceRootDocId);
        const sourceRecord: BranchRecord = {
            branchId: 'source',
            name: 'Source branch',
            rootDocId: sourceRootDocId,
            sourceBranchId: MAIN_BRANCH_ID,
            createdAt: 50,
            createdFromHeads: ['main-head'],
            note: '',
        };
        const records = createCandidateRecords(sourceRecord.branchId);
        const action = createDeleteAction(records, sourceRecord.branchId);
        const collaboratorRootDocId = 'branch_collaborator';
        automergeRepository.createChildDoc(collaboratorRootDocId);
        automergeRepository.changeDoc<Record<string, unknown>>(collaboratorRootDocId, (draft) => {
            draft.collaboratorEdit = true;
        });
        const collaboratorRecord: BranchRecord = {
            branchId: 'collaborator',
            name: 'Collaborator branch',
            rootDocId: collaboratorRootDocId,
            sourceBranchId: MAIN_BRANCH_ID,
            createdAt: 200,
            createdFromHeads: ['source-head'],
            note: 'collaborator-work',
        };
        installBranchState([sourceRecord, ...records, collaboratorRecord], sourceRecord.branchId);
        const handler = createDeleteDrumPreviewBranchesHandler({ canMutateBranchMetadata: () => true });

        await expect(handler.execute(action)).resolves.toEqual({ status: 'written' });
        expect(branchStore.value?.activeBranchId).toBe(sourceRecord.branchId);
        expect(branchStore.value?.branches).toContainEqual(sourceRecord);
        expect(branchStore.value?.branches).toContainEqual(collaboratorRecord);
        expect(automergeRepository.hasDoc(collaboratorRootDocId)).toBe(true);
        expect(records.every(({ rootDocId }) => !automergeRepository.hasDoc(rootDocId))).toBe(true);
    });

    it('rejects deletion when another branch record shares a guarded document', () => {
        const records = createCandidateRecords();
        const action = createDeleteAction(records);
        const foreignRecord: BranchRecord = {
            branchId: 'foreign-owner',
            name: 'Foreign owner',
            rootDocId: records[0]!.rootDocId,
            sourceBranchId: MAIN_BRANCH_ID,
            createdAt: 200,
            createdFromHeads: ['source-head'],
            note: 'collaborator-work',
        };
        installBranchState([...records, foreignRecord]);
        const handler = createDeleteDrumPreviewBranchesHandler({ canMutateBranchMetadata: () => true });

        expect(handler.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
    });

    it('does not advertise divergence safety without a complete revision guard', () => {
        const records = createCandidateRecords();
        const guardedAction = createDeleteAction(records);
        const action: DeleteDrumPreviewBranchesAction = {
            ...guardedAction,
            payload: {
                ...guardedAction.payload,
                branches: guardedAction.payload.branches.map((branch, index) =>
                    index === 0 ? { ...branch, expectedHeads: [] } : branch
                ),
            },
        };
        const handler = createDeleteDrumPreviewBranchesHandler({ canMutateBranchMetadata: () => true });

        expect(handler.canReapplyAfterDivergence?.(action)).toBe(false);
    });

    it('rejects validation and divergence safety without host authority', () => {
        const records = createCandidateRecords();
        const action = createDeleteAction(records);
        installBranchState(records);
        const handler = createDeleteDrumPreviewBranchesHandler({ canMutateBranchMetadata: () => false });

        expect(handler.canReapplyAfterDivergence?.(action)).toBe(false);
        expect(handler.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
    });
});
