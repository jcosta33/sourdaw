import { beforeEach, describe, expect, it } from 'vitest';

import {
    AGENT_RUN_MAX_TEXT_LENGTH,
    type AgentRun,
    type AgentRunBulkSetBatchSchedule,
    type AgentRunError,
    type AgentRunPendingEffectContinuation,
} from '../../models/AgentRun';
import { AGENT_RUN_MAX_SERIALIZED_LENGTH, MAX_COLLECTION_LENGTH } from '../../models/AgentRunPlanBounds';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { agentRunLifecycle } from '../agentRunLifecycle';

import {
    RUN_ID,
    STORAGE_KEY,
    createRun,
    decodeReloadedRun,
    grants,
    ids,
    liveRun,
    planRecord,
    scope,
} from './agentRunBoundsFixture';

function storedText(): string | null {
    return window.localStorage.getItem(STORAGE_KEY);
}

function reloadedRun() {
    return decodeReloadedRun(storedText());
}

const BOUND = MAX_COLLECTION_LENGTH;
const TEXT_BOUND = AGENT_RUN_MAX_TEXT_LENGTH;
const SERIALIZED_BOUND = AGENT_RUN_MAX_SERIALIZED_LENGTH;

const related = { targetIds: [], commandIds: [], workIds: [], receiptIdentities: [], artifactIds: [] };

function errorWith(overrides: Partial<AgentRunError>): AgentRunError {
    return {
        code: 'nested-bound',
        message: 'A nested bound was probed.',
        occurredAt: 5,
        retriable: false,
        workId: null,
        category: 'internal',
        related,
        remediation: { retry: 'never', userAction: 'none', compensation: 'not-needed' },
        cause: { kind: 'known-domain', source: 'spec' },
        ...overrides,
    };
}

function recordError(error: AgentRunError): void {
    agentRunLifecycle.recordError({ runId: RUN_ID, error });
}

function continuationWith(overrides: Partial<AgentRunPendingEffectContinuation>): AgentRunPendingEffectContinuation {
    return {
        batchId: 'batch-1',
        effects: [
            {
                commandId: 'command-1',
                operation: 'renderProjectSections',
                reason: 'The render is pending.',
                state: 'pending',
                kind: 'external-effect',
                remediation: 'manual-repair',
            },
        ],
        receiptIdentity: 'receipt-1',
        recovery: 'manual-repair',
        serializedBatch: 'batch',
        authority: {
            projectId: 'project-1',
            baseRevision: 'revision-1',
            scope,
            grants,
            budgets: {
                maxCommands: 1,
                maxCreatedTracks: 0,
                maxDeletedObjects: 0,
                maxAffectedTracks: 0,
                maxAffectedClips: 0,
                maxAutomationPoints: 0,
                maxImportedAssets: 0,
                maxRenderJobs: 0,
            },
        },
        lastError: null,
        ...overrides,
    };
}

function recordContinuation(overrides: Partial<AgentRunPendingEffectContinuation>): void {
    agentRunLifecycle.recordPendingEffectContinuation({
        runId: RUN_ID,
        continuation: continuationWith(overrides),
        recordedAt: 6,
    });
}

function bulkSchedule(overrides: Partial<AgentRunBulkSetBatchSchedule>): AgentRunBulkSetBatchSchedule {
    return {
        kind: 'bulk-set',
        schemaVersion: 1,
        scheduleId: 'schedule-1',
        position: 1,
        total: 1,
        totalCommands: 1,
        interactionMode: 'apply',
        trustCeiling: null,
        serializedProviderProposal: null,
        slices: [{ position: 1, commandCount: 1, targetIds: ['track-1'], serializedSlice: 'slice' }],
        ...overrides,
    };
}

function recordSchedule(schedule: AgentRunBulkSetBatchSchedule): void {
    agentRunLifecycle.recordPlan(planRecord({ ...liveRun().plan, batchSchedule: schedule }));
}

