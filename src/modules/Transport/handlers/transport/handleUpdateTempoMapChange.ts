import { createHandler } from '#/utils/createHandler';

import {
    describeForwardTempoMapEdit,
    executeTempoMapEdit,
    isTempoMapEditSessionEntry,
    prepareForwardTempoMapEdit,
} from './tempoMapEditPlan';

export const handleUpdateTempoMapChange = createHandler<'updateTempoMapChange'>({
    batchExecution: 'singleton',
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    validateSessionEntry: isTempoMapEditSessionEntry,
    validate: (action) => prepareForwardTempoMapEdit(action) !== null,
    isNoop: (action) => {
        const plan = prepareForwardTempoMapEdit(action);
        return plan !== null && plan.before?.tempo === plan.after?.tempo;
    },
    execute: (action) => executeTempoMapEdit(prepareForwardTempoMapEdit(action)),
    describe: (action) => describeForwardTempoMapEdit(action, `Update tempo change ${action.payload.changeId}`),
    undoable: true,
});
