import { type AppAction, type ExecuteOptions } from '#/utils/handlerContract';

import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { type CommandBatchValidationPreparation } from './commandBatchValidation';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { isExecutableAppActionType } from './executableAppActionRegistry';
import { executeAppActionBatch } from './executeAppActionBatch';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';
import { hasCurrentCommandDeviceVersions } from './hasCurrentCommandDeviceVersions';
import { parseVersionedCommandEnvelope } from './parseVersionedCommandEnvelope';

type ExecuteVersionedCommandBatchInput = {
    commands: readonly string[];
    normalizedProjectRevision?: string;
    options?: ExecuteOptions & {
        prepareValidation?: () => CommandBatchValidationPreparation;
        requireCompensation?: boolean;
    };
};

export async function executeVersionedCommandBatch(input: ExecuteVersionedCommandBatchInput) {
    const envelopes: VersionedCommandEnvelope[] = [];
    for (const serialized of input.commands) {
        const parsed = parseVersionedCommandEnvelope(serialized);
        if (parsed.status === 'invalid') {
            return { status: 'rejected' as const, reason: parsed.reason, actions: [] as [] };
        }
        envelopes.push(parsed.envelope);
    }
    if (envelopes.length === 0) {
        return executeAppActionBatch([], input.options);
    }
    const commandIds = envelopes.map((envelope) => envelope.commandId);
    if (new Set(commandIds).size !== commandIds.length) {
        return { status: 'rejected' as const, reason: 'Command IDs must be unique within a batch', actions: [] as [] };
    }
    const batchRevision = input.normalizedProjectRevision ?? envelopes[0]?.normalizedProjectRevision;
    const currentRevision = commandProjectRevisionPort.capture();
    if (
        envelopes.some((envelope) => envelope.normalizedProjectRevision !== batchRevision) ||
        (commandProjectRevisionPort.isConfigured() && batchRevision !== currentRevision) ||
        envelopes.some((envelope) => !hasCurrentCommandDeviceVersions(envelope))
    ) {
        return {
            status: 'conflicted' as const,
            reason: 'Command batch base revision does not match current project state',
            actions: [] as [],
        };
    }
    for (const [index, envelope] of envelopes.entries()) {
        const earlierCommandIds = new Set(commandIds.slice(0, index));
        if (envelope.dependencyIds.some((dependencyId) => !earlierCommandIds.has(dependencyId))) {
            return {
                status: 'rejected' as const,
                reason: `Command dependencies are missing or out of order for ${envelope.commandId}`,
                actions: [] as [],
            };
        }
    }
    const groupId = envelopes[0]?.groupId;
    if (envelopes.some((envelope) => envelope.groupId !== groupId)) {
        return {
            status: 'rejected' as const,
            reason: 'Command batch contains conflicting group IDs',
            actions: [] as [],
        };
    }
    for (const envelope of envelopes) {
        if (isExecutableAppActionType(envelope.operation)) {
            getExecutableCommandRegistration(envelope.operation);
        }
    }
    // Each envelope was strictly parsed above, preserving the discriminant and
    // argument pairing at this serialized-command boundary.
    const actions = envelopes.map(
        (envelope) => ({ type: envelope.operation, payload: envelope.arguments }) as AppAction
    );
    return executeAppActionBatch(actions, {
        ...input.options,
        commandEnvelopes: envelopes,
        groupId,
    });
}
