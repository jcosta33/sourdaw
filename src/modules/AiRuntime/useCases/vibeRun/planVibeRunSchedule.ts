import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type AgentRunBudgets } from '../../models/AgentRun';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type IntentResult } from '../../models/IntentResult';
import { type MeasurementAdmitter } from '../../models/MeasurementBudget';
import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext, type ProjectContextProductionBrief } from '../../models/ProjectContext';
import { BRIEF_POSITION } from '../../models/VibeRunBriefPosition';
import {
    type ScheduledVibeRunBatch,
    type MeasuredScheduledVibeRunPlan,
    type VibeRunInitialWitness,
    type VibeRunSilentRange,
    type VibeRunSilentTarget,
    type VibeRunInitialBaselineRefusal,
    type VibeRunVerificationRange,
    type VibeRunExcludedTargetReason,
    type VibeRunPlan,
    type VibeRunUnplannedRole,
    type VibeRunValueChoiceTier,
} from '../../models/VibeRunPlan';
import { digestScheduledVibeRunPlan } from '../../validators/digestScheduledVibeRunPlan';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { type MeasurementUnitProgress } from '../measureProjectUnit';
import { type MetricGoal } from '../metricGoalContractTypes';
import { objectiveMetricProjection } from '../objectiveMetricProjection';
import { planWholeProjectVibeRun } from '../planWholeProjectVibeRun';
import { type readBriefMixIntent } from '../readBriefMixIntent';

import { PLAN_NO_LONGER_PLANNED } from './briefReadingRefusals';
import { collectVibeRunInitialBaselines } from './collectVibeRunInitialBaselines';
import { describeVibeRunObjective } from './describeVibeRunObjective';
import { formatVibeFigure } from './formatVibeFigure';
import { prepareVibeRunSchedule } from './prepareVibeRunSchedule';
import { readVibeMetricLabel } from './readVibeMetricLabel';
import { type readVibeRunCandidates } from './readVibeRunCandidates';
import { readVibeRunInitialGoals } from './readVibeRunInitialGoals';
import { readVibeRunValueChoiceScheduleFit } from './readVibeRunValueChoiceScheduleFit';
import { readVibeRunWholeFit } from './readVibeRunWholeFit';
import { readVibeTrackName } from './readVibeTrackName';
import { toScheduledVibeRunBatch } from './toScheduledVibeRunBatch';

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

/** The brief is one `setProductionBrief`. */
const BRIEF_COMMAND_COUNT = 1;

const PLAN_NO_LONGER_HOLDS = `No batches were scheduled after the brief: the project ${PLAN_NO_LONGER_PLANNED}.`;

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

function describeLeftOut(plan: VibeRunPlan, context: ProjectContext): string[] {
    return [
        ...plan.excludedTargets.map(
            (excluded) =>
                `Not planned: ${readVibeTrackName(context, excluded.targetId)}, because ${EXCLUSION_REASONS[excluded.reason]}.`
        ),
        ...plan.unplannedRoles.map(
            (unplanned) =>
                `No batch for the ${unplanned.role} tracks (${unplanned.targetIds.map((id) => readVibeTrackName(context, id)).join(', ')}): ${UNPLANNED_REASONS[unplanned.reason]}.`
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
                `- Batch ${String(batch.ordinal + BRIEF_POSITION)} of ${String(input.total)}: ${describeVibeRunObjective(batch)} — ${batch.targetIds.map((id) => readVibeTrackName(input.context, id)).join(', ')}`
        ),
        ...describeLeftOut(input.plan, input.context),
    ];
    for (const cell of input.batches.flatMap((batch) => batch.silentRanges ?? [])) {
        lines.push(
            `No goal for ${readVibeTrackName(input.context, cell.targetId)} over ${describeRange(input.context, cell.range)}: it is silent there.`
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
    /** Called as each initial render begins, naming its target and range group. */
    onProgress?: (progress: MeasurementUnitProgress) => void;
};
type Catalog = ReturnType<typeof getMixRecipeCatalog>;
type Collected = Extract<Awaited<ReturnType<typeof collectVibeRunInitialBaselines>>, { status: 'collected' }>;

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
                `Initial measurement on ${readVibeTrackName(input.context, targetId)}, ${section?.name ?? 'arrangement'} [${String(range.startBeat)}, ${String(range.endBeat)}]: ${readVibeMetricLabel(metricId, goal.band)} ${formatVibeFigure(projected.value, projected.unit)}, before the brief was approved.`
            );
        }
    }
    return { witnesses, lines, refusals };
}

/** Binds one silent cell to the one receipt that shows it, found exactly as a witness finds its receipt. */
function bindSilence(
    input: ScheduleInput,
    collected: Collected,
    targetId: string,
    range: VibeRunVerificationRange
): VibeRunSilentRange | string {
    const [receipt, ...others] = readExactRangeReceipts(input, collected, targetId, range);
    if (receipt === undefined || others.length > 0) {
        return `${targetId}, ${range.sectionId ?? 'arrangement'}: no single receipt shows its silence`;
    }
    return { targetId, range, receiptCallId: receipt.callId, receiptDigest: digest(receipt) };
}

/**
 * The measured plan's batches as the schedule stores them and its silent exclusions, each silent
 * cell bound to the receipt that shows it.
 */
