import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { readSecondsAtBeat } from '#/modules/Transport/stores';

import { type AgentRunBudgets } from '../../models/AgentRun';
import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import {
    SEMANTIC_COMMAND_LIST_ROLE_FAMILIES,
    type SemanticCommandListRoleFamily,
} from '../../models/SemanticCommandList';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { MAX_PLAN_APPLICATION_TOOL_RECEIPTS } from '../../stores/agentRunStore';
import { countMeasurementWork } from '../countMeasurementWork';
import { hasContradictoryMetricGoals } from '../hasContradictoryMetricGoals';
import { type MetricGoal } from '../metricGoalContractTypes';
import { readPerceptualConstraintGoals } from '../perceptualConstraints/readPerceptualConstraintGoals';
import { planMetricMeasurementRequests } from '../planMetricMeasurementRequests';
import { planMetricMeasurementUnits } from '../planMetricMeasurementUnits';
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

type InitialRead = Parameters<typeof planMetricMeasurementRequests>[0]['reads'][number];
type RunWork = { renders: number; analyses: number; receipts: number; commands: number; targets: number };
type Budget = {
    category: 'maxRenderJobs' | 'localAnalysis' | 'applicationToolReceipts' | 'maxCommands';
    field: keyof RunWork;
    remaining: number;
};

function readRemaining(budgets: AgentRunBudgets, category: string): number {
    const limit = budgets.limits[category] ?? Number.POSITIVE_INFINITY;
    return limit - (budgets.consumed[category] ?? 0);
}

/**
 * What the initial measurements and every batch preview spend, counted by the rule execution
 * admits each measurement unit by (`countMeasurementWork`), so what fits is what runs. Each
 * measurement request reports in one receipt the run persists, so the receipts are its requests.
 */
function readRunWork(input: {
    batches: readonly ScheduledVibeRunBatch[];
    initialReads: readonly InitialRead[];
    context: ProjectContext;
    batchGoals: ReadonlyMap<string, { pairs: readonly VibeBatchPair[]; goals: readonly MetricGoal[] }>;
}): RunWork {
    const initialRequests = planMetricMeasurementRequests({ context: input.context, reads: input.initialReads });
    const initial = countMeasurementWork(planMetricMeasurementUnits({ requests: initialRequests, subject: 'project' }));
    let renders = initial.renderJobs;
    let analyses = initial.analyses;
    let receipts = initialRequests.length;
    for (const batch of input.batches) {
        const planned = input.batchGoals.get(batch.id);
        if (planned === undefined) {
            continue;
        }
        const requests = previewRequests(planned.pairs, planned.goals, input.context);
        const work = countMeasurementWork(planMetricMeasurementUnits({ requests, subject: 'preview' }));
        renders += work.renderJobs;
        analyses += work.analyses;
        receipts += requests.length;
    }
    return {
        renders,
        analyses,
        receipts,
        commands: BRIEF_COMMAND_COUNT + input.batches.reduce((total, batch) => total + batch.commandCount, 0),
        targets: new Set(input.batches.flatMap((batch) => batch.targetIds)).size,
    };
}

function fits(work: RunWork, budgets: readonly Budget[]): boolean {
    return budgets.every((budget) => work[budget.field] <= budget.remaining);
}

function familyOrder(family: SemanticCommandListRoleFamily): number {
    return SEMANTIC_COMMAND_LIST_ROLE_FAMILIES.indexOf(family);
}

/** True when `left` comes first in the role-family vocabulary, read family by family. */
function precedes(
    left: readonly SemanticCommandListRoleFamily[],
    right: readonly SemanticCommandListRoleFamily[]
): boolean {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const order = familyOrder(left[index]!) - familyOrder(right[index]!);
        if (order !== 0) {
            return order < 0;
        }
    }
    return left.length < right.length;
}

function joinFamilies(families: readonly string[]): string {
    if (families.length === 1) {
        return `the ${families[0]!} family`;
    }
    return `the ${families.slice(0, -1).join(', ')} and ${families.at(-1)!} families`;
}

/**
 * The largest set of role families whose batches would fit on their own, as a sentence for the
 * card; it is advice, never applied. The most targets win, and a tie goes to the families earlier
 * in `SEMANTIC_COMMAND_LIST_ROLE_FAMILIES`.
 */
