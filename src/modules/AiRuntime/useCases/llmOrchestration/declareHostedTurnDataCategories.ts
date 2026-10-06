import { REMOTE_TEXT_AGENT_DATA_CATEGORIES, type AgentDataCategory } from '../../models/AgentDataPolicy';
import { classifyApplicationToolReceiptData } from '../../models/ApplicationToolReceiptData';
import { type HostedTurnHistory } from '../../models/HostedTurnHistory';

/**
 * The categories one hosted planning request declares: the text every request carries, then the
 * evidence categories of each receipt the replayed history hands back, once each in first-seen order.
 * The request and its disclosure state this same list, so the disclosure names what was sent.
 */
export function declareHostedTurnDataCategories(history: HostedTurnHistory | undefined): AgentDataCategory[] {
    const declared = new Set<AgentDataCategory>(REMOTE_TEXT_AGENT_DATA_CATEGORIES);
    for (const record of history ?? []) {
        for (const receipt of record.receipts) {
            for (const category of classifyApplicationToolReceiptData(receipt)) {
                declared.add(category);
            }
        }
    }
    return [...declared];
}
