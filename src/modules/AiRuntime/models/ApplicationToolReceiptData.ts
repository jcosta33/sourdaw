import { REMOTE_EVIDENCE_AGENT_DATA_CATEGORIES, type AgentDataCategory } from './AgentDataPolicy';
import { type ApplicationToolReceipt } from './ApplicationOwnedTool';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The data categories a tool receipt adds to a hosted request that replays it. A measurement receipt
 * carries figures the application reduced from its own render, so it names the evidence category and
 * never a render, a stem or raw audio; every other receipt adds nothing beyond what a request already
 * declares.
 */
export function classifyApplicationToolReceiptData(receipt: ApplicationToolReceipt): readonly AgentDataCategory[] {
    if (receipt.status === 'success' && isRecord(receipt.data) && receipt.data.kind === 'analysis-measurement') {
        return REMOTE_EVIDENCE_AGENT_DATA_CATEGORIES;
    }
    return [];
}