function recordReceipt(warnings: number): void {
    const receipt: ApplicationToolReceipt = {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: 'call-1',
        toolName: 'project.query',
        turn: 1,
        status: 'success',
        revision: null,
        data: null,
        summary: 'Read the project.',
        warnings: Array.from({ length: warnings }, () => 'warning'),
        error: null,
    };
    agentRunLifecycle.recordPlan(planRecord({ ...liveRun().plan, applicationToolReceipts: [receipt] }));
}

type NestedRow = {
    field: string;
    /** The field a write past the bound is refused for, when an earlier bound is reached first. */
    refusedField?: string;
    bound: number;
    write: (size: number) => void;
    kept: (run: AgentRun) => number | undefined;
};

const relatedRows = (['targetIds', 'commandIds', 'workIds', 'receiptIdentities', 'artifactIds'] as const).map(
    (list): NestedRow => ({
        field: `run.errors[].related.${list}`,
        bound: BOUND,
        write: (size) => recordError(errorWith({ related: { ...related, [list]: ids(list, size) } })),
        kept: (run) => run.errors[0]?.related?.[list].length,
    })
);

const listRows: NestedRow[] = [
    {
        field: 'run.batches[].commandIds',
        bound: BOUND,
        write: (size) =>
            agentRunLifecycle.recordBatch({
                runId: RUN_ID,
                batch: {
                    batchId: 'batch-1',
                    commandIds: ids('command', size),
                    status: 'planned',
                    receiptIdentity: null,
                },
            }),
        kept: (run) => run.batches[0]?.commandIds.length,
    },
    {
        field: 'run.saga.steps[].relatedArtifactIds',
        bound: BOUND,
        write: (size) =>
            agentRunLifecycle.recordSagaStep({
                runId: RUN_ID,
                step: {
                    stepId: 'step-1',
                    order: 1,
                    owner: 'render',
                    workId: 'work-1',
                    receiptIdentity: null,
                    state: 'pending',
                    compensation: { available: false, attempts: 0, lastError: null },
                    relatedArtifactIds: ids('artifact', size),
                    updatedAt: 5,
                },
            }),
        kept: (run) => run.saga.steps[0]?.relatedArtifactIds.length,
    },
    {
        field: 'run.pendingEffectContinuations[].effects',
        refusedField: 'run.saga.steps',
        bound: BOUND,
        write: (size) =>
            recordContinuation({
                effects: ids('command', size).map((commandId) => ({
                    commandId,
                    operation: 'renderProjectSections',
                    reason: 'The render is pending.',
                    state: 'pending' as const,
                    kind: 'external-effect' as const,
                    remediation: 'manual-repair' as const,
                })),
            }),
        kept: (run) => run.pendingEffectContinuations[0]?.effects.length,
    },
    {
        field: 'run.pendingEffectContinuations[].authority.scope.targetIds',
        bound: BOUND,
        write: (size) =>
            recordContinuation({
                authority: { ...continuationWith({}).authority, scope: { ...scope, targetIds: ids('track', size) } },
            }),
        kept: (run) => run.pendingEffectContinuations[0]?.authority.scope.targetIds.length,
    },
    {
        field: 'run.pendingEffectContinuations[].authority.grants.allowedOperationPrefixes',
        bound: BOUND,
        write: (size) =>
            recordContinuation({
                authority: {
                    ...continuationWith({}).authority,
                    grants: { ...grants, allowedOperationPrefixes: ids('project.', size) },
                },
            }),
        kept: (run) => run.pendingEffectContinuations[0]?.authority.grants.allowedOperationPrefixes.length,
    },
    {
        field: 'run.providerUsage[].disclosure.categories',
        bound: BOUND,
        write: (size) =>
            agentRunLifecycle.recordProviderUsage({
                runId: RUN_ID,
                usage: {
                    provider: 'provider-1',
                    model: null,
                    inputTokens: null,
                    outputTokens: null,
                    provenance: 'unavailable',
                    disclosure: {
                        requestId: 'request-1',
                        categories: Array.from({ length: size }, () => 'metadata'),
                        retention: {
                            applicationState: 'unknown',
                            abuseMonitoring: 'unknown',
                            promptCache: 'unknown',
                            safetyLegalException: 'unknown',
                            unknown: 'unknown',
                        },
                    },
                },
            }),
        kept: (run) => run.providerUsage[0]?.disclosure?.categories.length,
    },
    {
        field: 'run.plan.applicationToolReceipts[].warnings',
        bound: BOUND,
        write: recordReceipt,
        kept: (run) => run.plan?.applicationToolReceipts?.[0]?.warnings.length,
    },
    ...relatedRows,
];

