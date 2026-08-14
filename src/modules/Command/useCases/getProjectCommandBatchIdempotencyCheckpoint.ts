import { commandBatchIdempotencyStore } from '../stores/commandBatchIdempotencyStore';

type GetProjectCommandBatchIdempotencyCheckpointInput = {
    projectId: string;
    idempotencyKey: string;
    contentHash: string;
};

type GetProjectCommandBatchIdempotencyCheckpointOutput =
    | { status: 'missing' }
    | { status: 'pending' | 'complete'; serializedReceipt: string }
    | { status: 'conflict' }
    | { status: 'unsupported-schema' };

export function getProjectCommandBatchIdempotencyCheckpoint(
    input: GetProjectCommandBatchIdempotencyCheckpointInput
): GetProjectCommandBatchIdempotencyCheckpointOutput {
    commandBatchIdempotencyStore.hydrate();
    const state = commandBatchIdempotencyStore.value;
    if (state && 'unsupportedSchema' in state) {
        return { status: 'unsupported-schema' };
    }
    const matches =
        state?.records.filter(
            (record) => record.projectId === input.projectId && record.idempotencyKey === input.idempotencyKey
        ) ?? [];
    if (matches.length === 0) {
        return { status: 'missing' };
    }
    if (matches.some((record) => record.contentHash !== input.contentHash)) {
        return { status: 'conflict' };
    }
    const serializedReceipts = new Set(matches.map((record) => record.serializedReceipt));
    if (serializedReceipts.size !== 1) {
        return { status: 'conflict' };
    }
    const serializedReceipt = matches[0]?.serializedReceipt;
    if (!serializedReceipt) {
        return { status: 'conflict' };
    }
    return matches.every((record) => record.state === 'complete')
        ? { status: 'complete', serializedReceipt }
        : { status: 'pending', serializedReceipt };
}
