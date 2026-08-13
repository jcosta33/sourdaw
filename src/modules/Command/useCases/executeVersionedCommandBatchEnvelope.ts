import { type ExecuteOptions } from '#/utils/handlerContract';

import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { executeVersionedCommandBatch } from './executeVersionedCommandBatch';
import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';
import { prepareCommandBatchPreflight } from './prepareCommandBatchPreflight';
import { resolveVersionedCommandBatchBindings } from './resolveVersionedCommandBatchBindings';
import { serializeVersionedCommandEnvelope } from './serializeVersionedCommandEnvelope';

type ExecuteVersionedCommandBatchEnvelopeInput = {
    authority: CommandBatchAuthority;
    confirmed?: boolean;
    serialized: string;
    options?: ExecuteOptions;
};

export async function executeVersionedCommandBatchEnvelope(input: ExecuteVersionedCommandBatchEnvelopeInput) {
    const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
    if (parsed.status === 'invalid') {
        return { status: 'rejected' as const, reason: parsed.reason, actions: [] as [] };
    }
    if (parsed.envelope.mode !== 'commit') {
        return {
            status: 'rejected' as const,
            reason: 'Preview batches require the isolated preview executor',
            actions: [] as [],
        };
    }
    if (!input.confirmed && !parsed.envelope.grants.autoCommit) {
        return {
            status: 'rejected' as const,
            reason: 'Commit batch requires confirmation or the auto-commit grant',
            actions: [] as [],
        };
    }
    const resolvedCommands = resolveVersionedCommandBatchBindings(parsed.envelope);
    const resolvedEnvelope = { ...parsed.envelope, commands: resolvedCommands };
    const preflight = prepareCommandBatchPreflight(resolvedEnvelope);
    if (preflight.status === 'rejected') {
        return { status: 'rejected' as const, reason: preflight.reason, actions: [] as [] };
    }
    return executeVersionedCommandBatch({
        commands: resolvedCommands.map((command) =>
            serializeVersionedCommandEnvelope({ ...command, groupId: parsed.envelope.batchId })
        ),
        normalizedProjectRevision: parsed.envelope.baseRevision,
        options: {
            ...input.options,
            groupId: parsed.envelope.batchId,
            preCommitValidation: preflight.validatePostconditions,
            requireCompensation: true,
        },
    });
}
