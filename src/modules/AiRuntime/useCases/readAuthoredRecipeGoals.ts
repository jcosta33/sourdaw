import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type MetricGoal } from './metricGoalContractTypes';
import { readRecipeExpectationTolerance } from './metricHoldTolerances';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;

export type AuthoredRecipeGoals = { status: 'read'; goals: MetricGoal[] } | { status: 'refused'; reason: string };

/**
 * The objective one authored recipe promises on one target: each measurable expectation, over each
 * range given, judged across the step its own expansion forms. A goal keeps the index of the
 * expectation it states, so admission can hold it to the catalog entry it came from. An expectation
 * whose metric has no versioned hold tolerance refuses the whole recipe, never one goal of it.
 */
export function readAuthoredRecipeGoals(input: {
    recipe: MixRecipeCatalog['recipes'][number];
    catalogVersion: number;
    targetId: string;
    stepId: string;
    ranges: readonly NonNullable<MetricGoal['range']>[];
    goalId: (expectationIndex: number, range: NonNullable<MetricGoal['range']>) => string;
}): AuthoredRecipeGoals {
    const { recipe } = input;
    const metricIds = getAgentMeasurementMetricIds();
    const recipeDigest = digest(recipe);
    const goals: MetricGoal[] = [];
    for (const [expectationIndex, expectation] of recipe.metrics.entries()) {
        const metricId = metricIds.find((metric) => metric === expectation.metric);
        if (metricId === undefined) {
            continue;
        }
        const tolerance = readRecipeExpectationTolerance(metricId, expectation.direction);
        if (tolerance.status === 'missing') {
            return {
                status: 'refused',
                reason: `recipe ${recipe.id} holds ${metricId}, which has no versioned hold tolerance`,
            };
        }
        for (const range of input.ranges) {
            goals.push({
                goalId: input.goalId(expectationIndex, range),
                stepId: input.stepId,
                metricId,
                band: expectation.band ?? null,
                targetIds: [input.targetId],
                referenceTargetIds: [],
                range,
                relation: expectation.direction,
                targetValue: null,
                tolerance: tolerance.tolerance,
                source: {
                    kind: 'recipe',
                    recipeId: recipe.id,
                    catalogVersion: input.catalogVersion,
                    recipeDigest,
                    expectationIndex,
                },
            });
        }
    }
    return { status: 'read', goals };
}
