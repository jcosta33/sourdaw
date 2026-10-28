import { REMOTE_EVIDENCE_AGENT_DATA_CATEGORIES, type AgentDataCategory } from './AgentDataPolicy';
import { type ApplicationToolReceipt } from './ApplicationOwnedTool';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MEASUREMENT_RECEIPT_KINDS: readonly string[] = [
    'analysis-measurement',
    'reference-measurement',
    'transient-onset-read',
];

/**
 * The data categories a tool receipt adds to a hosted request that replays it. Measurement receipts
 * carry local numeric evidence from a render, a reference, or source-buffer onset detection, never
 * audio samples. Every other receipt adds nothing beyond what a request already declares.
 */
export function classifyApplicationToolReceiptData(receipt: ApplicationToolReceipt): readonly AgentDataCategory[] {
    if (
        receipt.status === 'success' &&
        isRecord(receipt.data) &&
        typeof receipt.data.kind === 'string' &&
        MEASUREMENT_RECEIPT_KINDS.includes(receipt.data.kind)
    ) {
        return REMOTE_EVIDENCE_AGENT_DATA_CATEGORIES;
    }
    return [];
}