function readMeasuredSilences(
    input: ScheduleInput,
    collected: Collected,
    plan: VibeRunPlan,
    ranges: readonly VibeRunVerificationRange[]
) {
    const refusals: string[] = [];
    const bind = (targetId: string, range: VibeRunVerificationRange): VibeRunSilentRange[] => {
        const bound = bindSilence(input, collected, targetId, range);
        if (typeof bound === 'string') {
            refusals.push(bound);
            return [];
        }
        return [bound];
    };
    const batches = plan.batches.map((batch): ScheduledVibeRunBatch => {
        const silentRanges = batch.silentRanges.flatMap((cell) => bind(cell.targetId, cell.range));
        const scheduled = { ...toScheduledVibeRunBatch(batch), verificationRanges: ranges };
        if (silentRanges.length === 0) {
            return scheduled;
        }
        return { ...scheduled, silentRanges };
    });
    const silentTargets = plan.silentTargets.map((target): VibeRunSilentTarget => ({
        targetId: target.targetId,
        metrics: [...target.metrics],
        silences: ranges.flatMap((range) => bind(target.targetId, range)),
    }));
    return { batches, silentTargets, refusals };
}

function buildMeasuredPlan(input: {
    source: ScheduleInput;
    candidate: ReturnType<typeof readVibeRunCandidates>;
    catalog: Catalog;
    batches: readonly ScheduledVibeRunBatch[];
    arrangementRange: VibeRunVerificationRange;
    collected: Collected;
    witnesses: readonly VibeRunInitialWitness[];
    silentTargets: readonly VibeRunSilentTarget[];
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
    const silentEvidence: { silentTargets?: readonly VibeRunSilentTarget[] } = {};
    if (input.silentTargets.length > 0) {
        silentEvidence.silentTargets = input.silentTargets;
    }
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
        ...silentEvidence,
    };
    const initialDigest = digest(initial);
    return {
        schemaVersion: 2,
        briefRevision: source.brief.revision,
        batches,
        initial,
        initialDigest,
        planDigest: digestScheduledVibeRunPlan({ briefRevision: source.brief.revision, batches, initialDigest }),
    };
}

/** The tier is decided after the plan is built, so the plan digest is taken again with it bound. */
function withValueChoiceTier(
    plan: MeasuredScheduledVibeRunPlan,
    valueChoiceTier: VibeRunValueChoiceTier
): MeasuredScheduledVibeRunPlan {
    return {
        ...plan,
        valueChoiceTier,
        planDigest: digestScheduledVibeRunPlan({
            briefRevision: plan.briefRevision,
            batches: plan.batches,
            initialDigest: plan.initialDigest,
            valueChoiceTier,
        }),
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
    candidate: ReturnType<typeof readVibeRunCandidates>;
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
    const measured = readMeasuredSilences(input.source, input.collected, measuredPlan, input.ranges);
    const goals = readVibeRunInitialGoals(measured.batches, input.catalog, input.arrangementRange);
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
        silentTargets: measured.silentTargets,
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
    const valueChoice = readVibeRunValueChoiceScheduleFit(input.source, plan, input.catalog);
    if (valueChoice.status === 'refused') {
        return {
            status: 'unscheduled',
            lines: [`No batches were scheduled after the brief: ${valueChoice.reason}.`],
            receipts: input.collected.receipts,
        };
    }
    const schedule = buildSchedule(withValueChoiceTier(plan, valueChoice.tier), input.reading);
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
            ...valueChoice.lines,
            ...evidence.lines,
            ...input.collected.receipts.flatMap((receipt) => receipt.warnings),
            'Initial figures are historical and do not authorize a batch.',
        ],
    };
}

/** Preparation, sequential collection, then complete measured decomposition. */
async function planSchedule(
    input: ScheduleInput,
    expectedPlanDigest: string | undefined
): Promise<PlannedVibeRunSchedule> {
    const prepared = prepareVibeRunSchedule(input);
    if (prepared.status === 'none' && expectedPlanDigest !== undefined) {
        return { status: 'unscheduled', lines: [PLAN_NO_LONGER_HOLDS] };
    }
    if (prepared.status !== 'prepared') {
        return prepared;
    }
    if (expectedPlanDigest !== undefined && expectedPlanDigest !== prepared.planDigest) {
        return {
            status: 'unscheduled',
            lines: [PLAN_NO_LONGER_HOLDS],
        };
    }
    const { batches, reading, catalog, candidate, ranges, arrangementRange } = prepared;
    const collected = await collectVibeRunInitialBaselines({
        runId: input.runId,
        sourceRevision: input.sourceRevision,
        context: input.context,
        signal: input.signal,
        admit: input.admit,
        priorReceipts: input.priorReceipts,
        requests: prepared.initialRequests,
        onProgress: input.onProgress,
    });
    if (collected.status === 'refused') {
        return {
            status: 'unscheduled',
            lines: [`No batches were scheduled after the brief: ${collected.reason}.`],
            receipts: collected.receipts,
        };
    }
    const remainingRefusals = readVibeRunWholeFit(input, batches, reading, []);
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
export async function planVibeRunSchedule(
    input: ScheduleInput & {
        /** The plan the caller was shown; a prepared plan with another digest is refused before anything is measured. */
        expectedPlanDigest?: string;
    }
): Promise<PlannedVibeRunSchedule> {
    const planned = await planSchedule(input, input.expectedPlanDigest);
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
