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
    }) => Promise<CommandBatchIdempotencyClaim>;
    complete: (input: {
        projectId: string;
        idempotencyKey: string;
        contentHash: string;
        serializedReceipt: string;
    }) => Promise<void>;
};

export type ProjectCommandBatchIdempotencyRecord = {
    id: string;
    projectId: string;
    idempotencyKey: string;
    contentHash: string;
    serializedReceipt: string;
};

export type ProjectCommandBatchIdempotencyState = {
    records: ProjectCommandBatchIdempotencyRecord[];
};
