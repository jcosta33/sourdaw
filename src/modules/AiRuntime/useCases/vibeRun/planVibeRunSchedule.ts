import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { readSecondsAtBeat } from '#/modules/Transport/stores';

import { type AgentRunBudgets } from '../../models/AgentRun';
import { ANALYSIS_MEASURE_MAX_TARGETS } from '../../models/AnalysisMeasureLimits';
import { type IntentResult } from '../../models/IntentResult';
import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext, type ProjectContextProductionBrief } from '../../models/ProjectContext';
import {
    type ScheduledVibeRunBatch,
    type ScheduledVibeRunPlan,
    type VibeRunExcludedTargetReason,
    type VibeRunPlan,
    type VibeRunUnplannedRole,
} from '../../models/VibeRunPlan';
import { readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { CANONICAL_ROLE_OPTIONS } from '../canonicalRoleFamilies';
import { hasContradictoryMetricGoals } from '../hasContradictoryMetricGoals';
import { type MetricGoal } from '../metricGoalContractTypes';
import { compilePerceptualConstraints } from '../perceptualConstraints/compilePerceptualConstraints';
import { readPerceptualConstraintGoals } from '../perceptualConstraints/readPerceptualConstraintGoals';
import { planWholeProjectVibeRun } from '../planWholeProjectVibeRun';
import { readArrangementRange } from '../readArrangementRange';
import { type readBriefMixIntent } from '../readBriefMixIntent';
import { readMeasurementRenderedSeconds } from '../readMeasurementRenderedSeconds';

import { describeVibeRunObjective } from './describeVibeRunObjective';
import { type VibeBatchPair } from './readVibeBatchPairs';
import { readVibeBatchRecipeGoals } from './readVibeBatchRecipeGoals';

type VibeRunSchedule = Extract<NonNullable<IntentResult['batchSchedule']>, { kind: 'vibe-run' }>;

export type PlannedVibeRunSchedule =
    | { status: 'none' }
    | { status: 'unscheduled'; lines: string[] }
    | { status: 'scheduled'; schedule: VibeRunSchedule; lines: string[] };

/** The position the brief holds in its run; every planned batch follows it. */
const BRIEF_POSITION = 1;
/** The brief is one `setProductionBrief`. */
const BRIEF_COMMAND_COUNT = 1;

const EXCLUSION_REASONS: Readonly<Record<VibeRunExcludedTargetReason, string>> = {
    protected: 'the brief protects it',
    folder: 'it is a folder',
    frozen: 'it is frozen',
    'unclassified-role': 'it has no role a recipe serves',
    'no-applicable-recipe': 'no requested recipe applies to it',
};

const UNPLANNED_REASONS: Readonly<Record<VibeRunUnplannedRole['reason'], string>> = {
    'no-expected-deltas': 'no requested character has a measurable recipe for them',
    'target-exceeds-batch-cap': 'their recipes alone expand past one batch',
};

/**
 * The roles the confirmed brief states, read onto every track that had none, exactly as the project
 * context reads an authored role: one supported role, or `unknown` beside a conflicting or unsupported
 * one. A role the project already gives is never replaced, as the brief itself never replaces one.
 */
function withBriefTrackRoles(
    tracks: ProjectContext['tracks'],
    brief: ProjectContextProductionBrief
): ProjectContext['tracks'] {
    return tracks.map((track) => {
        if (track.canonicalRole?.source === 'authored') {
            return track;
        }
        const roles = brief.trackRoles.filter((entry) => entry.trackId === track.id).map((entry) => entry.role);
        if (roles.length === 0) {
            return track;
        }
        const supported = roles.every((role) => CANONICAL_ROLE_OPTIONS.some((option) => option === role));
        if (!supported) {
            return {
                ...track,
                canonicalRole: { role: 'unknown', source: 'authored', evidence: 'unsupported-authored-role' },
            };
        }
        if (new Set(roles).size !== 1) {
            return {
                ...track,
                canonicalRole: { role: 'unknown', source: 'authored', evidence: 'conflicting-authored-roles' },
            };
        }
        return {
            ...track,
            canonicalRole: { role: roles[0] ?? 'unknown', source: 'authored', evidence: 'authored-role' },
        };
    });
}

function toScheduledBatch(batch: VibeRunPlan['batches'][number]): ScheduledVibeRunBatch {
    return {
        id: batch.id,
        ordinal: batch.ordinal,
        objective: { descriptors: [...batch.objective.descriptors], role: batch.objective.role },
        targetIds: [...batch.targetIds],
        targets: structuredClone(batch.targets),
        commandCount: batch.commandCount,
    };
}

/**
 * The renders a batch's measured preview runs, counted the way the preview reads its goals: each
 * goal's targets at its step's after and before prefixes and at the whole batch, every hold at the
 * whole batch, each subject once per prefix and rendered twice there (the project and the preview).
 */
function countPreviewRenders(pairs: readonly VibeBatchPair[], goals: readonly MetricGoal[]): number {
    const subjectsByPrefix = new Map<number, Set<string>>();
    const read = (prefix: number, targetIds: readonly string[]) => {
        const subjects = subjectsByPrefix.get(prefix) ?? new Set<string>();
        for (const targetId of targetIds) {
            subjects.add(targetId);
        }
        subjectsByPrefix.set(prefix, subjects);
    };
    for (const goal of goals) {
        if (goal.metricId === null || goal.range === null) {
            continue;
        }
        const step = pairs.findIndex((pair) => pair.stepId === goal.stepId) + 1;
        if (step > 0) {
            read(step, goal.targetIds);
            if (step > 1) {
                read(step - 1, goal.targetIds);
            }
        }
        read(pairs.length, goal.targetIds);
    }
    return [...subjectsByPrefix.values()].reduce((total, subjects) => total + subjects.size * 2, 0);
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
function readFitRefusals(input: {
    batches: readonly ScheduledVibeRunBatch[];
    context: ProjectContext;
    reading: PerceptualConstraintReading;
    budgets: AgentRunBudgets;
}): string[] {
    const range = readArrangementRange(input.context);
    if (range === null) {
        return ['the arrangement holds no audio to measure each batch against'];
    }
    const refusals: string[] = [];
    const { measurementMeasuredSeconds, measurementRenderedSeconds } = readAgentResourceLimits();
    const measuredSeconds = readSecondsAtBeat({ beat: range.endBeat }) - readSecondsAtBeat({ beat: range.startBeat });
    const renderedSeconds = readMeasurementRenderedSeconds(range.endBeat);
    if (measuredSeconds > measurementMeasuredSeconds || renderedSeconds > measurementRenderedSeconds) {
        refusals.push(
            `each batch is measured over the whole arrangement, and a measurement covers at most ${String(measurementMeasuredSeconds)} s and ends within ${String(measurementRenderedSeconds)} s of the project start`
        );
    }
    const catalog = getMixRecipeCatalog();
    const holds = readPerceptualConstraintGoals(input.reading, input.context);
    let renders = 0;
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
        renders += countPreviewRenders(recipeGoals.pairs, goals);
    }
    const renderBudget = readRemaining(input.budgets, 'maxRenderJobs');
    if (renders > renderBudget) {
        refusals.push(
            `previewing every batch needs ${String(renders)} renders, more than the ${String(renderBudget)} this run's maxRenderJobs budget has left`
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

function trackName(context: ProjectContext, trackId: string): string {
    return context.tracks.find((track) => track.id === trackId)?.name ?? trackId;
}

function describePlannedRun(input: {
    plan: VibeRunPlan;
    batches: readonly ScheduledVibeRunBatch[];
    context: ProjectContext;
    total: number;
}): string[] {
    const lines = [
        `After the brief, ${String(input.batches.length)} ${input.batches.length === 1 ? 'batch follows' : 'batches follow'}, each measured, previewed and approved on its own:`,
        ...input.batches.map(
            (batch) =>
                `- Batch ${String(batch.ordinal + BRIEF_POSITION)} of ${String(input.total)}: ${describeVibeRunObjective(batch)} — ${batch.targetIds.map((id) => trackName(input.context, id)).join(', ')}`
        ),
    ];
    for (const excluded of input.plan.excludedTargets) {
        lines.push(
            `Not planned: ${trackName(input.context, excluded.targetId)}, because ${EXCLUSION_REASONS[excluded.reason]}.`
        );
    }
    for (const unplanned of input.plan.unplannedRoles) {
        const names = unplanned.targetIds.map((id) => trackName(input.context, id)).join(', ');
        lines.push(`No batch for the ${unplanned.role} tracks (${names}): ${UNPLANNED_REASONS[unplanned.reason]}.`);
    }
    return lines;
}

/**
 * Plans the run of recipe batches a whole-project request asks for, from the brief the user is about
 * to confirm and the project as it is now, asking no provider. The characters are the validated selection from the brief compilation, the recipes the authored ones, and the batches hold at most as many targets as one
 * measurement reads. A request naming no character, or one whose plan holds no batch, is the brief
 * alone. A plan that does not fit its run is not scheduled, and the card says why.
 */
export function planVibeRunSchedule(input: {
    prompt: string;
    context: ProjectContext;
    brief: ProjectContextProductionBrief;
    budgets: AgentRunBudgets;
    mixIntent: NonNullable<ReturnType<typeof readBriefMixIntent>>;
}): PlannedVibeRunSchedule {
    const catalog = getMixRecipeCatalog();
    const reading = compilePerceptualConstraints(input.prompt, input.context);
    const descriptors = input.mixIntent.requestedDescriptors;
    if (descriptors.length === 0) {
        return { status: 'none' };
    }
    const plan = planWholeProjectVibeRun({
        context: {
            tracks: withBriefTrackRoles(input.context.tracks, input.brief),
            sections: input.context.sections,
            productionBrief: input.brief,
        },
        descriptors,
        recipes: catalog.recipes.filter((recipe) => recipe.origin === undefined),
        measurements: [],
        maxTargetsPerBatch: ANALYSIS_MEASURE_MAX_TARGETS,
    });
    if (plan.batches.length === 0) {
        return { status: 'none' };
    }
    const batches = plan.batches.map(toScheduledBatch);
    const refusals = readFitRefusals({ batches, context: input.context, reading, budgets: input.budgets });
    if (refusals.length > 0) {
        return {
            status: 'unscheduled',
            lines: [`No batches were scheduled after the brief: ${refusals.join('; ')}.`],
        };
    }
    const total = batches.length + BRIEF_POSITION;
    const scheduledPlan: ScheduledVibeRunPlan = { schemaVersion: 1, briefRevision: input.brief.revision, batches };
    return {
        status: 'scheduled',
        lines: describePlannedRun({ plan, batches, context: input.context, total }),
        schedule: {
            schemaVersion: 1,
            kind: 'vibe-run',
            scheduleId: `batch-schedule-${crypto.randomUUID()}`,
            position: BRIEF_POSITION,
            total,
            totalCommands: BRIEF_COMMAND_COUNT + batches.reduce((sum, batch) => sum + batch.commandCount, 0),
            serializedProviderProposal: null,
            serializedPlan: JSON.stringify(scheduledPlan),
            briefRevision: input.brief.revision,
            recordedConstraints: reading,
            slices: [
                {
                    position: BRIEF_POSITION,
                    commandCount: BRIEF_COMMAND_COUNT,
                    targetIds: [],
                    serializedSlice: 'production-brief',
                },
                ...batches.map((batch) => ({
                    position: batch.ordinal + BRIEF_POSITION,
                    commandCount: batch.commandCount,
                    targetIds: [...batch.targetIds],
                    serializedSlice: batch.id,
                })),
            ],
        },
    };
}
