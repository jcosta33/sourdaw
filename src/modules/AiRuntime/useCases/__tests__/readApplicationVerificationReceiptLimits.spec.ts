import { describe, expect, it } from 'vitest';

import { APPLICATION_TOOL_RECEIPT_MAX_BYTES, type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import {
    admitTurnReadReceipts,
    byteLength,
    serializeReceiptContext,
} from '../../services/applicationToolReceiptBudget';
import { MAX_PLAN_APPLICATION_TOOL_RECEIPTS } from '../../stores/agentRunStore';
import { readApplicationVerificationReceiptLimits } from '../readApplicationVerificationReceiptLimits';

/** A success receipt that serializes to exactly the per-receipt bound, the largest `boundReceipt` keeps. */
function maximalReceipt(index: number): ApplicationToolReceipt {
    const receipt: ApplicationToolReceipt = {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: `goal-measure-${String(index).padStart(4, '0')}`,
        toolName: 'analysis.measure',
        turn: 0,
        origin: 'application-verification',
        status: 'success',
        revision: 'rev-1',
        data: null,
        summary: '',
        warnings: [],
        error: null,
    };
    const padding = APPLICATION_TOOL_RECEIPT_MAX_BYTES - byteLength(JSON.stringify(receipt));
    return { ...receipt, summary: 'x'.repeat(padding) };
}

function admit(receipts: readonly ApplicationToolReceipt[], priorBytes: number, limitCount: number) {
    const limits = readApplicationVerificationReceiptLimits(limitCount);
    return admitTurnReadReceipts({
        realReceipts: receipts,
        turn: 0,
        totalReceiptBytesSoFar: priorBytes,
        maxReceiptBytesPerTurn: limits.maxBytesPerCollection,
        maxTotalReceiptBytes: limits.maxTotalBytes,
    });
}

describe('readApplicationVerificationReceiptLimits', () => {
    it('builds receipts at exactly the per-receipt bound', () => {
        expect(byteLength(JSON.stringify(maximalReceipt(0)))).toBe(APPLICATION_TOOL_RECEIPT_MAX_BYTES);
    });

    it.each([1, 2, 5])('admits a collection of %i maximal receipts whole, context wrapper included', (count) => {
        const receipts = Array.from({ length: count }, (_, index) => maximalReceipt(index));

        const admitted = admit(receipts, 0, count);

        expect(admitted.map((receipt) => receipt.status)).toEqual(receipts.map(() => 'success'));
        expect(byteLength(serializeReceiptContext(receipts, 0))).toBeLessThanOrEqual(
            readApplicationVerificationReceiptLimits(count).maxBytesPerCollection
        );
    });

    it('still refuses a collection past its own allowance', () => {
        const receipts = [maximalReceipt(0), maximalReceipt(1)];

        const admitted = admit(receipts, 0, 1);

        expect(admitted.map((receipt) => receipt.error?.code ?? receipt.status)).toContain('turn-receipt-budget-spent');
    });

    it('admits the last of a plan bound of maximal receipts after the rest were persisted', () => {
        const prior = Array.from({ length: MAX_PLAN_APPLICATION_TOOL_RECEIPTS - 1 }, (_, index) =>
            maximalReceipt(index)
        );
        const last = maximalReceipt(MAX_PLAN_APPLICATION_TOOL_RECEIPTS - 1);
        // What the collections measure as already spent: one context per persisted turn, all turn 0.
        const priorBytes = byteLength(serializeReceiptContext(prior, 0));

        const admitted = admit([last], priorBytes, 1);

        expect(admitted.map((receipt) => receipt.status)).toEqual(['success']);
    });
});
