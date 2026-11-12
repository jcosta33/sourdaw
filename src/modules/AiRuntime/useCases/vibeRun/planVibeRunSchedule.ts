import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type AgentRunBudgets } from '../../models/AgentRun';
import { ANALYSIS_MEASURE_MAX_TARGETS } from '../../models/AnalysisMeasureLimits';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type IntentResult } from '../../models/IntentResult';
import { type MeasurementAdmitter } from '../../models/MeasurementBudget';
import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext, type ProjectContextProductionBrief } from '../../models/ProjectContext';
import {
    type ScheduledVibeRunBatch,
    type MeasuredScheduledVibeRunPlan,
    type VibeRunInitialWitness,
    type VibeRunSilentRange,
    type VibeRunInitialBaselineRefusal,
    type VibeRunVerificationRange,
    type VibeRunExcludedTargetReason,
    type VibeRunPlan,
    type VibeRunUnplannedRole,
} from '../../models/VibeRunPlan';
import { readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { readExplicitProtections } from '../agentReference/readExplicitProtections';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { CANONICAL_ROLE_OPTIONS } from '../canonicalRoleFamilies';
import { type MetricGoal } from '../metricGoalContractTypes';
import { objectiveMetricProjection } from '../objectiveMetricProjection';
import { compilePerceptualConstraints } from '../perceptualConstraints/compilePerceptualConstraints';
import { planMetricMeasurementRequests } from '../planMetricMeasurementRequests';
import { planWholeProjectVibeRun } from '../planWholeProjectVibeRun';
import { readArrangementRange } from '../readArrangementRange';
import { type readBriefMixIntent } from '../readBriefMixIntent';

import { collectVibeRunInitialBaselines } from './collectVibeRunInitialBaselines';
import { describeVibeRunObjective } from './describeVibeRunObjective';
import { formatVibeFigure } from './formatVibeFigure';
import { readVibeBatchRecipeGoals } from './readVibeBatchRecipeGoals';
import { readVibeMetricLabel } from './readVibeMetricLabel';
import { readVibeRunFitRefusals } from './readVibeRunFitRefusals';

type VibeRunSchedule = Extract<NonNullable<IntentResult['batchSchedule']>, { kind: 'vibe-run' }>;

export type PlannedVibeRunSchedule =
    | { status: 'none' }
    | {
          status: 'unscheduled';
          lines: string[];
          receipts?: ApplicationToolReceipt[];
          refusal?: VibeRunInitialBaselineRefusal;
      }
    | { status: 'scheduled'; schedule: VibeRunSchedule; lines: string[]; receipts: ApplicationToolReceipt[] };

/** The position the brief holds in its run; every planned batch follows it. */
const BRIEF_POSITION = 1;
/** The brief is one `setProductionBrief`. */
const BRIEF_COMMAND_COUNT = 1;

const EXCLUSION_REASONS: Readonly<Record<VibeRunExcludedTargetReason, string>> = {
    protected: 'the request or brief protects it',
    folder: 'it is a folder',
    frozen: 'it is frozen',
    'unclassified-role': 'it has no role a recipe serves',
    'no-applicable-recipe': 'no requested recipe applies to it',
    silent: 'it is silent in every measured range',
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
        objective: structuredClone(batch.objective),
        targetIds: [...batch.targetIds],
        targets: structuredClone(batch.targets),
        commandCount: batch.commandCount,
    };
}

function trackName(context: ProjectContext, trackId: string): string {
    return context.tracks.find((track) => track.id === trackId)?.name ?? trackId;
}

function describeLeftOut(plan: VibeRunPlan, context: ProjectContext): string[] {
    return [
        ...plan.excludedTargets.map(
            (excluded) =>
                `Not planned: ${trackName(context, excluded.targetId)}, because ${EXCLUSION_REASONS[excluded.reason]}.`
        ),
        ...plan.unplannedRoles.map(
            (unplanned) =>
                `No batch for the ${unplanned.role} tracks (${unplanned.targetIds.map((id) => trackName(context, id)).join(', ')}): ${UNPLANNED_REASONS[unplanned.reason]}.`
        ),
    ];
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
        ...describeLeftOut(input.plan, input.context),
    ];
    for (const cell of input.batches.flatMap((batch) => batch.silentRanges ?? [])) {
        lines.push(
            `No goal for ${trackName(input.context, cell.targetId)} over ${describeRange(input.context, cell.range)}: it is silent there.`
        );
    }
    return lines;
}

