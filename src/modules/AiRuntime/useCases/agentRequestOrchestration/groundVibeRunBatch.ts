import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type AgentRun, type AgentRunVibeRunBatchSchedule } from '../../models/AgentRun';
import { type IntentResult } from '../../models/IntentResult';
import { type ScheduledVibeRunBatch, type VibeRunInitialEvidence } from '../../models/VibeRunPlan';
import { recordedSilenceHolds } from '../../validators/isSilentVibeRunCell';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { readVibeRunInitialReceipt } from '../../validators/readVibeRunInitialReceipt';
import { getProjectContext } from '../getProjectContext';
import { groundApplicationRecipeBatch } from '../groundApplicationRecipeBatch';
import { type MetricGoal } from '../metricGoalContractTypes';
import { objectiveMetricProjection } from '../objectiveMetricProjection';
import { compileVibeBatchMetricState } from '../vibeRun/compileVibeBatchMetricState';
import { readVibeBatchPairs } from '../vibeRun/readVibeBatchPairs';
import { readVibeBatchRecipeGoals } from '../vibeRun/readVibeBatchRecipeGoals';

import { readVibeRunBriefDrift } from './readVibeRunBriefDrift';

/** The batches after the brief, which holds position 1 of its run. */
const FIRST_BATCH_POSITION = 2;

export type GroundedVibeRunBatch =
    | {
          status: 'grounded';
          result: IntentResult;
          context: ReturnType<typeof getProjectContext>;
          revision: string;
          batch: ScheduledVibeRunBatch;
      }
    | { status: 'rejected'; reason: string };

/** A target the plan named that the project no longer lets a recipe change, refused rather than skipped. */
function readTargetRefusal(batch: ScheduledVibeRunBatch, context: ReturnType<typeof getProjectContext>): string | null {
    for (const targetId of batch.targetIds) {
        const track = context.tracks.find((candidate) => candidate.id === targetId);
        if (track === undefined) {
            return `its target ${targetId} is no longer in the project`;
        }
        if (track.frozen === true) {
            return `its target “${track.name}” is frozen`;
        }
    }
    return null;
}

function readStoredBatch(schedule: AgentRunVibeRunBatchSchedule, position: number) {
    const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
    const batch = plan?.batches[position - FIRST_BATCH_POSITION];
    if (plan === null || batch === undefined || plan.briefRevision !== schedule.briefRevision) {
        return null;
    }
    return { plan, batch };
}

function readInitialWitnessRefusal(goal: MetricGoal, initial: VibeRunInitialEvidence): string | null {
    if (goal.source.kind !== 'recipe' || goal.metricId === null || goal.range === null) {
        return null;
    }
    const source = goal.source;
    const witness = initial.witnesses.find((witness) => witness.id === goal.goalId);
    const receipt = readVibeRunInitialReceipt(
        initial.receipts.find((receipt) => receipt.callId === witness?.receiptCallId)
    );
    const entry = receipt?.data.targets.find((target) => goal.targetIds.includes(target.targetId))?.measurements[
        goal.metricId
    ];
    if (
        witness === undefined ||
        witness.recipeDigest !== source.recipeDigest ||
        witness.recipeId !== source.recipeId ||
        witness.expectationIndex !== source.expectationIndex ||
        witness.metric !== goal.metricId ||
        witness.band !== goal.band ||
        digest(witness.range) !== digest(goal.range) ||
        receipt?.revision !== initial.sourceRevision ||
        objectiveMetricProjection(goal.metricId, entry, goal.band) === null
    ) {
        return 'its initial exact-range recipe witness no longer validates';
    }
    return null;
}

/** A silent cell carries no goal, so its silence must still read from the receipt it was bound to. */
function readSilenceRefusal(batch: ScheduledVibeRunBatch, initial: VibeRunInitialEvidence): string | null {
    const receipts = initial.receipts.flatMap((receipt) => {
        const read = readVibeRunInitialReceipt(receipt);
        return read === null ? [] : [read];
    });
    for (const record of batch.silentRanges ?? []) {
        const target = batch.targets.find((candidate) => candidate.targetId === record.targetId);
        if (
            target === undefined ||
            !recordedSilenceHolds({
                record,
                expectedDeltas: target.expectedDeltas,
                receipts,
                sourceRevision: initial.sourceRevision,
            })
        ) {
            return 'its initial exact-range recipe witness no longer validates';
        }
    }
    return null;
}

