import { markerSectionActionNames } from '../transformers/llmActionStrategies/markerSectionStrategy';
import { transportTimelineActionNames } from '../transformers/llmActionStrategies/transportTimelineStrategy';

const llmActionStrategyNames = [...markerSectionActionNames, ...transportTimelineActionNames] as const;

export function assertCanonicalLlmActionStrategies(catalog: readonly { actionType: string }[]): void {
    const canonicalActionNames = new Set(catalog.map((entry) => entry.actionType));
    for (const actionName of llmActionStrategyNames) {
        if (!canonicalActionNames.has(actionName)) {
            throw new Error(`LLM action strategy is not a canonical executable action: ${actionName}`);
        }
    }
}
