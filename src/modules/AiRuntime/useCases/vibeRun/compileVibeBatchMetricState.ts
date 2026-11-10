import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type CreativeRequestAuthority, getCreativeSelectionSnapshot } from '../../models/CreativeInterpretation';
import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import { type RetainedCompilation } from '../../models/RetainedCompilation';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { compilePreviewMeasurementProposal } from '../compilePreviewMeasurementProposal';
import { digestCommandBatchContent } from '../digestCommandBatchContent';
import { type MetricGoalState, type MetricRequestAuthority } from '../metricGoalContractTypes';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { readArrangementRange } from '../readArrangementRange';

import { readVibeBatchRecipeGoals } from './readVibeBatchRecipeGoals';

type RecipeCompilation = Extract<RetainedCompilation, { kind: 'recipe' }>;

type CompiledVibeBatchMetricState =
    { status: 'compiled'; metricGoalState: string } | { status: 'refused'; reason: string };

/**
 * The objective a planned batch is approved against: every measurable expectation of each pair's
 * authored recipe, judged across that pair's own step, under an authority the vibe-run plan states
 * rather than one a provider admitted. Each step is bound to the exact cumulative commands its pair
 * and every pair before it expand to, hashed as the planner hashes an adopted recipe prefix, so the
 * preview measures each recipe's own movement. A step that does not compile refuses the batch.
 */
export function compileVibeBatchMetricState(input: {
    batch: ScheduledVibeRunBatch;
    compilations: readonly RecipeCompilation[];
    context: ProjectContext;
    prompt: string;
    revision: string;
    runId: string;
    creativeAuthority: CreativeRequestAuthority;
    recordedConstraints: PerceptualConstraintReading;
}): CompiledVibeBatchMetricState {
    const range = readArrangementRange(input.context);
    if (range === null) {
        return { status: 'refused', reason: 'the arrangement holds no audio to measure it against' };
    }
    const read = readVibeBatchRecipeGoals({ batch: input.batch, catalog: getMixRecipeCatalog(), range });
    if (read.status === 'refused') {
        return read;
    }
    const steps: MetricGoalState['steps'][number][] = [];
    for (const [index, compilation] of input.compilations.entries()) {
        const pair = read.pairs[index];
        if (
            pair === undefined ||
            pair.stepId !== `recipe:${compilation.recipe.recipeId}:${compilation.recipe.targetId}`
        ) {
            return { status: 'refused', reason: 'its recipe expansions no longer match its plan' };
        }
        const prefix = compilePreviewMeasurementProposal({
            callId: compilation.callId,
            source: { retained: input.compilations.slice(0, index + 1) },
            context: input.context,
            prompt: input.prompt,
            revision: input.revision,
            runId: input.runId,
            creativeAuthority: input.creativeAuthority,
            recordedConstraints: input.recordedConstraints,
        });
        if (prefix.status !== 'compiled') {
            return { status: 'refused', reason: prefix.reason };
        }
        steps.push({
            stepId: pair.stepId,
            commandCount: compilation.commands.length,
            operationTypes: compilation.commands.map((command) => command.operation),
            recipePrefixHash: digestCommandBatchContent(prefix.envelope),
        });
    }
    if (steps.length !== read.pairs.length) {
        return { status: 'refused', reason: 'its recipe expansions no longer match its plan' };
    }
    const authority: MetricRequestAuthority = {
        schemaVersion: 1,
        authorityId: `vibe-run-plan-${digest({ requestDigest: input.creativeAuthority.requestDigest, batchId: input.batch.id, revision: input.revision })}`,
        origin: 'vibe-run-plan',
        callId: null,
        turn: null,
        catalogId: input.creativeAuthority.catalogId,
        requestDigest: input.creativeAuthority.requestDigest,
        revision: input.revision,
        projectId: captureProjectIdentity(),
        selection: getCreativeSelectionSnapshot(input.context),
        kind: 'perceptual',
        goals: read.goals,
        creativeAuthority: input.creativeAuthority,
    };
    const state: MetricGoalState = { schemaVersion: 1, authorities: [authority], steps, proofs: [], binding: null };
    const metricGoalState = JSON.stringify(state);
    if (metricGoalStateCodec(metricGoalState) === null) {
        return { status: 'refused', reason: 'its verification record could not be read back' };
    }
    return { status: 'compiled', metricGoalState };
}