function describeRange(context: ProjectContext, range: VibeRunVerificationRange): string {
    const section = context.sections?.find((candidate) => candidate.id === range.sectionId);
    return `${section?.name ?? 'the arrangement'} [${String(range.startBeat)}, ${String(range.endBeat)}]`;
}

type ScheduleInput = {
    prompt: string;
    context: ProjectContext;
    brief: ProjectContextProductionBrief;
    budgets: AgentRunBudgets;
    mixIntent: NonNullable<ReturnType<typeof readBriefMixIntent>>;
    runId: string;
    sourceRevision: string;
    signal: AbortSignal;
    admit: MeasurementAdmitter;
    priorReceipts: readonly ApplicationToolReceipt[];
};
type Catalog = ReturnType<typeof getMixRecipeCatalog>;
type Collected = Extract<Awaited<ReturnType<typeof collectVibeRunInitialBaselines>>, { status: 'collected' }>;

function readCandidates(input: ScheduleInput, catalog: Catalog, protectedTargetIds: readonly string[]) {
    const tracks = withBriefTrackRoles(input.context.tracks, input.brief);
    const plannerInput = {
        context: { tracks, sections: input.context.sections, productionBrief: input.brief },
        descriptors: input.mixIntent.requestedDescriptors,
        recipes: catalog.recipes.filter((recipe) => recipe.origin === undefined),
        maxTargetsPerBatch: ANALYSIS_MEASURE_MAX_TARGETS,
        protectedTargetIds,
    };
    return { tracks, plannerInput, plan: planWholeProjectVibeRun({ ...plannerInput, measurements: [] }) };
}

function validSections(context: ProjectContext): boolean {
    const sections = context.sections ?? [];
    return (
        new Set(sections.map((section) => section.id)).size === sections.length &&
        sections.every(
            (section) =>
                Number.isFinite(section.startBeat) &&
                Number.isFinite(section.endBeat) &&
                section.startBeat >= 0 &&
                section.endBeat > section.startBeat
        )
    );
}

function readInitialGoals(
    batches: readonly ScheduledVibeRunBatch[],
    catalog: Catalog,
    range: VibeRunVerificationRange
) {
    const goals: MetricGoal[] = [];
    for (const batch of batches) {
        const read = readVibeBatchRecipeGoals({ batch, catalog, range });
        if (read.status === 'refused') {
            return read;
        }
        goals.push(...read.goals);
    }
    return { status: 'read' as const, goals };
}

/** The admitted initial receipts of the source revision that measured one target over exactly one range. */
function readExactRangeReceipts(
    input: ScheduleInput,
    collected: Collected,
    targetId: string,
    range: VibeRunVerificationRange
): Collected['measurements'] {
    return collected.measurements.filter(
        (receipt) =>
            receipt.revision === input.sourceRevision &&
            receipt.data.range.sectionId === range.sectionId &&
            receipt.data.range.startBeat === range.startBeat &&
            receipt.data.range.endBeat === range.endBeat &&
            receipt.data.targets.some((target) => target.targetId === targetId)
    );
}

function readInitialWitnesses(input: ScheduleInput, collected: Collected, goals: readonly MetricGoal[]) {
    const witnesses: VibeRunInitialWitness[] = [];
    const lines: string[] = [];
    const refusals: string[] = [];
    for (const goal of goals) {
        const { metricId, range, source } = goal;
        if (metricId === null || range === null || source.kind !== 'recipe') {
            continue;
        }
        for (const targetId of goal.targetIds) {
            const candidates = readExactRangeReceipts(input, collected, targetId, range);
            const receipt = candidates.length === 1 ? candidates[0] : undefined;
            const entry = receipt?.data.targets.find((target) => target.targetId === targetId)?.measurements[metricId];
            const projected = objectiveMetricProjection(metricId, entry, goal.band);
            if (receipt === undefined || projected === null) {
                refusals.push(
                    `${targetId}, ${range.sectionId ?? 'arrangement'} [${String(range.startBeat)}, ${String(range.endBeat)}], ${metricId}${goal.band === null ? '' : `/${goal.band}`}: missing, ambiguous or unsupported initial metric`
                );
                continue;
            }
            witnesses.push({
                id: goal.goalId,
                receiptCallId: receipt.callId,
                receiptDigest: digest(receipt),
                targetId,
                recipeId: source.recipeId,
                recipeDigest: source.recipeDigest,
                expectationIndex: source.expectationIndex,
                metric: metricId,
                band: goal.band,
                range,
            });
            const section = input.context.sections?.find((section) => section.id === range.sectionId);
            lines.push(
                `Initial measurement on ${trackName(input.context, targetId)}, ${section?.name ?? 'arrangement'} [${String(range.startBeat)}, ${String(range.endBeat)}]: ${readVibeMetricLabel(metricId, goal.band)} ${formatVibeFigure(projected.value, projected.unit)}, before the brief was approved.`
            );
        }
    }
    return { witnesses, lines, refusals };
}

