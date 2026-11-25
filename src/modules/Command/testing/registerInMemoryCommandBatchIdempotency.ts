import { type CommandBatchIdempotencyRepository } from '../models/CommandBatchIdempotency';
import { commandBatchIdempotencyStore } from '../stores/commandBatchIdempotencyStore';
import { commandBatchExecutionAuthorityPort } from '../useCases/commandBatchExecutionAuthorityPort';
import { commandBatchIdempotencyPort } from '../useCases/commandBatchIdempotencyPort';

export const COMMAND_BATCH_IDEMPOTENCY_REGISTRAR = 'call configureCommandBatchIdempotency() from #/app/bootstrap';

type StoredRecord = { contentHash: string; serializedReceipt?: string };

function createInMemoryRepository(): CommandBatchIdempotencyRepository {
    const records = new Map<string, StoredRecord>();
    const keyOf = (input: { projectId: string; idempotencyKey: string }) =>
        `${input.projectId}:${input.idempotencyKey}`;
    const read = (input: { projectId: string; idempotencyKey: string; contentHash: string }) => {
        const existing = records.get(keyOf(input));
        if (!existing) {
            return { status: 'missing' as const };
        }
        if (existing.contentHash !== input.contentHash) {
            return { status: 'conflict' as const };
        }
        if (existing.serializedReceipt === undefined) {
            return { status: 'pending' as const };
        }
        return { status: 'complete' as const, serializedReceipt: existing.serializedReceipt };
    };
    return {
        lookup: (input) => Promise.resolve(read(input)),
        claim: (input) => {
            const prior = read(input);
            if (prior.status === 'missing') {
                records.set(keyOf(input), { contentHash: input.contentHash });
                return Promise.resolve({ status: 'claimed' });
            }
            return Promise.resolve(prior);
        },
        complete: (input) => {
            records.set(keyOf(input), { contentHash: input.contentHash, serializedReceipt: input.serializedReceipt });
            return Promise.resolve();
        },
    };
}

/**
 * Empties the project ledger of a spec that wires no document. A spec that
 * configures a document per case must not call it: the write would land in
 * whichever document is configured next.
 */
export function resetUnwiredProjectCommandBatchLedger(): void {
    commandBatchIdempotencyStore.set(null);
}

/** Fills the idempotency ports with a fresh ledger and lets the host execute. */
export function registerInMemoryCommandBatchIdempotency(): void {
    commandBatchIdempotencyPort.setRepository(createInMemoryRepository());
    commandBatchExecutionAuthorityPort.setProvider(() => true);
}
