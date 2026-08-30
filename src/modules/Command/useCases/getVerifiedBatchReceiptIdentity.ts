import { type createVerifiedBatchReceipt, VERIFIED_BATCH_RECEIPT_SCHEMA_VERSION } from './createVerifiedBatchReceipt';

export function getVerifiedBatchReceiptIdentity(input: {
    runId: string;
    batchId: string;
    outcome: ReturnType<typeof createVerifiedBatchReceipt>['outcome'];
}): string {
    return `${VERIFIED_BATCH_RECEIPT_SCHEMA_VERSION}:${input.runId}:${input.batchId}:${input.outcome}`;
}
