import { commandBatchIdempotencyStore } from '../stores/commandBatchIdempotencyStore';

const MAX_RECORDS = 4_096;
const MAX_RECEIPT_BYTES = 1_048_576;

type RecordProjectCommandBatchIdempotencyCheckpointInput = {
    projectId: string;
    idempotencyKey: string;
    contentHash: string;
    state: 'effects-pending' | 'complete';
    serializedReceipt: string;
};

export function recordProjectCommandBatchIdempotencyCheckpoint(
    input: RecordProjectCommandBatchIdempotencyCheckpointInput
): void {
    if (new TextEncoder().encode(input.serializedReceipt).byteLength > MAX_RECEIPT_BYTES) {
        throw new Error('The project idempotency receipt exceeds the durable limit');
    }
    const state = commandBatchIdempotencyStore.value ?? { records: [] };
    const existing = state.records.filter(
        (record) => record.projectId === input.projectId && record.idempotencyKey === input.idempotencyKey
    );
    if (existing.some((record) => record.contentHash !== input.contentHash)) {
        throw new Error('Idempotency key was already used for different batch content');
    }
    const id = `${input.projectId}\u0000${input.idempotencyKey}\u0000${input.contentHash}`;
    if (existing.length > 0) {
        commandBatchIdempotencyStore.set({
            records: state.records.map((record) =>
                record.id === id
                    ? { ...record, state: input.state, serializedReceipt: input.serializedReceipt }
                    : record
            ),
        });
        return;
    }
    if (state.records.length >= MAX_RECORDS) {
        throw new Error('The project idempotency ledger reached its retention limit');
    }
    commandBatchIdempotencyStore.set({
        records: [
            ...state.records,
            {
                id,
                projectId: input.projectId,
                idempotencyKey: input.idempotencyKey,
                contentHash: input.contentHash,
                state: input.state,
                serializedReceipt: input.serializedReceipt,
            },
        ],
    });
}