/**
 * The measured plan's batches as the schedule stores them, each silent cell bound to the one receipt
 * that shows it, found exactly as a witness finds its receipt.
 */
function readMeasuredBatches(
    input: ScheduleInput,
    collected: Collected,
    plan: VibeRunPlan,
    ranges: readonly VibeRunVerificationRange[]
) {
    const refusals: string[] = [];
    const batches = plan.batches.map((batch): ScheduledVibeRunBatch => {
        const silentRanges: VibeRunSilentRange[] = [];
        for (const cell of batch.silentRanges) {
            const [receipt, ...others] = readExactRangeReceipts(input, collected, cell.targetId, cell.range);
            if (receipt === undefined || others.length > 0) {
                refusals.push(
                    `${cell.targetId}, ${cell.range.sectionId ?? 'arrangement'}: no single receipt shows its silence`
                );
                continue;
            }
            silentRanges.push({
                targetId: cell.targetId,
                range: cell.range,
                receiptCallId: receipt.callId,
                receiptDigest: digest(receipt),
            });
        }
        const scheduled = { ...toScheduledBatch(batch), verificationRanges: ranges };
        return silentRanges.length === 0 ? scheduled : { ...scheduled, silentRanges };
    });
    return { batches, refusals };
}

function buildMeasuredPlan(input: {
    source: ScheduleInput;
    candidate: ReturnType<typeof readCandidates>;
    catalog: Catalog;
    batches: readonly ScheduledVibeRunBatch[];
    arrangementRange: VibeRunVerificationRange;
    collected: Collected;
    witnesses: readonly VibeRunInitialWitness[];
    silentTargetIds: readonly string[];
}): MeasuredScheduledVibeRunPlan {
    const { source, candidate, witnesses } = input;
    const batches = input.batches.map((batch) => ({
        ...batch,
        witnessIds: witnesses
            .filter(
                (witness) =>
                    batch.targetIds.includes(witness.targetId) &&
                    batch.targets.some(
                        (target) => target.targetId === witness.targetId && target.recipeIds.includes(witness.recipeId)
                    )
            )
            .map((witness) => witness.id),
    }));
    const initial: MeasuredScheduledVibeRunPlan['initial'] = {
        origin: 'vibe-run-initial-baselines',
        sourceRevision: source.sourceRevision,
        sourceRevisionDigest: digest(source.sourceRevision),
        projectId: captureProjectIdentity(),
        runId: source.runId,
        briefId: source.brief.id,
        briefDigest: digest(source.brief),
        mixIntentDigest: digest(source.mixIntent),
        catalogVersion: input.catalog.version,
        roles: candidate.tracks
            .filter((track) => batches.some((batch) => batch.targetIds.includes(track.id)))
            .flatMap((track) =>
                track.canonicalRole === undefined ? [] : [{ targetId: track.id, canonicalRole: track.canonicalRole }]
            ),
        sections: candidate.plan.batches[0]?.objective.sections ?? [],
        arrangementRange: input.arrangementRange,
        receipts: input.collected.receipts,
        witnesses,
        ...(input.silentTargetIds.length === 0 ? {} : { silentTargetIds: input.silentTargetIds }),
    };
    const initialDigest = digest(initial);
    return {
        schemaVersion: 2,
        briefRevision: source.brief.revision,
        batches,
        initial,
        initialDigest,
        planDigest: digest({ briefRevision: source.brief.revision, batches, initialDigest }),
    };
}

