import { APPLICATION_TOOL_RECEIPT_MAX_BYTES } from '../models/ApplicationOwnedTool';
import { MAX_PLAN_APPLICATION_TOOL_RECEIPTS } from '../stores/agentRunStore';

/**
 * Bounds on the receipts the application measures itself, at turn 0 with origin
 * `application-verification`: a vibe run's initial baselines and every approval preview. They are
 * persisted run-plan evidence and never provider context — `runApplicationOwnedToolLoop` starts
 * its receipt context empty and counts only its own turns' receipts, and the collections that
 * write these call no provider — so the tool loop's provider-context caps are the wrong bound for them.
 *
 * Their bytes follow from their count. Each receipt is already bounded to
 * `APPLICATION_TOOL_RECEIPT_MAX_BYTES` (`boundReceipt`), and how many a run writes is known exactly
 * before anything is scheduled: one per measurement request, across the initial figures and every
 * batch preview, which the whole-run fit counts against `MAX_PLAN_APPLICATION_TOOL_RECEIPTS`. So one
 * collection may hold its own receipts at the per-receipt bound, and a run everything its receipt
 * bound admits at that bound, prior receipts included; no figure measured on one song sizes them.
 */
export function readApplicationVerificationReceiptLimits(collectionReceipts: number): {
    maxBytesPerCollection: number;
    maxTotalBytes: number;
} {
    return {
        maxBytesPerCollection: collectionReceipts * APPLICATION_TOOL_RECEIPT_MAX_BYTES,
        maxTotalBytes: MAX_PLAN_APPLICATION_TOOL_RECEIPTS * APPLICATION_TOOL_RECEIPT_MAX_BYTES,
    };
}
