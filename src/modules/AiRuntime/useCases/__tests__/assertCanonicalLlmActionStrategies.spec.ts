import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { assertCanonicalLlmActionStrategies } from '../assertCanonicalLlmActionStrategies';

describe('assertCanonicalLlmActionStrategies', () => {
    it('rejects an expected strategy action missing from the command grounding catalogue', () => {
        const catalogWithoutAddMarker = getExecutableAppActionGroundingCatalog().filter(
            (entry) => entry.actionType !== 'addMarker'
        );

        expect(() => assertCanonicalLlmActionStrategies(catalogWithoutAddMarker)).toThrow(
            'LLM action strategy is not a canonical executable action: addMarker'
        );
    });
});
