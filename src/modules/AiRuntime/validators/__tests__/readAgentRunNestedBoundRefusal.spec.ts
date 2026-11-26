import { describe, expect, it } from 'vitest';

import {
    AGENT_RUN_MAX_TEXT_LENGTH,
    AGENT_RUN_SCHEMA_VERSION,
    type AgentRun,
    type AgentRunBulkSetBatchSchedule,
    type AgentRunError,
    type AgentRunPlan,
    type AgentRunVibeRunBatchSchedule,
} from '../../models/AgentRun';
import {
    AGENT_RUN_MAX_SERIALIZED_LENGTH,
    MAX_COLLECTION_LENGTH,
    MAX_PLAN_APPLICATION_TOOL_RECEIPTS,
} from '../../models/AgentRunPlanBounds';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { readAgentRunBoundRefusal } from '../readAgentRunBoundRefusal';
import { readAgentRunNestedBoundRefusal } from '../readAgentRunNestedBoundRefusal';

const BOUND = MAX_COLLECTION_LENGTH;
const TEXT_BOUND = AGENT_RUN_MAX_TEXT_LENGTH;
const SERIALIZED_BOUND = AGENT_RUN_MAX_SERIALIZED_LENGTH;

const scope = { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };
const grants = {
    allowedOperationPrefixes: [],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};

const plan: AgentRunPlan = {
    summary: 'Brighten the vocal.',
    commandIds: [],
    serializedBatchIdentity: null,
    revision: null,
    classification: 'simple',
    showPlanPanel: false,
    objective: 'Brighten the vocal.',
    interpretedConstraints: [],
    scope,
    steps: [],
    expectedImpact: { project: [], audible: { status: 'not-claimed', reason: 'Nothing is claimed.' } },
    capabilities: [],
    risks: [],
    approvalPoints: [],
    validationStrategy: [],
    stoppingConditions: [],
    alternatives: [],
    needsUserDecision: false,
};

const run: AgentRun = {
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    runId: 'run-1',
    request: 'Brighten the vocal.',
    mode: 'plan',
    phase: 'created',
    revisions: { created: 'revision-1', planned: null, approved: null, committed: null },
    scope,
    grants,
    budgets: { limits: {}, consumed: {} },
    budgetAttempts: [],
    plan: null,
    decision: null,
    resume: null,
    batches: [],
    receipts: [],
    renders: [],
    analyses: [],
    modelRoute: { requestedRoute: 'legacy-unknown', selectedRouteId: null },
    providerUsage: [],
    errors: [],
    saga: { schemaVersion: 1, steps: [] },
    cancellation: {
        generation: 0,
        requestedAt: null,
        reason: null,
        consumerAcknowledgedAt: null,
        transportAcknowledgedAt: null,
        backendAcknowledgedAt: null,
    },
    committedWork: [],
    retriableWork: [],
    temporaryAssets: [],
    pendingEffectContinuations: [],
    preparedStemImports: [],
    manualResume: { required: false, reason: null, workIds: [], requiredAt: null },
    workLeases: [],
    contextEvidence: null,
    createdAt: 1,
    activeSince: null,
    updatedAt: 1,
};

function filled(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `entry-${String(index)}`);
}

function ranges(count: number) {
    return Array.from({ length: count }, (_, index) => ({ startBeat: index, endBeat: index + 1 }));
}

const related = { targetIds: [], commandIds: [], workIds: [], receiptIdentities: [], artifactIds: [] };

function errorWith(overrides: Partial<AgentRunError>): AgentRunError {
    return { code: 'code', message: 'message', occurredAt: 1, retriable: false, workId: null, ...overrides };
}

function relatedError(list: keyof typeof related, count: number): AgentRunError {
    return errorWith({ related: { ...related, [list]: filled(count) } });
}

const effect = {
    commandId: 'command',
    operation: 'operation',
    reason: 'reason',
    state: 'pending' as const,
    kind: 'runtime-graph' as const,
    remediation: 'retry' as const,
};

