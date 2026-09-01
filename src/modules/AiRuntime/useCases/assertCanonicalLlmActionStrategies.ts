import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { markerSectionActionNames } from '../transformers/llmActionStrategies/markerSectionStrategy';
import { transportTimelineActionNames } from '../transformers/llmActionStrategies/transportTimelineStrategy';

const llmActionStrategyNames = [...markerSectionActionNames, ...transportTimelineActionNames] as const;

export function assertCanonicalLlmActionStrategies(catalog = getExecutableAppActionGroundingCatalog()): void {
    const canonicalActionNames = new Set(catalog.map((entry) => entry.actionType));
    for (const actionName of llmActionStrategyNames) {
        if (!canonicalActionNames.has(actionName)) {
            throw new Error(`LLM action strategy is not a canonical executable action: ${actionName}`);
        }
    }
}

assertCanonicalLlmActionStrategies();
