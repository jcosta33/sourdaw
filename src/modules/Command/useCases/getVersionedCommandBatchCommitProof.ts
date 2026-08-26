import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { getCommandBatchContentHash } from './getCommandBatchContentHash';
import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';

export async function getVersionedCommandBatchCommitProof(input: {
    authority: CommandBatchAuthority;
    serialized: string;
}) {
    const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
    if (parsed.status === 'invalid') {
        throw new Error(`Command batch commit proof is invalid: ${parsed.reason}`);
    }
    return {
        projectId: parsed.envelope.projectId,
        idempotencyKey: parsed.envelope.idempotencyKey,
        contentHash: await getCommandBatchContentHash(parsed.envelope),
        runId: parsed.envelope.runId,
        batchId: parsed.envelope.batchId,
    };
}
