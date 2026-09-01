import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { markerSectionActionNames } from '../../transformers/llmActionStrategies/markerSectionStrategy';
import { transportTimelineActionNames } from '../../transformers/llmActionStrategies/transportTimelineStrategy';
import { assertCanonicalLlmActionStrategies } from '../assertCanonicalLlmActionStrategies';

const llmActionStrategyNames = [...markerSectionActionNames, ...transportTimelineActionNames] as const;

describe('assertCanonicalLlmActionStrategies', () => {
    it.each(llmActionStrategyNames)(
        'rejects %s when it is missing from the command grounding catalogue',
        (actionName) => {
            const catalogWithoutAction = getExecutableAppActionGroundingCatalog().filter(
                (entry) => entry.actionType !== actionName
            );

            expect(() => assertCanonicalLlmActionStrategies(catalogWithoutAction)).toThrow(
                `LLM action strategy is not a canonical executable action: ${actionName}`
            );
        }
    );
});
