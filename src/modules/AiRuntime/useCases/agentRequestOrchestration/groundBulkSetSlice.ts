import { settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';

import { type AgentRun, type AgentRunBulkSetBatchSchedule, type AgentRunProviderProposal } from '../../models/AgentRun';
import { type IntentResult } from '../../models/IntentResult';
import { normalizeAgentPlanProposal } from '../../transformers/normalizeAgentPlanProposal';
import { getProjectContext } from '../getProjectContext';
import { groundCompiledCommandBatch } from '../groundCompiledCommandBatch';

import { readBulkSetSliceEvidence } from './readBulkSetSliceEvidence';
import { rebaseBulkSetSliceEvidence } from './rebaseBulkSetSliceEvidence';

type GroundedBulkSetSlice =
    | { status: 'grounded'; result: IntentResult; context: ReturnType<typeof getProjectContext>; revision: string }
    | { status: 'rejected'; reason: string };

function readProviderProposal(schedule: AgentRunBulkSetBatchSchedule): AgentRunProviderProposal | null | undefined {
    if (schedule.serializedProviderProposal === null) {
        return null;
    }
    try {
        return normalizeAgentPlanProposal(JSON.parse(schedule.serializedProviderProposal)) ?? undefined;
    } catch {
        return undefined;
    }
}

/** Grounds the bulk-set slice at `position` against the live project exactly as the planner grounded the first. */
export function groundBulkSetSlice(
    run: AgentRun,
    schedule: AgentRunBulkSetBatchSchedule,
    position: number
): GroundedBulkSetSlice {
    const requestProtections = schedule.requestProtections;
    if (requestProtections === undefined || requestProtections.request !== run.request) {
        return {
            status: 'rejected',
            reason: 'its original request protection binding is missing or no longer matches',
        };
    }
    const slices = schedule.slices.map((stored) => readBulkSetSliceEvidence(stored.serializedSlice));
    const evidence = slices[position - 1] ?? null;
    const providerProposal = readProviderProposal(schedule);
    if (evidence === null || slices.includes(null) || providerProposal === undefined) {
        return { status: 'rejected', reason: 'its stored plan could not be read back' };
    }
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const context = getProjectContext();
    const rebased = rebaseBulkSetSliceEvidence({
        evidence,
        context,
        revision,
        earlierCommands: slices.slice(0, position - 1).flatMap((earlier) => earlier?.commands ?? []),
        recordedFingerprints: new Map(
            slices.flatMap((stored) =>
                (stored?.selectors ?? []).flatMap((selector) =>
                    selector.preconditions.map(
                        (precondition) => [precondition.stableId, precondition.fingerprint] as const
                    )
                )
            )
        ),
    });
    if (rebased.status === 'rejected') {
        return rebased;
    }
    const grounded = groundCompiledCommandBatch({
        toolCalls: rebased.evidence.commands,
        context,
        prompt: run.request,
        projectRevision: revision,
        workflowCapabilityId: undefined,
        compilerEvidence: rebased.evidence,
        selectedCompilations: [],
        transformCommands: [],
        transformTargetIds: [],
        creativeAuthority: undefined,
        providerProposal,
        requestProtections,
    });
    if (grounded.status === 'rejected') {
        return { status: 'rejected', reason: grounded.rejectionReason };
    }
    if (grounded.status === 'clarify') {
        return { status: 'rejected', reason: grounded.planningOutcome.reason };
    }
    if (grounded.status === 'empty') {
        return { status: 'rejected', reason: 'it no longer grounds to any executable action' };
    }
    const plannedSchedule: NonNullable<IntentResult['batchSchedule']> = {
        schemaVersion: schedule.schemaVersion,
        kind: schedule.kind,
        scheduleId: schedule.scheduleId,
        position,
        total: schedule.total,
        totalCommands: schedule.totalCommands,
        serializedProviderProposal: schedule.serializedProviderProposal,
        requestProtections: structuredClone(requestProtections),
        slices: structuredClone(schedule.slices),
    };
    return {
        status: 'grounded',
        context,
        revision,
        result: {
            actions: grounded.actions,
            metricGoalState: schedule.metricGoalState,
            actionCommandGraph: grounded.actionCommandGraph,
            rawText: run.request,
            requiresConfirmation: grounded.requiresConfirmation,
            applicationToolReceipts: structuredClone(run.plan?.applicationToolReceipts ?? []),
            terminalMeasurementSettlement: run.plan?.terminalMeasurementSettlement,
            executionMode: 'atomic',
            providerKnownTargetIds: grounded.providerKnownTargetIds,
            matchSelectorPredicates:
                grounded.matchSelectorPredicates.length === 0 ? undefined : grounded.matchSelectorPredicates,
            providerProposal: grounded.providerProposal ?? undefined,
            protectionFacts: grounded.protectionFacts,
            batchSchedule: plannedSchedule,
        },
    };
}
