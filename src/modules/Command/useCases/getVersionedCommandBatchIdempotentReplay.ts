import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';
import { getCommandBatchContentHash } from './getCommandBatchContentHash';
import { getProjectCommandBatchIdempotencyCheckpoint } from './getProjectCommandBatchIdempotencyCheckpoint';
import { parseStoredVerifiedBatchReceipt } from './parseStoredVerifiedBatchReceipt';
import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';

export async function getVersionedCommandBatchIdempotentReplay(input: {
    authority: CommandBatchAuthority;
    serialized: string;
}) {
    const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
    if (parsed.status === 'invalid') {
        return null;
    }
    try {
        const contentHash = await getCommandBatchContentHash(parsed.envelope);
        const projectCheckpoint = getProjectCommandBatchIdempotencyCheckpoint({
            projectId: parsed.envelope.projectId,
            idempotencyKey: parsed.envelope.idempotencyKey,
            contentHash,
        });
        if (projectCheckpoint.status === 'pending' || projectCheckpoint.status === 'complete') {
            return parseStoredVerifiedBatchReceipt({
                baseRevision: parsed.envelope.baseRevision,
                batchId: parsed.envelope.batchId,
                commands: parsed.envelope.commands,
                runId: parsed.envelope.runId,
                serializedReceipt: projectCheckpoint.serializedReceipt,
            });
        }
        if (projectCheckpoint.status !== 'missing') {
            return null;
        }
        if (!commandBatchIdempotencyPort.isConfigured()) {
            return null;
        }
        const lookup = await commandBatchIdempotencyPort.lookup({
            projectId: parsed.envelope.projectId,
            idempotencyKey: parsed.envelope.idempotencyKey,
            contentHash,
        });
        if (lookup?.status !== 'complete') {
            return null;
        }
        return parseStoredVerifiedBatchReceipt({
            baseRevision: parsed.envelope.baseRevision,
            batchId: parsed.envelope.batchId,
            commands: parsed.envelope.commands,
            runId: parsed.envelope.runId,
            serializedReceipt: lookup.serializedReceipt,
        });
    } catch {
        return null;
    }
}