function buildSchedule(plan: MeasuredScheduledVibeRunPlan, reading: PerceptualConstraintReading): VibeRunSchedule {
    return {
        schemaVersion: 1,
        kind: 'vibe-run',
        scheduleId: `batch-schedule-${crypto.randomUUID()}`,
        position: BRIEF_POSITION,
        total: plan.batches.length + BRIEF_POSITION,
        totalCommands: BRIEF_COMMAND_COUNT + plan.batches.reduce((sum, batch) => sum + batch.commandCount, 0),
        serializedProviderProposal: null,
        serializedPlan: JSON.stringify(plan),
        briefRevision: plan.briefRevision,
        recordedConstraints: reading,
        slices: [
            {
                position: BRIEF_POSITION,
                commandCount: BRIEF_COMMAND_COUNT,
                targetIds: [],
                serializedSlice: 'production-brief',
            },
            ...plan.batches.map((batch) => ({
                position: batch.ordinal + BRIEF_POSITION,
                commandCount: batch.commandCount,
                targetIds: [...batch.targetIds],
                serializedSlice: batch.id,
            })),
        ],
    };
}

function completeMeasuredSchedule(input: {
    source: ScheduleInput;
    candidate: ReturnType<typeof readCandidates>;
    catalog: Catalog;
    ranges: readonly VibeRunVerificationRange[];
    arrangementRange: VibeRunVerificationRange;
    reading: PerceptualConstraintReading;
    collected: Collected;
}): PlannedVibeRunSchedule {
    const measuredPlan = planWholeProjectVibeRun({
        ...input.candidate.plannerInput,
        measurements: input.collected.measurements.map((receipt) => receipt.data),
        requiredRanges: input.ranges,
    });
    if (measuredPlan.batches.length === 0) {
        return {
            status: 'unscheduled',
            lines: [
                'No batches were scheduled after the brief: every planned track is silent in every measured range.',
                ...describeLeftOut(measuredPlan, input.source.context),
            ],
            receipts: input.collected.receipts,
        };
    }
    const measured = readMeasuredBatches(input.source, input.collected, measuredPlan, input.ranges);
    const goals = readInitialGoals(measured.batches, input.catalog, input.arrangementRange);
    if (goals.status === 'refused') {
        return {
            status: 'unscheduled',
            lines: [`No batches were scheduled after the brief: ${goals.reason}.`],
            receipts: input.collected.receipts,
        };
    }
    const evidence = readInitialWitnesses(input.source, input.collected, goals.goals);
    const refusals = [
        ...measured.refusals,
        ...evidence.refusals,
        ...measuredPlan.coverageRefusals.map(
            (cell) =>
                `${cell.targetId}/${cell.role}, ${cell.range.sectionId ?? 'arrangement'}, ${cell.metric}: ${cell.reason}`
        ),
    ];
    if (refusals.length > 0) {
        return {
            status: 'unscheduled',
            lines: [`No batches were scheduled after the brief: ${refusals.join('; ')}.`],
            receipts: input.collected.receipts,
        };
    }
    const plan = buildMeasuredPlan({
        ...input,
        batches: measured.batches,
        witnesses: evidence.witnesses,
        silentTargetIds: measuredPlan.excludedTargets
            .filter((excluded) => excluded.reason === 'silent')
            .map((excluded) => excluded.targetId),
    });
    if (readScheduledVibeRunPlan(JSON.stringify(plan)) === null) {
        return {
            status: 'unscheduled',
            lines: [
                'No batches were scheduled after the brief: the complete measured plan exceeds its persistence bounds or cannot be read back.',
            ],
            receipts: input.collected.receipts,
        };
    }
    const schedule = buildSchedule(plan, input.reading);
    return {
        status: 'scheduled',
        receipts: input.collected.receipts,
        schedule,
        lines: [
            ...describePlannedRun({
                plan: measuredPlan,
                batches: plan.batches,
                context: input.source.context,
                total: schedule.total,
            }),
            ...evidence.lines,
            ...input.collected.receipts.flatMap((receipt) => receipt.warnings),
            'Initial figures are historical and do not authorize a batch.',
        ],
    };
}

function readWholeRunFit(
    input: ScheduleInput,
    batches: readonly ScheduledVibeRunBatch[],
    reading: PerceptualConstraintReading,
    initialRequests: ReturnType<typeof planMetricMeasurementRequests>
): string[] {
    const run = agentRunLifecycle.get(input.runId);
    if (run === null) {
        return ['this run no longer exists'];
    }
    const refusals = readVibeRunFitRefusals({
        batches,
        context: input.context,
        reading,
        budgets: run.budgets,
        initialRequests,
    });
    if (run.activeSince !== null && Date.now() - run.activeSince > readAgentResourceLimits().runDurationMs) {
        refusals.push('runDurationMs: this run has no active time left');
    }
    return refusals;
}

