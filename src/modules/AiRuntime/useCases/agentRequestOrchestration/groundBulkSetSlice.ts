import { logger } from '#/infra/logger/appLogger';
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

type StoredSliceEvidence = NonNullable<ReturnType<typeof readBulkSetSliceEvidence>>;

type StoredSlice = {
    status: 'read';
    slices: StoredSliceEvidence[];
    evidence: StoredSliceEvidence;
    providerProposal: AgentRunProviderProposal | null;
    requestProtections: NonNullable<AgentRunBulkSetBatchSchedule['requestProtections']>;
};

type GroundedCommands = Extract<ReturnType<typeof groundCompiledCommandBatch>, { status: 'grounded' }>;

function readProviderProposal(schedule: AgentRunBulkSetBatchSchedule): AgentRunProviderProposal | null | undefined {
    if (schedule.serializedProviderProposal === null) {
        return null;
    }
    try {
        return normalizeAgentPlanProposal(JSON.parse(schedule.serializedProviderProposal)) ?? undefined;
    } catch (error) {
        logger.warn('A scheduled bulk-set batch holds a provider proposal that does not parse', { error });
        return undefined;
    }
}

function isReadSlice(slice: ReturnType<typeof readBulkSetSliceEvidence>): slice is StoredSliceEvidence {
    return slice !== null;
}

/** Reads the slice at `position` and everything the schedule stored to ground it, refusing a schedule that no longer reads back. */
function readStoredSlice(
    run: AgentRun,
    schedule: AgentRunBulkSetBatchSchedule,
    position: number
): StoredSlice | { status: 'rejected'; reason: string } {
    const requestProtections = schedule.requestProtections;
    if (requestProtections?.request !== run.request) {
        return {
            status: 'rejected',
            reason: 'its original request protection binding is missing or no longer matches',
        };
    }
    const read = schedule.slices.map((stored) => readBulkSetSliceEvidence(stored.serializedSlice));
    const slices = read.filter(isReadSlice);
    const evidence = slices.at(position - 1);
    const providerProposal = readProviderProposal(schedule);
    if (slices.length !== read.length || evidence === undefined || providerProposal === undefined) {
        return { status: 'rejected', reason: 'its stored plan could not be read back' };
    }
    return { status: 'read', slices, evidence, providerProposal, requestProtections };
}

function readRecordedFingerprints(slices: readonly StoredSliceEvidence[]): Map<string, string> {
    return new Map(
        slices.flatMap((stored) =>
            stored.selectors.flatMap((selector) =>
                selector.preconditions.map((precondition) => [precondition.stableId, precondition.fingerprint] as const)
            )
        )
    );
}

function readGroundingRefusal(
    grounded: Exclude<ReturnType<typeof groundCompiledCommandBatch>, GroundedCommands>
): string {
    if (grounded.status === 'rejected') {
        return grounded.rejectionReason;
    }
    if (grounded.status === 'clarify') {
        return grounded.planningOutcome.reason;
    }
    return 'it no longer grounds to any executable action';
}

type SliceResultInput = {
    run: AgentRun;
    schedule: AgentRunBulkSetBatchSchedule;
    position: number;
    stored: StoredSlice;
    grounded: GroundedCommands;
};

function composeSliceResult({ run, schedule, position, stored, grounded }: SliceResultInput): IntentResult {
    return {
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
        batchSchedule: {
            schemaVersion: schedule.schemaVersion,
            kind: schedule.kind,
            scheduleId: schedule.scheduleId,
            position,
            total: schedule.total,
            totalCommands: schedule.totalCommands,
            serializedProviderProposal: schedule.serializedProviderProposal,
            requestProtections: structuredClone(stored.requestProtections),
            slices: structuredClone(schedule.slices),
        },
    };
}

/** Grounds the bulk-set slice at `position` against the live project exactly as the planner grounded the first. */
export function groundBulkSetSlice(
    run: AgentRun,
    schedule: AgentRunBulkSetBatchSchedule,
    position: number
): GroundedBulkSetSlice {
    const stored = readStoredSlice(run, schedule, position);
    if (stored.status === 'rejected') {
        return stored;
    }
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const context = getProjectContext();
    const rebased = rebaseBulkSetSliceEvidence({
        evidence: stored.evidence,
        context,
        revision,
        earlierCommands: stored.slices.slice(0, position - 1).flatMap((earlier) => earlier.commands),
        recordedFingerprints: readRecordedFingerprints(stored.slices),
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
        providerProposal: stored.providerProposal,
        requestProtections: stored.requestProtections,
    });
    if (grounded.status !== 'grounded') {
        return { status: 'rejected', reason: readGroundingRefusal(grounded) };
    }
    return {
        status: 'grounded',
        context,
        revision,
        result: composeSliceResult({ run, schedule, position, stored, grounded }),
    };
}
