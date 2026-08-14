import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';
import { getCommandBatchContentHash } from './getCommandBatchContentHash';
import { parseStoredVerifiedBatchReceipt } from './parseStoredVerifiedBatchReceipt';
import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';

export async function getVersionedCommandBatchIdempotentReplay(input: {
    authority: CommandBatchAuthority;
    serialized: string;
}) {
    if (!commandBatchIdempotencyPort.isConfigured()) {
        return null;
    }
    const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
    if (parsed.status === 'invalid') {
        return null;
    }
    try {
        const contentHash = await getCommandBatchContentHash(parsed.envelope);
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
