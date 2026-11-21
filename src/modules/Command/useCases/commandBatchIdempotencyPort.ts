import {
    type CommandBatchIdempotencyClaim,
    type CommandBatchIdempotencyLookup,
    type CommandBatchIdempotencyRepository,
} from '../models/CommandBatchIdempotency';

let registeredRepository: CommandBatchIdempotencyRepository | null = null;

function readRepository(caller: string): CommandBatchIdempotencyRepository {
    if (registeredRepository === null) {
        throw new Error(
            `${caller}: the command batch idempotency repository is not registered; call configureCommandBatchIdempotency() from #/app/bootstrap`
        );
    }
    return registeredRepository;
}

/**
 * Filled from inside Command by `configureCommandBatchIdempotency`, which the
 * composition root (`#/app/bootstrap`) calls once at boot. A read before that
 * throws, so a batch can never run without the durable ledger.
 */
export const commandBatchIdempotencyPort = {
    lookup(input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
    }): Promise<CommandBatchIdempotencyLookup> {
        return readRepository('commandBatchIdempotencyPort.lookup').lookup(input);
    },
    claim(input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
        reclaimPending?: boolean;
    }): Promise<CommandBatchIdempotencyClaim> {
        return readRepository('commandBatchIdempotencyPort.claim').claim(input);
    },
    complete(input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
        serializedReceipt: string;
    }): Promise<void> {
        return readRepository('commandBatchIdempotencyPort.complete').complete(input);
    },
    tryAcquireRecoveryLease(input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
    }): Promise<boolean> | null {
        return (
            readRepository('commandBatchIdempotencyPort.tryAcquireRecoveryLease').tryAcquireRecoveryLease?.(input) ??
            null
        );
    },
    release(input: { projectId: string; idempotencyKey: string; contentHash: string }): Promise<void> | null {
        return readRepository('commandBatchIdempotencyPort.release').release?.(input) ?? null;
    },
    setRepository(nextRepository: CommandBatchIdempotencyRepository): void {
        registeredRepository = nextRepository;
    },
};
