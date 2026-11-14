import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type AgentRun, type AgentRunVibeRunBatchSchedule } from '../../models/AgentRun';
import { type ScheduledVibeRunBatch, type VibeRunInitialEvidence } from '../../models/VibeRunPlan';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { readVibeRunInitialReceipt } from '../../validators/readVibeRunInitialReceipt';
import { getProjectContext } from '../getProjectContext';
import { type MetricGoal } from '../metricGoalContractTypes';
import { objectiveMetricProjection } from '../objectiveMetricProjection';
import { readVibeBatchRecipeGoals } from '../vibeRun/readVibeBatchRecipeGoals';

import { readVibeRunBriefDrift } from './readVibeRunBriefDrift';

/** The batches after the brief, which holds position 1 of its run. */
const FIRST_BATCH_POSITION = 2;

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
    return null;
}

export type VibeRunBatchPreflight =
    | {
          status: 'admitted';
          batch: ScheduledVibeRunBatch;
          initial: VibeRunInitialEvidence;
          catalog: ReturnType<typeof getMixRecipeCatalog>;
          context: ReturnType<typeof getProjectContext>;
          revision: string;
      }
    | { status: 'rejected'; reason: string };

/**
 * Every guard a stored vibe batch must pass before anything is asked or expanded for it, at the live
 * revision: its stored plan reads back, the brief is the planned revision, the plan is measured, its
 * initial evidence still validates, and no target was removed or frozen. It expands nothing and asks
 * no provider, so a batch it refuses is refused before any value request is made.
 */
export function preflightVibeRunBatch(
    run: AgentRun,
    schedule: AgentRunVibeRunBatchSchedule,
    position: number
): VibeRunBatchPreflight {
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
    return { status: 'admitted', batch, initial: plan.initial, catalog, context, revision };
}