function readInitialEvidenceRefusal(
    runId: string,
    batch: ScheduledVibeRunBatch,
    initial: VibeRunInitialEvidence,
    catalog: ReturnType<typeof getMixRecipeCatalog>
): string | null {
    if (initial.runId !== runId) {
        return 'its initial measurement belongs to another run';
    }
    if (catalog.version !== initial.catalogVersion) {
        return 'its recipe catalog changed since initial measurement';
    }
    const initialGoals = readVibeBatchRecipeGoals({ batch, catalog, range: initial.arrangementRange });
    if (initialGoals.status === 'refused') {
        return initialGoals.reason;
    }
    for (const goal of initialGoals.goals) {
        const refusal = readInitialWitnessRefusal(goal, initial);
        if (refusal !== null) {
            return refusal;
        }
    }
    return readSilenceRefusal(batch, initial);
}

/**
 * Grounds the vibe-run batch at `position` from the plan the run recorded, against the live project
 * and the brief the plan was read from: every recipe of every target expands with no values, under
 * one application-stated authority, and the batch is held to the request's constraints as they were
 * recorded. A changed brief, a removed or frozen target, or a recipe that no longer expands refuses
 * the batch whole; it is never adapted or shrunk to what still grounds.
 */
export function groundVibeRunBatch(
    run: AgentRun,
    schedule: AgentRunVibeRunBatchSchedule,
    position: number
): GroundedVibeRunBatch {
    const stored = readStoredBatch(schedule, position);
    if (stored === null) {
        return { status: 'rejected', reason: 'its stored plan could not be read back' };
    }
    const { plan, batch } = stored;
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const context = getProjectContext();
    const drift = readVibeRunBriefDrift(schedule, context.productionBrief?.revision ?? null);
    if (drift !== null) {
        return { status: 'rejected', reason: drift };
    }
    if (plan.schemaVersion === 1) {
        return { status: 'rejected', reason: 'its legacy plan is unmeasured; request a new measured run' };
    }
    const catalog = getMixRecipeCatalog();
    const initialRefusal = readInitialEvidenceRefusal(run.runId, batch, plan.initial, catalog);
    if (initialRefusal !== null) {
        return { status: 'rejected', reason: initialRefusal };
    }
    const targetRefusal = readTargetRefusal(batch, context);
    if (targetRefusal !== null) {
        return { status: 'rejected', reason: targetRefusal };
    }
    const [first, ...rest] = readVibeBatchPairs(batch).map((pair) => ({ ...pair, role: null }));
    if (first === undefined) {
        return { status: 'rejected', reason: 'its stored plan could not be read back' };
    }
    const grounded = groundApplicationRecipeBatch({
        origin: 'vibe-run',
        pairs: [first, ...rest],
        context,
        projectRevision: revision,
        prompt: run.request,
        recordedConstraints: schedule.recordedConstraints,
    });
    if (grounded.status === 'refused-expansion') {
        const name =
            context.tracks.find((track) => track.id === grounded.pair.targetId)?.name ?? grounded.pair.targetId;
        return {
            status: 'rejected',
            reason: `recipe ${grounded.pair.recipeId} no longer expands on “${name}”: ${grounded.reason.replace(/\.$/u, '')}`,
        };
    }
    if (grounded.status === 'rejected') {
        return { status: 'rejected', reason: grounded.reason };
    }
    if (grounded.status === 'not-compiled') {
        return { status: 'rejected', reason: 'it no longer grounds to any executable action' };
    }
    const metric = compileVibeBatchMetricState({
        batch,
        compilations: grounded.compilations,
        context,
        prompt: run.request,
        revision,
        runId: run.runId,
        creativeAuthority: grounded.creativeAuthority,
        recordedConstraints: schedule.recordedConstraints,
    });
    if (metric.status === 'refused') {
        return { status: 'rejected', reason: metric.reason };
    }
    const { interactionMode: _interactionMode, trustCeiling: _trustCeiling, ...planned } = structuredClone(schedule);
    return {
        status: 'grounded',
        context,
        revision,
        batch,
        result: {
            actions: grounded.grounded.actions,
            metricGoalState: metric.metricGoalState,
            actionCommandGraph: grounded.grounded.actionCommandGraph,
            rawText: run.request,
            // A planned batch is the application's own proposal of a change the user asked for in
            // general terms, so it always waits for its own approval, whatever the trust ceiling.
            requiresConfirmation: true,
            applicationToolReceipts: structuredClone(run.plan?.applicationToolReceipts ?? []),
            terminalMeasurementSettlement: run.plan?.terminalMeasurementSettlement,
            providerKnownTargetIds: grounded.grounded.providerKnownTargetIds,
            adoptedRecipes: grounded.adoptedRecipes,
            protectionFacts: grounded.grounded.protectionFacts,
            batchSchedule: { ...planned, position },
        },
    };
}
