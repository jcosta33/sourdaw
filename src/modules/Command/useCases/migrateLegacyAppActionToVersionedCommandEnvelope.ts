import { type AppAction, type ExecuteOptions } from '#/utils/handlerContract';

import { AppActionNotDispatchedError } from '../errors/AppActionExecutionError';
import { getHandler } from '../stores/handlerRegistry';

import { createExecutionCommandEnvelope } from './createExecutionCommandEnvelope';

type MigrateLegacyAppActionToVersionedCommandEnvelopeInput = {
    action: AppAction;
    expectedEffect?: string;
    normalizedProjectRevision?: string;
    options?: ExecuteOptions;
};

export function migrateLegacyAppActionToVersionedCommandEnvelope(
    input: MigrateLegacyAppActionToVersionedCommandEnvelopeInput
) {
    const handler = getHandler(input.action);
    if (!handler) {
        throw new AppActionNotDispatchedError(input.action.type);
    }
    return createExecutionCommandEnvelope({
        action: input.action,
        expectedEffect: input.expectedEffect ?? handler.describe(input.action).label,
        normalizedProjectRevision: input.normalizedProjectRevision,
        options: input.options,
    }).envelope;
}