function describeFittingFamilies(input: Parameters<typeof readRunWork>[0], budgets: readonly Budget[]): string {
    const families = SEMANTIC_COMMAND_LIST_ROLE_FAMILIES.filter((family) =>
        input.batches.some((batch) => batch.objective.role === family)
    );
    let best: { families: SemanticCommandListRoleFamily[]; targets: number } | null = null;
    for (let mask = 1; mask < 2 ** families.length - 1; mask++) {
        const chosen = families.filter((_, index) => (mask & (2 ** index)) !== 0);
        const batches = input.batches.filter((batch) => chosen.includes(batch.objective.role));
        const targetIds = new Set(batches.flatMap((batch) => batch.targetIds));
        const initialReads = input.initialReads.flatMap((read) => {
            const targets = read.targetIds.filter((id) => targetIds.has(id));
            return targets.length === 0 ? [] : [{ ...read, targetIds: targets }];
        });
        const work = readRunWork({ ...input, batches, initialReads });
        if (!fits(work, budgets)) {
            continue;
        }
        const better =
            best === null ||
            work.targets > best.targets ||
            (work.targets === best.targets && precedes(chosen, best.families));
        if (better) {
            best = { families: chosen, targets: work.targets };
        }
    }
    if (best === null) {
        return 'no role family fits on its own';
    }
    const tracks = `${String(best.targets)} ${best.targets === 1 ? 'track' : 'tracks'}`;
    return `${joinFamilies(best.families)} (${tracks}) ${best.families.length === 1 ? 'fits' : 'fit'}`;
}

/**
 * Why the planned batches cannot all run as planned, checked before anything is scheduled: every
 * batch's preview must fit the run's render budget and each measurement's seconds ceilings, the
 * receipts they persist must fit the plan's receipt bound beside those it already holds, its goals
 * must not contradict each other or the request's holds, and every command must fit the run's
 * command budget. A run that does not fit is not scheduled at all, never shrunk to what fits; a
 * budget refusal names the largest set of role families that would fit, for the user to ask for.
 */
export function readVibeRunFitRefusals(input: {
    batches: readonly ScheduledVibeRunBatch[];
    context: ProjectContext;
    reading: PerceptualConstraintReading;
    budgets: AgentRunBudgets;
    initialReads: readonly InitialRead[];
    /** Receipts the run's plan already holds, which share its receipt bound. */
    priorReceipts: number;
}): string[] {
    const range = readArrangementRange(input.context);
    if (range === null) {
        return ['the arrangement holds no audio to measure each batch against'];
    }
    const refusals: string[] = [];
    const { measurementMeasuredSeconds, measurementRenderedSeconds } = readAgentResourceLimits();
    const initialRanges = new Map(
        input.initialReads.map((read) => [JSON.stringify([read.range.startBeat, read.range.endBeat]), read.range])
    );
    for (const measuredRange of initialRanges.values()) {
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
    const batchGoals = new Map<string, { pairs: readonly VibeBatchPair[]; goals: readonly MetricGoal[] }>();
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
        batchGoals.set(batch.id, { pairs: recipeGoals.pairs, goals });
    }
    const workInput = { batches: input.batches, initialReads: input.initialReads, context: input.context, batchGoals };
    const work = readRunWork(workInput);
    const budgets: Budget[] = [
        { category: 'maxRenderJobs', field: 'renders', remaining: readRemaining(input.budgets, 'maxRenderJobs') },
        { category: 'localAnalysis', field: 'analyses', remaining: readRemaining(input.budgets, 'localAnalysis') },
        {
            category: 'applicationToolReceipts',
            field: 'receipts',
            remaining: MAX_PLAN_APPLICATION_TOOL_RECEIPTS - input.priorReceipts,
        },
        { category: 'maxCommands', field: 'commands', remaining: readRemaining(input.budgets, 'maxCommands') },
    ];
    const exceeded = budgets.filter((budget) => work[budget.field] > budget.remaining);
    const describe: Record<Budget['category'], (needed: number, remaining: number) => string> = {
        maxRenderJobs: (needed, remaining) =>
            `initial measurements and previewing every batch need ${String(needed)} renders, more than the ${String(remaining)} this run's maxRenderJobs budget has left`,
        localAnalysis: (needed, remaining) =>
            `initial measurements and every preview need ${String(needed)} reductions, more than the ${String(remaining)} this run's localAnalysis budget has left`,
        applicationToolReceipts: (needed, remaining) =>
            `initial measurements and every preview need ${String(needed)} receipts, more than the ${String(remaining)} this run's plan has room for under its bound of ${String(MAX_PLAN_APPLICATION_TOOL_RECEIPTS)}`,
        maxCommands: (needed, remaining) =>
            `the brief and every batch need ${String(needed)} commands, more than the ${String(remaining)} this run's maxCommands budget has left`,
    };
    for (const budget of exceeded) {
        refusals.push(describe[budget.category](work[budget.field], budget.remaining));
    }
    if (exceeded.length > 0) {
        refusals.push(describeFittingFamilies(workInput, budgets));
    }
    return refusals;
}
