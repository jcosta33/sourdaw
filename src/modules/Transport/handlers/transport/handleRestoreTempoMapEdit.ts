import { createHandler } from '#/utils/createHandler';

import { markTempoProjectWrite } from '../../useCases/markTempoProjectWrite';

import { isTempoMapRestore, tempoMapSourcesApply, writeTempoMapEdit } from './tempoMapAudioSourceEdit';

export const handleRestoreTempoMapEdit = createHandler<'restoreTempoMapEdit'>({
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    canReportConflict: true,
    batchExecution: 'singleton',
    undoable: false,
    validateMaterializedCommandArguments: isTempoMapRestore,
    validateSessionActionArguments: isTempoMapRestore,
    canReapplyAfterDivergence: (action) => isTempoMapRestore(action.payload),
    validate: (action) => isTempoMapRestore(action.payload) && tempoMapSourcesApply(action.payload),
    execute: (action, context) => {
        if (!isTempoMapRestore(action.payload)) {
            return { status: 'conflict' };
        }
        const result = writeTempoMapEdit(action.payload, context);
        if (result.status === 'conflict') {
            return result;
        }
        return { ...result, afterCommit: markTempoProjectWrite, afterAmbiguousCommit: markTempoProjectWrite };
    },
    describe: () => ({ label: 'Restore tempo-map edit', inverseAction: null }),
});
