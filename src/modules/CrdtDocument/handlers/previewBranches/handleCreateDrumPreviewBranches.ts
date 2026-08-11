import { createHandler } from '#/utils/createHandler';

import { createDrumPreviewBranches } from '../../useCases/crdtBranching/createDrumPreviewBranches';
import { prepareDrumPreviewBranches } from '../../useCases/crdtBranching/prepareDrumPreviewBranches';
import { rollbackCreatedDrumPreviewBranches } from '../../useCases/crdtBranching/rollbackCreatedDrumPreviewBranches';

function createDeleteAction(prepared: NonNullable<ReturnType<typeof prepareDrumPreviewBranches>>) {
    return {
        type: 'deleteDrumPreviewBranches' as const,
        payload: {
            ownerId: prepared.action.payload.ownerId,
            expectedSourceBranchId: prepared.action.payload.expectedSourceBranchId,
            branches: prepared.branches.map(({ expectedHeads, record }) => ({
                branchId: record.branchId,
                branchName: record.name,
                rootDocId: record.rootDocId,
                expectedHeads,
            })),
        },
    };
}

export const handleCreateDrumPreviewBranches = createHandler<'createDrumPreviewBranches'>({
    execute: async (action) => {
        const prepared = prepareDrumPreviewBranches(action);
        if (!prepared) {
            return { status: 'conflict' };
        }
        await createDrumPreviewBranches(prepared);
        return { status: 'written' };
    },
    describe: (action) => {
        const prepared = prepareDrumPreviewBranches(action);
        if (!prepared) {
            throw new Error('Drum preview branch plan conflicts with current project state');
        }
        const candidates = prepared.branches.map(({ record }) => `"${record.name}" (${record.branchId})`).join(', ');
        return {
            label: `Create three drum preview branches for "${action.payload.sectionName}" (${action.payload.sectionId}): ${candidates}; preserve Kick and vary only Snare and Hi-Hat`,
            inverseAction: createDeleteAction(prepared),
            redoAction: action,
        };
    },
    prepareAbort: (action) => {
        const prepared = prepareDrumPreviewBranches(action);
        if (!prepared) {
            return () => undefined;
        }
        const deleteAction = createDeleteAction(prepared);
        return () => rollbackCreatedDrumPreviewBranches(deleteAction);
    },
    batchExecution: 'singleton',
    requiresAbortCompensation: false,
    undoable: true,
});
