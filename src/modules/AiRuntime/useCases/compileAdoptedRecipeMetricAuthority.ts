import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';

import { type CreativeRequestAuthority, getCreativeSelectionSnapshot } from '../models/CreativeInterpretation';
import { type ProjectContext } from '../models/ProjectContext';
import { type RetainedCompilation } from '../models/RetainedCompilation';

import { compileRecipeBatchSteps, readRecipeStepId } from './compileRecipeBatchSteps';
import { type MetricGoal, type MetricGoalState, type MetricRequestAuthority } from './metricGoalContractTypes';
import { readArrangementRange } from './readArrangementRange';
import { readAuthoredRecipeGoals } from './readAuthoredRecipeGoals';
import { readTargetCarriesAudio } from './readTargetCarriesAudio';

type RecipeCompilation = Extract<RetainedCompilation, { kind: 'recipe' }>;

type AdoptedRecipeMetricAuthority =
    /** Nothing the user adopted states an expectation to verify, so the batch is the literal choice it always was. */
    | { status: 'literal' }
    | { status: 'perceptual'; authority: MetricRequestAuthority; steps: MetricGoalState['steps'][number][] }
    | { status: 'refused'; reason: string };

/**
 * The objective a batch of recipes the application expanded itself is approved against: every
 * measurable expectation of each authored recipe adopted, on its own track, over the whole
 * arrangement, judged across that recipe's own step, so the preview measures what each recipe
 * promises and Confirm waits for it. A factory preset states none, since choosing a named preset is a
 * literal choice with nothing to predict, and a target proven silent, an empty track or a bus nothing audible feeds, has nothing to measure; a
 * batch with no goal left stays literal, and a mixed batch carries the goals of its authored pairs
 * alone. Every recipe still forms a step, so the last prefix ends at the whole batch.
 */
export function compileAdoptedRecipeMetricAuthority(input: {
    origin: 'answer-suggestion' | 'last-commit-recipe';
    compilations: readonly RecipeCompilation[];
    context: ProjectContext;
    prompt: string;
    creativeAuthority: CreativeRequestAuthority;
}): AdoptedRecipeMetricAuthority {
    const { context, creativeAuthority } = input;
    const range = readArrangementRange(context);
    if (range === null) {
        return { status: 'literal' };
    }
    const catalog = getMixRecipeCatalog();
    const goals: MetricGoal[] = [];
    for (const { recipe: adopted } of input.compilations) {
        const recipe = catalog.recipes.find((candidate) => candidate.id === adopted.recipeId);
        if (recipe === undefined) {
            return { status: 'refused', reason: `recipe ${adopted.recipeId} is no longer in the catalog` };
        }
        const holdsAudio = readTargetCarriesAudio(context, adopted.targetId);
        if (recipe.origin !== undefined || !holdsAudio) {
            continue;
        }
        const read = readAuthoredRecipeGoals({
            recipe,
            catalogVersion: catalog.version,
            targetId: adopted.targetId,
            stepId: readRecipeStepId(adopted),
            ranges: [range],
            goalId: (expectationIndex) =>
                `${input.origin}:${creativeAuthority.authorityId}:${adopted.targetId}:${adopted.recipeId}:${String(expectationIndex)}`,
        });
        if (read.status === 'refused') {
            return read;
        }
        goals.push(...read.goals);
    }
    if (goals.length === 0) {
        return { status: 'literal' };
    }
    const compiledSteps = compileRecipeBatchSteps({
        stepIds: input.compilations.map(({ recipe }) => readRecipeStepId(recipe)),
        compilations: input.compilations,
        context,
        prompt: input.prompt,
        revision: creativeAuthority.revision,
        runId: 'adopted-recipe-steps',
        creativeAuthority,
    });
    if (compiledSteps.status === 'refused') {
        return compiledSteps;
    }
    return {
        status: 'perceptual',
        steps: compiledSteps.steps,
        authority: {
            schemaVersion: 1,
            authorityId: `${input.origin}-${creativeAuthority.authorityId}`,
            origin: input.origin,
            callId: null,
            turn: null,
            catalogId: creativeAuthority.catalogId,
            requestDigest: creativeAuthority.requestDigest,
            revision: creativeAuthority.revision,
            projectId: captureProjectIdentity(),
            selection: getCreativeSelectionSnapshot(context),
            kind: 'perceptual',
            goals,
            creativeAuthority,
        },
    };
}
