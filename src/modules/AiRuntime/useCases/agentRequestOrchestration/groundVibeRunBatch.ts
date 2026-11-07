import { settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';

import { type AgentRun, type AgentRunVibeRunBatchSchedule } from '../../models/AgentRun';
import { type IntentResult } from '../../models/IntentResult';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { getProjectContext } from '../getProjectContext';
import { groundApplicationRecipeBatch } from '../groundApplicationRecipeBatch';
import { compileVibeBatchMetricState } from '../vibeRun/compileVibeBatchMetricState';
import { readVibeBatchPairs } from '../vibeRun/readVibeBatchPairs';

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
    const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
    const batch = plan?.batches[position - FIRST_BATCH_POSITION];
    if (plan === null || batch === undefined || plan.briefRevision !== schedule.briefRevision) {
        return { status: 'rejected', reason: 'its stored plan could not be read back' };
    }
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const context = getProjectContext();
    const drift = readVibeRunBriefDrift(schedule, context.productionBrief?.revision ?? null);
    if (drift !== null) {
        return { status: 'rejected', reason: drift };
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
