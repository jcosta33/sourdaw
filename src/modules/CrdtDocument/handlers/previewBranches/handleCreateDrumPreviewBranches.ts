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

type CreateDrumPreviewBranchesHandlerInput = {
    canMutateBranchMetadata: () => boolean;
};

export function createDrumPreviewBranchesHandler({ canMutateBranchMetadata }: CreateDrumPreviewBranchesHandlerInput) {
    return createHandler<'createDrumPreviewBranches'>({
        previewExecution: 'unsupported-async',
        execute: async (action) => {
            if (!canMutateBranchMetadata()) {
                return { status: 'conflict' };
            }
            const prepared = prepareDrumPreviewBranches(action);
            if (!prepared) {
                return { status: 'conflict' };
            }
            const finalize = await createDrumPreviewBranches(prepared);
            return { status: 'written', afterCommit: finalize, afterAmbiguousCommit: finalize };
        },
        describe: (action) => {
            if (!canMutateBranchMetadata()) {
                throw new Error('Only the collaboration host may change preview-branch metadata');
            }
            const prepared = prepareDrumPreviewBranches(action);
            if (!prepared) {
                throw new Error('Drum preview branch plan conflicts with current project state');
            }
            const candidates = prepared.branches
                .map(({ record }) => `"${record.name}" (${record.branchId})`)
                .join(', ');
            return {
                label: `Create three drum preview branches for "${action.payload.sectionName}" (${action.payload.sectionId}): ${candidates}; preserve Kick and vary only Snare and Hi-Hat`,
                inverseAction: createDeleteAction(prepared),
                redoAction: action,
            };
        },
        prepareAbort: (action) => {
            if (!canMutateBranchMetadata()) {
                return () => undefined;
            }
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
}