/** Inventory, whole-run preflight, sequential collection, then complete measured decomposition. */
async function planSchedule(input: ScheduleInput): Promise<PlannedVibeRunSchedule> {
    const catalog = getMixRecipeCatalog();
    if (input.mixIntent.requestedDescriptors.length === 0) {
        return { status: 'none' };
    }
    if (!validSections(input.context)) {
        return {
            status: 'unscheduled',
            lines: [
                'No batches were scheduled after the brief: the section map has invalid bounds or duplicate identities.',
            ],
        };
    }
    const protections = readExplicitProtections(input.prompt, input.context);
    if (protections.unresolved.length > 0) {
        return {
            status: 'unscheduled',
            lines: [
                `No batches were scheduled after the brief: unresolved original-request protection: ${protections.unresolved.join(', ')}.`,
            ],
        };
    }
    const candidate = readCandidates(input, catalog, protections.protectedTrackIds);
    if (candidate.plan.batches.length === 0) {
        return { status: 'none' };
    }
    const arrangementRange = readArrangementRange(input.context);
    if (arrangementRange === null) {
        return {
            status: 'unscheduled',
            lines: ['No batches were scheduled after the brief: the arrangement holds no audio to measure.'],
        };
    }
    const ranges = [
        arrangementRange,
        ...(candidate.plan.batches[0]?.objective.sections ?? []).map((section) => ({
            startBeat: section.startBeat,
            endBeat: section.endBeat,
            sectionId: section.id,
        })),
    ];
    const batches = candidate.plan.batches.map((batch) => ({ ...toScheduledBatch(batch), verificationRanges: ranges }));
    const initial = readInitialGoals(batches, catalog, arrangementRange);
    if (initial.status === 'refused') {
        return { status: 'unscheduled', lines: [`No batches were scheduled after the brief: ${initial.reason}.`] };
    }
    const initialRequests = planMetricMeasurementRequests({
        context: input.context,
        reads: initial.goals.flatMap((goal) => {
            if (goal.metricId === null || goal.range === null) {
                return [];
            }
            return [{ prefix: 'initial', range: goal.range, metricId: goal.metricId, targetIds: goal.targetIds }];
        }),
    });
    const reading = compilePerceptualConstraints(input.prompt, input.context);
    const refusals = readWholeRunFit(input, batches, reading, initialRequests);
    if (refusals.length > 0) {
        return { status: 'unscheduled', lines: [`No batches were scheduled after the brief: ${refusals.join('; ')}.`] };
    }
    const collected = await collectVibeRunInitialBaselines({
        runId: input.runId,
        sourceRevision: input.sourceRevision,
        context: input.context,
        signal: input.signal,
        admit: input.admit,
        priorReceipts: input.priorReceipts,
        requests: initialRequests,
    });
    if (collected.status === 'refused') {
        return {
            status: 'unscheduled',
            lines: [`No batches were scheduled after the brief: ${collected.reason}.`],
            receipts: collected.receipts,
        };
    }
    const remainingRefusals = readWholeRunFit(input, batches, reading, []);
    if (remainingRefusals.length > 0) {
        return {
            status: 'unscheduled',
            lines: [`No batches were scheduled after the brief: ${remainingRefusals.join('; ')}.`],
            receipts: collected.receipts,
        };
    }
    return completeMeasuredSchedule({
        source: input,
        candidate,
        catalog,
        ranges,
        arrangementRange,
        reading,
        collected,
    });
}

/** Only this application path classifies its admitted initial reads as optional for the brief. */
export async function planVibeRunSchedule(input: Parameters<typeof planSchedule>[0]): Promise<PlannedVibeRunSchedule> {
    const planned = await planSchedule(input);
    if (planned.status !== 'unscheduled') {
        return planned;
    }
    const receipts = planned.receipts ?? [];
    return {
        ...planned,
        refusal: {
            schemaVersion: 1,
            sourceRevision: input.sourceRevision,
            stage: receipts.length === 0 ? 'preflight' : 'collection',
            receiptCallIds: receipts.map((receipt) => receipt.callId),
        },
    };
}
