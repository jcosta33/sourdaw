export type CommandBatchIdempotencyClaim =
    | { status: 'claimed' }
    | { status: 'complete'; serializedReceipt: string }
    | { status: 'pending' }
    | { status: 'conflict' };

export type CommandBatchIdempotencyLookup =
    | { status: 'missing' }
    | { status: 'complete'; serializedReceipt: string }
    | { status: 'pending' }
    | { status: 'conflict' };

export type CommandBatchIdempotencyRepository = {
    lookup: (input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
    }) => Promise<CommandBatchIdempotencyLookup>;
    claim: (input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
        reclaimPending?: boolean;
    }) => Promise<CommandBatchIdempotencyClaim>;
    complete: (input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
        serializedReceipt: string;
    }) => Promise<void>;
    tryAcquireRecoveryLease?: (input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
    }) => Promise<boolean>;
    release?: (input: { projectId: string; idempotencyKey: string; contentHash: string }) => Promise<void>;
};

export type ProjectCommandBatchIdempotencyRecord = {
    id: string;
    projectId: string;
    idempotencyKey: string;
    contentHash: string;
    state: 'effects-pending' | 'complete';
    serializedReceipt: string;
};

export type ProjectCommandBatchIdempotencyState = {
    records: ProjectCommandBatchIdempotencyRecord[];
};
