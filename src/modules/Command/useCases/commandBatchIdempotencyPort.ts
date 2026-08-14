import {
    type CommandBatchIdempotencyClaim,
    type CommandBatchIdempotencyLookup,
    type CommandBatchIdempotencyRepository,
} from '../models/CommandBatchIdempotency';

let repository: CommandBatchIdempotencyRepository | null = null;

export const commandBatchIdempotencyPort = {
    lookup(input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
    }): Promise<CommandBatchIdempotencyLookup> | null {
        return repository?.lookup(input) ?? null;
    },
    claim(input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
        reclaimPending?: boolean;
    }): Promise<CommandBatchIdempotencyClaim> | null {
        return repository?.claim(input) ?? null;
    },
    complete(input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
        serializedReceipt: string;
    }): Promise<void> | null {
        return repository?.complete(input) ?? null;
    },
    tryAcquireRecoveryLease(input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
    }): Promise<boolean> | null {
        return repository?.tryAcquireRecoveryLease?.(input) ?? null;
    },
    release(input: { projectId: string; idempotencyKey: string; contentHash: string }): Promise<void> | null {
        return repository?.release?.(input) ?? null;
    },
    isConfigured(): boolean {
        return repository !== null;
    },
    setRepository(nextRepository: CommandBatchIdempotencyRepository | null): void {
        repository = nextRepository;
    },
};
