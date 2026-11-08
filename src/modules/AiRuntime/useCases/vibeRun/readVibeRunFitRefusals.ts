import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { readSecondsAtBeat } from '#/modules/Transport/stores';

import { type AgentRunBudgets } from '../../models/AgentRun';
import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { hasContradictoryMetricGoals } from '../hasContradictoryMetricGoals';
import { type MetricGoal } from '../metricGoalContractTypes';
import { readPerceptualConstraintGoals } from '../perceptualConstraints/readPerceptualConstraintGoals';
import { planMetricMeasurementRequests } from '../planMetricMeasurementRequests';
import { readArrangementRange } from '../readArrangementRange';
import { readMeasurementRenderedSeconds } from '../readMeasurementRenderedSeconds';

import { type VibeBatchPair } from './readVibeBatchPairs';
import { readVibeBatchRecipeGoals } from './readVibeBatchRecipeGoals';

const BRIEF_POSITION = 1;
const BRIEF_COMMAND_COUNT = 1;

/** Prefix reads shared with execution, including exact range identity and reference subjects. */
function previewRequests(pairs: readonly VibeBatchPair[], goals: readonly MetricGoal[], context: ProjectContext) {
    return planMetricMeasurementRequests({
        context,
        reads: goals.flatMap((goal) => {
            if (goal.metricId === null || goal.range === null || goal.relation === 'unsupported') {
                return [];
            }
            const { range, metricId } = goal;
            const step = pairs.findIndex((pair) => pair.stepId === goal.stepId) + 1;
            const prefixes = new Set([pairs.length]);
            if (step > 0) {
                prefixes.add(step);
            }
            if (step > 1) {
                prefixes.add(step - 1);
            }
            return [
                ...Array.from(prefixes).map((prefix) => ({
                    prefix: String(prefix),
                    range,
                    metricId,
                    targetIds: goal.targetIds,
                })),
                {
                    prefix: String(pairs.length),
                    range: goal.range,
                    metricId: goal.metricId,
                    targetIds: goal.referenceTargetIds,
                },
            ];
        }),
    });
}

function targetCount(request: ReturnType<typeof planMetricMeasurementRequests>[number]): number {
    return request.scope.kind === 'master' ? 1 : request.scope.ids.length;
}

function readRemaining(budgets: AgentRunBudgets, category: string): number {
    const limit = budgets.limits[category] ?? Number.POSITIVE_INFINITY;
    return limit - (budgets.consumed[category] ?? 0);
}

/**
 * Why the planned batches cannot all run as planned, checked before anything is scheduled: every
 * batch's preview must fit the run's render budget and each measurement's seconds ceilings, its
 * goals must not contradict each other or the request's holds, and every command must fit the run's
 * command budget. A run that does not fit is not scheduled at all, never shrunk to what fits.
 */
export function readVibeRunFitRefusals(input: {
    batches: readonly ScheduledVibeRunBatch[];
    context: ProjectContext;
    reading: PerceptualConstraintReading;
    budgets: AgentRunBudgets;
    initialRequests: ReturnType<typeof planMetricMeasurementRequests>;
}): string[] {
    const range = readArrangementRange(input.context);
    if (range === null) {
        return ['the arrangement holds no audio to measure each batch against'];
    }
    const refusals: string[] = [];
    const { measurementMeasuredSeconds, measurementRenderedSeconds } = readAgentResourceLimits();
    for (const required of input.initialRequests) {
        const { range: measuredRange } = required;
        const measuredSeconds =
            readSecondsAtBeat({ beat: measuredRange.endBeat }) - readSecondsAtBeat({ beat: measuredRange.startBeat });
        const renderedSeconds = readMeasurementRenderedSeconds(measuredRange.endBeat);
        if (measuredSeconds > measurementMeasuredSeconds || renderedSeconds > measurementRenderedSeconds) {
            refusals.push(
                `range ${measuredRange.sectionId ?? 'arrangement'} [${String(measuredRange.startBeat)}, ${String(measuredRange.endBeat)}] exceeds measurement ceilings (${String(measurementMeasuredSeconds)} s measured, ${String(measurementRenderedSeconds)} s from project start)`
            );
        }
    }
    const catalog = getMixRecipeCatalog();
    const holds = readPerceptualConstraintGoals(input.reading, input.context);
    const initialRenders = input.initialRequests.reduce((total, request) => total + targetCount(request), 0);
    let renders = initialRenders;
    let analyses = initialRenders;
    for (const batch of input.batches) {
        const recipeGoals = readVibeBatchRecipeGoals({ batch, catalog, range });
        if (recipeGoals.status === 'refused') {
            refusals.push(recipeGoals.reason);
            continue;
        }
        const goals = [...recipeGoals.goals, ...holds];
        if (hasContradictoryMetricGoals(goals)) {
            refusals.push(
                `batch ${String(batch.ordinal + BRIEF_POSITION)} would be asked to move a metric one way and another, or to move one the request holds`
            );
        }
        const requests = previewRequests(recipeGoals.pairs, goals, input.context);
        const comparisons = requests.reduce((total, request) => total + targetCount(request), 0);
        renders += comparisons * 2;
        analyses += comparisons;
    }
    const renderBudget = readRemaining(input.budgets, 'maxRenderJobs');
    if (renders > renderBudget) {
        refusals.push(
            `initial measurements and previewing every batch need ${String(renders)} renders, more than the ${String(renderBudget)} this run's maxRenderJobs budget has left`
        );
    }
    const analysisBudget = readRemaining(input.budgets, 'localAnalysis');
    if (analyses > analysisBudget) {
        refusals.push(
            `initial measurements and every preview need ${String(analyses)} reductions, more than the ${String(analysisBudget)} this run's localAnalysis budget has left`
        );
    }
    const commands = BRIEF_COMMAND_COUNT + input.batches.reduce((total, batch) => total + batch.commandCount, 0);
    const commandBudget = readRemaining(input.budgets, 'maxCommands');
    if (commands > commandBudget) {
        refusals.push(
            `the brief and every batch need ${String(commands)} commands, more than the ${String(commandBudget)} this run's maxCommands budget has left`
        );
    }
    return refusals;
}
