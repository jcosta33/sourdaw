import { describe, expect, it } from 'vitest';

import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { AGENT_OBJECTIVE_METRIC_IDS } from '../../models/AgentObjectiveAnalysisTypes';
import { FREQUENCY_RANGES } from '../../models/MixComparisonTypes';

const catalog = getMixRecipeCatalog();

describe('mixRecipeMetricAgreement', () => {
    it('cites only metric ids this module measures', () => {
        const measured = new Set<string>(AGENT_OBJECTIVE_METRIC_IDS);

        const unmeasured = catalog.recipes.flatMap((recipe) =>
            recipe.metrics.filter((entry) => !measured.has(entry.metric)).map((entry) => `${recipe.id}:${entry.metric}`)
        );

        expect(unmeasured).toEqual([]);
    });

    it('cites only frequency bands this module resolves', () => {
        const resolved = new Set<string>(Object.keys(FREQUENCY_RANGES));

        const unresolved = catalog.recipes.flatMap((recipe) =>
            recipe.metrics
                .filter((entry) => entry.band !== undefined && !resolved.has(entry.band))
                .map((entry) => `${recipe.id}:${String(entry.band)}`)
        );

        expect(unresolved).toEqual([]);
    });
});
