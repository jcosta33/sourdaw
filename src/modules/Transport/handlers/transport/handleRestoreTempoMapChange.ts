import { createHandler } from '#/utils/createHandler';

import { executeTempoMapEdit, isTempoMapReplayPayload, prepareReplayTempoMapEdit } from './tempoMapEditPlan';

export const handleRestoreTempoMapChange = createHandler<'restoreTempoMapChange'>({
    batchExecution: 'singleton',
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    validateSessionActionArguments: isTempoMapReplayPayload,
    validate: (action) => isTempoMapReplayPayload(action.payload) && prepareReplayTempoMapEdit(action) !== null,
    execute: (action) => executeTempoMapEdit(prepareReplayTempoMapEdit(action), action.payload.sourceTransition),
    describe: () => ({ label: 'Restore tempo map change' }),
    undoable: false,
});
