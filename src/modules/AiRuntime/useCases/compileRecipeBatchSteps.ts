import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { type PerceptualConstraintReading } from '../models/PerceptualConstraint';
import { type ProjectContext } from '../models/ProjectContext';
import { type RetainedCompilation } from '../models/RetainedCompilation';

import { compilePreviewMeasurementProposal } from './compilePreviewMeasurementProposal';
import { digestCommandBatchContent } from './digestCommandBatchContent';
import { type MetricGoalState } from './metricGoalContractTypes';
import { readRecipeStepId } from './readRecipeStepId';

type RecipeCompilation = Extract<RetainedCompilation, { kind: 'recipe' }>;

type CompiledRecipeBatchSteps =
    { status: 'compiled'; steps: MetricGoalState['steps'][number][] } | { status: 'refused'; reason: string };

/**
 * One step per recipe expansion, in batch order, each bound to the exact cumulative commands its
 * expansion and every one before it compile to, hashed as the planner hashes an adopted recipe
 * prefix, so a preview measures each recipe's own movement and the last step ends at the whole batch.
 * A step that does not compile, or an expansion that no longer matches the step expected of it,
 * refuses the batch.
 */
export function compileRecipeBatchSteps(input: {
    stepIds: readonly string[];
    compilations: readonly RecipeCompilation[];
    context: ProjectContext;
    prompt: string;
    revision: string;
    runId: string;
    creativeAuthority: CreativeRequestAuthority;
    recordedConstraints?: PerceptualConstraintReading;
}): CompiledRecipeBatchSteps {
    const steps: MetricGoalState['steps'][number][] = [];
    for (const [index, compilation] of input.compilations.entries()) {
        const stepId = input.stepIds[index];
        if (stepId === undefined || stepId !== readRecipeStepId(compilation.recipe)) {
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
            stepId,
            commandCount: compilation.commands.length,
            operationTypes: compilation.commands.map((command) => command.operation),
            recipePrefixHash: digestCommandBatchContent(prefix.envelope),
        });
    }
    if (steps.length !== input.stepIds.length) {
        return { status: 'refused', reason: 'its recipe expansions no longer match its plan' };
    }
    return { status: 'compiled', steps };
}