function continuationWith(overrides: Partial<AgentRun['pendingEffectContinuations'][number]>) {
    return {
        batchId: 'batch',
        effects: [effect],
        receiptIdentity: 'receipt',
        recovery: 'manual-repair' as const,
        serializedBatch: 'batch',
        authority: {
            projectId: 'project',
            baseRevision: 'revision',
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

function authorityWith(overrides: Partial<AgentRun['pendingEffectContinuations'][number]['authority']>) {
    return continuationWith({ authority: { ...continuationWith({}).authority, ...overrides } });
}

function receiptWithWarnings(count: number): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: 'call',
        toolName: 'project.query',
        turn: 1,
        status: 'success',
        revision: null,
        data: null,
        summary: 'Read.',
        warnings: Array.from({ length: count }, () => 'w'),
        error: null,
    };
}

const bulkSchedule: AgentRunBulkSetBatchSchedule = {
    kind: 'bulk-set',
    schemaVersion: 1,
    scheduleId: 'schedule',
    position: 1,
    total: 1,
    totalCommands: 1,
    interactionMode: 'apply',
    trustCeiling: null,
    serializedProviderProposal: null,
    slices: [{ position: 1, commandCount: 1, targetIds: [], serializedSlice: 'slice' }],
};

function vibeSchedule(serializedPlan: string): AgentRunVibeRunBatchSchedule {
    return {
        ...bulkSchedule,
        kind: 'vibe-run',
        serializedPlan,
        briefRevision: 1,
        recordedConstraints: { constraints: [], unsupported: [] },
    };
}

function withSchedule(batchSchedule: AgentRunPlan['batchSchedule']): AgentRun {
    return { ...run, plan: { ...plan, batchSchedule } };
}

type Row = [field: string, build: (count: number) => AgentRun];

const listRows: Row[] = [
    [
        'run.batches[].commandIds',
        (count) => ({
            ...run,
            batches: [{ batchId: 'batch', commandIds: filled(count), status: 'planned', receiptIdentity: null }],
        }),
    ],
    [
        'run.saga.steps[].relatedArtifactIds',
        (count) => ({
            ...run,
            saga: {
                schemaVersion: 1,
                steps: [
                    {
                        stepId: 'step',
                        order: 1,
                        owner: 'render',
                        workId: 'work',
                        receiptIdentity: null,
                        state: 'pending',
                        compensation: { available: false, attempts: 0, lastError: null },
                        relatedArtifactIds: filled(count),
                        updatedAt: 1,
                    },
                ],
            },
        }),
    ],
    [
        'run.pendingEffectContinuations[].effects',
        (count) => ({
            ...run,
            pendingEffectContinuations: [
                continuationWith({
                    effects: filled(count).map((commandId) => ({ ...effect, commandId })),
                }),
            ],
        }),
    ],
    [
        'run.pendingEffectContinuations[].authority.scope.targetIds',
        (count) => ({
            ...run,
            pendingEffectContinuations: [authorityWith({ scope: { ...scope, targetIds: filled(count) } })],
        }),
    ],
    [
        'run.pendingEffectContinuations[].authority.scope.targetRanges',
        (count) => ({
            ...run,
            pendingEffectContinuations: [authorityWith({ scope: { ...scope, targetRanges: ranges(count) } })],
        }),
    ],
    [
        'run.pendingEffectContinuations[].authority.scope.protectedTargetIds',
        (count) => ({
            ...run,
            pendingEffectContinuations: [authorityWith({ scope: { ...scope, protectedTargetIds: filled(count) } })],
        }),
    ],
    [
        'run.pendingEffectContinuations[].authority.scope.protectedRanges',
        (count) => ({
            ...run,
            pendingEffectContinuations: [authorityWith({ scope: { ...scope, protectedRanges: ranges(count) } })],
        }),
    ],
    [
        'run.pendingEffectContinuations[].authority.grants.allowedOperationPrefixes',
        (count) => ({
            ...run,
            pendingEffectContinuations: [
                authorityWith({ grants: { ...grants, allowedOperationPrefixes: filled(count) } }),
            ],
        }),
    ],
    [
        'run.preparedStemImports[].resources',
        (count) => ({
            ...run,
            preparedStemImports: [
                {
                    schemaVersion: 1,
                    batchId: 'batch',
                    serializedCommandBatch: 'batch',
                    resources: filled(count).map((audioBufferId) => ({ audioBufferId, assetLeaseId: null })),
                },
            ],
        }),
    ],
    ...(['targetIds', 'commandIds', 'workIds', 'receiptIdentities', 'artifactIds'] as const).map((list): Row => [
        `run.errors[].related.${list}`,
        (count) => ({ ...run, errors: [relatedError(list, count)] }),
    ]),
    [
        'run.providerUsage[].disclosure.categories',
        (count) => ({
            ...run,
            providerUsage: [
                {
                    provider: 'provider',
                    model: null,
                    inputTokens: null,
                    outputTokens: null,
                    provenance: 'unavailable',
                    disclosure: {
                        requestId: 'request',
                        categories: filled(count),
                        retention: {
                            applicationState: 'unknown',
                            abuseMonitoring: 'unknown',
                            promptCache: 'unknown',
                            safetyLegalException: 'unknown',
                            unknown: 'unknown',
                        },
                    },
                },
            ],
        }),
    ],
    [
        'run.plan.applicationToolReceipts[].warnings',
        (count) => ({ ...run, plan: { ...plan, applicationToolReceipts: [receiptWithWarnings(count)] } }),
    ],
];

const textRows: Row[] = [
    ['run.request', (count) => ({ ...run, request: 'x'.repeat(count) })],
    ['run.plan.summary', (count) => ({ ...run, plan: { ...plan, summary: 'x'.repeat(count) } })],
    ['run.errors[].message', (count) => ({ ...run, errors: [errorWith({ message: 'x'.repeat(count) })] })],
    [
        'run.batches[].commandIds[]',
        (count) => ({
            ...run,
            batches: [{ batchId: 'batch', commandIds: ['x'.repeat(count)], status: 'planned', receiptIdentity: null }],
        }),
    ],
    [
        'run.pendingEffectContinuations[].lastError',
        (count) => ({ ...run, pendingEffectContinuations: [continuationWith({ lastError: 'x'.repeat(count) })] }),
    ],
];

const serializedRows: Row[] = [
    [
        'run.plan.batchSchedule.slices[].serializedSlice',
        (count) =>
            withSchedule({
                ...bulkSchedule,
                slices: [{ position: 1, commandCount: 1, targetIds: [], serializedSlice: 'x'.repeat(count) }],
            }),
    ],
    [
        'run.plan.batchSchedule.serializedProviderProposal',
        (count) => withSchedule({ ...bulkSchedule, serializedProviderProposal: 'x'.repeat(count) }),
    ],
    ['run.plan.batchSchedule.serializedPlan', (count) => withSchedule(vibeSchedule('x'.repeat(count)))],
    [
        'run.pendingEffectContinuations[].serializedBatch',
        (count) => ({ ...run, pendingEffectContinuations: [continuationWith({ serializedBatch: 'x'.repeat(count) })] }),
    ],
];

describe('readAgentRunNestedBoundRefusal', () => {
    it('admits a run holding no nested list or text past its bound', () => {
        expect(readAgentRunNestedBoundRefusal(run)).toBeNull();
        expect(readAgentRunBoundRefusal(run)).toBeNull();
    });

    describe.each(listRows)('%s', (field, build) => {
        it('keeps a list at the bound and refuses it one entry past, naming the field', () => {
            expect(readAgentRunBoundRefusal(build(BOUND))).toBeNull();
            expect(readAgentRunBoundRefusal(build(BOUND + 1))).toEqual({
                status: 'refused',
                reason: 'collection-bound',
                collection: field,
                bound: BOUND,
            });
        });
    });

    describe.each(textRows)('%s', (field, build) => {
        it('keeps a text at the character bound and refuses it one character past, naming the field', () => {
            expect(readAgentRunBoundRefusal(build(TEXT_BOUND))).toBeNull();
            expect(readAgentRunBoundRefusal(build(TEXT_BOUND + 1))).toEqual({
                status: 'refused',
                reason: 'field-length',
                collection: field,
                bound: TEXT_BOUND,
            });
        });
    });

    describe.each(serializedRows)('%s', (field, build) => {
        it('keeps a serialized text at its character bound and refuses it one character past', () => {
            expect(readAgentRunBoundRefusal(build(SERIALIZED_BOUND))).toBeNull();
            expect(readAgentRunBoundRefusal(build(SERIALIZED_BOUND + 1))).toEqual({
                status: 'refused',
                reason: 'field-length',
                collection: field,
                bound: SERIALIZED_BOUND,
            });
        });
    });

    it('measures text in characters, as the restore reader does, not in UTF-8 bytes', () => {
        const multibyte = (count: number) => ({ ...run, request: 'é'.repeat(count) });

        expect(readAgentRunBoundRefusal(multibyte(TEXT_BOUND))).toBeNull();
        expect(readAgentRunBoundRefusal(multibyte(TEXT_BOUND + 1))?.collection).toBe('run.request');
    });

    it('leaves a goal state to its byte bound, which the plan check owns, not the text bound', () => {
        const longGoalState = 'x'.repeat(TEXT_BOUND + 1);

        expect(
            readAgentRunNestedBoundRefusal({ ...run, plan: { ...plan, metricGoalState: longGoalState } })
        ).toBeNull();
        expect(
            readAgentRunNestedBoundRefusal(withSchedule({ ...bulkSchedule, metricGoalState: longGoalState }))
        ).toBeNull();
    });

    it('keeps the plan receipt bound its own, wider than the nested list bound', () => {
        const receipts = Array.from({ length: MAX_PLAN_APPLICATION_TOOL_RECEIPTS }, () => receiptWithWarnings(0));

        expect(readAgentRunBoundRefusal({ ...run, plan: { ...plan, applicationToolReceipts: receipts } })).toBeNull();
    });
});
