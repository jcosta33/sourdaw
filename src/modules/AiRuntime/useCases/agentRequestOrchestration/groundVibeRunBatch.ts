import { type AgentRun, type AgentRunVibeRunBatchSchedule } from '../../models/AgentRun';
import { type IntentResult } from '../../models/IntentResult';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { type getProjectContext } from '../getProjectContext';
import { groundApplicationRecipeBatch } from '../groundApplicationRecipeBatch';
import { type VibeBatchValueChoice } from '../vibeRun/chooseVibeBatchValues';
import { compileVibeBatchMetricState } from '../vibeRun/compileVibeBatchMetricState';
import { readVibeBatchPairs } from '../vibeRun/readVibeBatchPairs';

import { preflightVibeRunBatch } from './preflightVibeRunBatch';

export type GroundedVibeRunBatch =
    | {
          status: 'grounded';
          result: IntentResult;
          context: ReturnType<typeof getProjectContext>;
          revision: string;
          batch: ScheduledVibeRunBatch;
          /** Where the expanded values came from, which the batch card states per recipe. */
          valueChoice: VibeBatchValueChoice;
      }
    | { status: 'rejected'; reason: string };

function readPairValues(choice: VibeBatchValueChoice, targetId: string, recipeId: string) {
    if (choice.source !== 'measurements') {
        return [];
    }
    return choice.pairs.find((pair) => pair.targetId === targetId && pair.recipeId === recipeId)?.values ?? [];
}

/**
 * Grounds the vibe-run batch at `position` from the plan the run recorded, against the live project
 * and the brief the plan was read from. Every guard of `preflightVibeRunBatch` runs again here, at
 * the revision the batch grounds at; every recipe of every target then expands with the values the
 * value choice gave it, or with none (the middle of each authored window) when it kept the catalogue
 * defaults, under one application-stated authority, and the batch is held to the request's
 * constraints as they were recorded. A changed brief, a removed or frozen target, or a recipe that no
 * longer expands refuses the batch whole; it is never adapted or shrunk to what still grounds.
 */
export function groundVibeRunBatch(
    run: AgentRun,
    schedule: AgentRunVibeRunBatchSchedule,
    position: number,
    choice: VibeBatchValueChoice
): GroundedVibeRunBatch {
    const preflight = preflightVibeRunBatch(run, schedule, position);
    if (preflight.status === 'rejected') {
        return preflight;
    }
    const { batch, context, revision } = preflight;
    const [first, ...rest] = readVibeBatchPairs(batch).map((pair) => ({
        ...pair,
        role: null,
        values: readPairValues(choice, pair.targetId, pair.recipeId),
    }));
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
        valueChoice: choice,
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
            adoptedRecipes: grounded.adoptedRecipes.map((recipe) => ({ ...recipe, valueSource: choice.source })),
            protectionFacts: grounded.grounded.protectionFacts,
            batchSchedule: { ...planned, position },
        },
    };
}
