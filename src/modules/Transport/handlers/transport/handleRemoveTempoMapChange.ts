import { createHandler } from '#/utils/createHandler';

import {
    describeForwardTempoMapEdit,
    executeTempoMapEdit,
    isTempoMapEditSessionEntry,
    prepareForwardTempoMapEdit,
} from './tempoMapEditPlan';

export const handleRemoveTempoMapChange = createHandler<'removeTempoMapChange'>({
    batchExecution: 'singleton',
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    validateSessionEntry: isTempoMapEditSessionEntry,
    validate: (action) => prepareForwardTempoMapEdit(action) !== null,
    execute: (action) => executeTempoMapEdit(prepareForwardTempoMapEdit(action)),
    describe: (action) => describeForwardTempoMapEdit(action, `Remove tempo change ${action.payload.changeId}`),
    undoable: true,
});
