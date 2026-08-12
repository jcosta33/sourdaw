import { type AppAction, type ExecuteOptions } from '#/utils/handlerContract';

import { AppActionNotDispatchedError } from '../errors/AppActionExecutionError';

import { createExecutionCommandEnvelope } from './createExecutionCommandEnvelope';
import { getCommandHandler } from './getCommandHandler';
import { materializeCommandApplicationIds } from './materializeCommandApplicationIds';

type MigrateLegacyAppActionToVersionedCommandEnvelopeInput = {
    action: AppAction;
    expectedEffect?: string;
    normalizedProjectRevision?: string;
    options?: ExecuteOptions;
};

export function migrateLegacyAppActionToVersionedCommandEnvelope(
    input: MigrateLegacyAppActionToVersionedCommandEnvelopeInput
) {
    const materialized = materializeCommandApplicationIds(input.action);
    const handler = getCommandHandler(materialized.action);
    if (!handler) {
        throw new AppActionNotDispatchedError(input.action.type);
    }
    return createExecutionCommandEnvelope({
        action: materialized.action,
        applicationAssignedIds: materialized.applicationAssignedIds,
        expectedEffect: input.expectedEffect ?? handler.describe(materialized.action).label,
        normalizedProjectRevision: input.normalizedProjectRevision,
        options: input.options,
    }).envelope;
}
