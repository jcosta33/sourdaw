import { type AppAction, type ExecuteOptions } from '#/utils/handlerContract';

import { AppActionConflictError } from '../errors/AppActionExecutionError';

import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { createVersionedCommandReceipt } from './createVersionedCommandReceipt';
import { isExecutableAppActionType } from './executableAppActionRegistry';
import { executeAppAction } from './executeAppAction';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';
import { hasCurrentCommandDeviceVersions } from './hasCurrentCommandDeviceVersions';
import { parseVersionedCommandEnvelope } from './parseVersionedCommandEnvelope';

export async function executeVersionedCommandEnvelope(
    serialized: string,
    options?: ExecuteOptions
): Promise<ReturnType<typeof createVersionedCommandReceipt>> {
    const parsed = parseVersionedCommandEnvelope(serialized);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    if (
        (commandProjectRevisionPort.isConfigured() &&
            commandProjectRevisionPort.capture() !== parsed.envelope.normalizedProjectRevision) ||
        !hasCurrentCommandDeviceVersions(parsed.envelope)
    ) {
        throw new AppActionConflictError(parsed.envelope.operation);
    }
    if (parsed.envelope.dependencyIds.length > 0) {
        throw new Error('A dependent command must execute inside its declared batch');
    }
    if (isExecutableAppActionType(parsed.envelope.operation)) {
        getExecutableCommandRegistration(parsed.envelope.operation);
    }
    // parseVersionedCommandEnvelope has already allowlisted the discriminant and
    // strictly validated the serialized arguments at this trust boundary.
    const action = {
        type: parsed.envelope.operation,
        payload: parsed.envelope.arguments,
    } as AppAction;
    await executeAppAction(action, {
        ...options,
        commandEnvelope: parsed.envelope,
        groupId: parsed.envelope.groupId,
    });
    return createVersionedCommandReceipt({ envelope: parsed.envelope });
}