describe('nested lists restore reads back are checked when the run is written', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        createRun();
    });

    it.each(listRows)('refuses $field one entry past its bound and keeps it at the bound', (row) => {
        const storedBefore = storedText();

        expect(() => {
            row.write(row.bound + 1);
        }).toThrow(`the run cannot hold more than ${String(row.bound)} entries in ${row.refusedField ?? row.field}`);
        expect(storedText()).toBe(storedBefore);

        row.write(row.bound);
        expect(row.kept(reloadedRun())).toBe(row.bound);
    });
});

type TextRow = {
    field: string;
    bound: number;
    write: (length: number) => void;
    kept: (run: AgentRun) => number | undefined;
};

const textRows: TextRow[] = [
    {
        field: 'run.plan.summary',
        bound: TEXT_BOUND,
        write: (length) => agentRunLifecycle.recordPlan(planRecord({ ...liveRun().plan, summary: 'x'.repeat(length) })),
        kept: (run) => run.plan?.summary.length,
    },
    {
        field: 'run.errors[].message',
        bound: TEXT_BOUND,
        write: (length) => recordError(errorWith({ message: 'x'.repeat(length) })),
        kept: (run) => run.errors[0]?.message.length,
    },
    {
        field: 'run.batches[].commandIds[]',
        bound: TEXT_BOUND,
        write: (length) =>
            agentRunLifecycle.recordBatch({
                runId: RUN_ID,
                batch: {
                    batchId: 'batch-1',
                    commandIds: ['x'.repeat(length)],
                    status: 'planned',
                    receiptIdentity: null,
                },
            }),
        kept: (run) => run.batches[0]?.commandIds[0]?.length,
    },
    {
        field: 'run.pendingEffectContinuations[].lastError',
        bound: TEXT_BOUND,
        write: (length) => recordContinuation({ lastError: 'x'.repeat(length) }),
        kept: (run) => run.pendingEffectContinuations[0]?.lastError?.length,
    },
    {
        field: 'run.plan.batchSchedule.slices[].serializedSlice',
        bound: SERIALIZED_BOUND,
        write: (length) =>
            recordSchedule(
                bulkSchedule({
                    slices: [
                        { position: 1, commandCount: 1, targetIds: ['track-1'], serializedSlice: 'x'.repeat(length) },
                    ],
                })
            ),
        kept: (run) => run.plan?.batchSchedule?.slices[0]?.serializedSlice.length,
    },
    {
        field: 'run.plan.batchSchedule.serializedProviderProposal',
        bound: SERIALIZED_BOUND,
        write: (length) => recordSchedule(bulkSchedule({ serializedProviderProposal: 'x'.repeat(length) })),
        kept: (run) => run.plan?.batchSchedule?.serializedProviderProposal?.length,
    },
    {
        field: 'run.pendingEffectContinuations[].serializedBatch',
        bound: SERIALIZED_BOUND,
        write: (length) => recordContinuation({ serializedBatch: 'x'.repeat(length) }),
        kept: (run) => run.pendingEffectContinuations[0]?.serializedBatch.length,
    },
];

describe('texts restore reads back are checked when the run is written', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        createRun();
    });

    it.each(textRows)('refuses $field one character past its bound and keeps it at the bound', (row) => {
        const storedBefore = storedText();

        expect(() => {
            row.write(row.bound + 1);
        }).toThrow(`the run cannot keep ${row.field} longer than ${String(row.bound)} characters`);
        expect(storedText()).toBe(storedBefore);

        row.write(row.bound);
        expect(row.kept(reloadedRun())).toBe(row.bound);
    });
});
