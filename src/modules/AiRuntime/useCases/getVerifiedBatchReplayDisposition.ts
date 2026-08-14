type VerifiedBatchReplayReceipt = {
    outcome:
        | 'committed'
        | 'committed-with-warning'
        | 'executed'
        | 'executed-with-warning'
        | 'no-op'
        | 'ambiguous'
        | 'rejected'
        | 'conflicted'
        | 'cancelled'
        | 'failed'
        | 'partially-committed'
        | 'verification-failed';
    errors: readonly string[];
    warnings: readonly string[];
    modelSummary: string;
};

type VerifiedBatchReplayDisposition =
    | { status: 'committed'; warning?: string }
    | { status: 'executed'; warning?: string }
    | { status: 'no-op' }
    | { status: 'cancelled' }
    | { status: 'ambiguous'; reason: string }
    | { status: 'failed'; reason: string };

function receiptDetail(receipt: VerifiedBatchReplayReceipt): string {
    return receipt.errors[0] ?? receipt.warnings[0] ?? receipt.modelSummary;
}

export function getVerifiedBatchReplayDisposition(receipt: VerifiedBatchReplayReceipt): VerifiedBatchReplayDisposition {
    if (receipt.outcome === 'committed') {
        return { status: 'committed' as const };
    }
    if (receipt.outcome === 'committed-with-warning' || receipt.outcome === 'partially-committed') {
        return { status: 'committed' as const, warning: receiptDetail(receipt) };
    }
    if (receipt.outcome === 'executed') {
        return { status: 'executed' as const };
    }
    if (receipt.outcome === 'executed-with-warning') {
        return { status: 'executed' as const, warning: receiptDetail(receipt) };
    }
    if (receipt.outcome === 'no-op' || receipt.outcome === 'cancelled') {
        return { status: receipt.outcome };
    }
    if (receipt.outcome === 'ambiguous') {
        return { status: 'ambiguous' as const, reason: receiptDetail(receipt) };
    }
    return { status: 'failed' as const, reason: receiptDetail(receipt) };
}
