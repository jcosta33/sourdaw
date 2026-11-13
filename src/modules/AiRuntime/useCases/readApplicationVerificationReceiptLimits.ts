import { maximalReceiptContextBytes } from '../services/applicationToolReceiptBudget';
import { MAX_PLAN_APPLICATION_TOOL_RECEIPTS } from '../stores/agentRunStore';

/**
 * Bounds on the receipts the application measures itself, at turn 0 with origin
 * `application-verification`: a vibe run's initial baselines and every approval preview. They are
 * persisted run-plan evidence and never provider context — `runApplicationOwnedToolLoop` starts
 * its receipt context empty and counts only its own turns' receipts, and the collections that
 * write these call no provider — so the tool loop's provider-context caps are the wrong bound for them.
 *
 * Their bytes follow from their count, measured as admission measures them. Each receipt is
 * already bounded to `APPLICATION_TOOL_RECEIPT_MAX_BYTES` (`boundReceipt`), and how many a run writes
 * is known exactly before anything is scheduled: one per measurement request, across the initial
 * figures and every batch preview, which the whole-run fit counts against
 * `MAX_PLAN_APPLICATION_TOOL_RECEIPTS`. `admitTurnReadReceipts` measures a collection as its
 * serialized receipt context, wrapper and separators included, and a run's spend as one such
 * context per turn its receipts carry. So one collection may hold its own receipts at the
 * per-receipt bound in one turn-0 context, and a run everything its receipt bound admits at that
 * bound with as many contexts as receipts, the most turns those receipts can span; no figure
 * measured on one song sizes them.
 */
export function readApplicationVerificationReceiptLimits(collectionReceipts: number): {
    maxBytesPerCollection: number;
    maxTotalBytes: number;
} {
    return {
        maxBytesPerCollection: maximalReceiptContextBytes(collectionReceipts, 0),
        maxTotalBytes: MAX_PLAN_APPLICATION_TOOL_RECEIPTS * maximalReceiptContextBytes(1, 0),
    };
}
