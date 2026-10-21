import { createHandler } from '#/utils/createHandler';

import {
    describeForwardTempoMapEdit,
    executeTempoMapEdit,
    isTempoMapEditSessionEntry,
    materializeAddTempoMapChange,
    prepareForwardTempoMapEdit,
} from './tempoMapEditPlan';

export const handleAddTempoMapChange = createHandler<'addTempoMapChange'>({
    batchExecution: 'singleton',
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    materializeCommandArguments: materializeAddTempoMapChange,
    validateSessionEntry: isTempoMapEditSessionEntry,
    validate: (action) => prepareForwardTempoMapEdit(action) !== null,
    isNoop: (action) => {
        const plan = prepareForwardTempoMapEdit(action);
        return plan !== null && plan.before?.tempo === plan.after?.tempo && plan.before?.curve === plan.after?.curve;
    },
    execute: (action) => executeTempoMapEdit(prepareForwardTempoMapEdit(action)),
    describe: (action) =>
        describeForwardTempoMapEdit(action, `Add tempo change at beat ${String(action.payload.beat)}`),
    undoable: true,
});
