import { parse } from 'superjson';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    type AgentRunBatchSchedule,
    type AgentRunBulkSetBatchSchedule,
    type AgentRunGrants,
    type AgentRunPlan,
    type AgentRunScope,
    type AgentRunState,
} from '../../models/AgentRun';
import { MAX_COLLECTION_LENGTH } from '../../models/AgentRunPlanBounds';
import { APPLICATION_TOOL_RECEIPT_MAX_BYTES } from '../../models/ApplicationOwnedTool';
import { MAX_METRIC_GOAL_STATE_BYTES } from '../../models/MetricGoalAdmission';
import { sanitizeAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';

const RUN_ID = 'restore-bound-run';
const STORAGE_KEY = 'sourdaw-agent-runs';
const BOUND = MAX_COLLECTION_LENGTH;

const scope: AgentRunScope = {
    targetIds: ['track-1'],
    targetRanges: [],
    protectedTargetIds: [],
    protectedRanges: [],
};
const grants: AgentRunGrants = {
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
const budgets = { limits: {}, consumed: {} };

function createRun(): void {
    agentRunLifecycle.create({
        runId: RUN_ID,
        request: 'Brighten the vocal.',
        mode: 'plan',
        createdRevision: 'revision-1',
    });
    agentRunLifecycle.recordPlan({
        runId: RUN_ID,
        summary: 'Brighten the vocal.',
        commandIds: [],
        serializedBatchIdentity: null,
        revision: 'revision-1',
        scope,
        grants,
        budgets,
    });
}

function liveRun() {
    const run = agentRunLifecycle.get(RUN_ID);
    if (run?.plan === null || run?.plan === undefined) {
        throw new Error('Expected the recorded run plan.');
    }
    return { run, plan: run.plan };
}

function storedText(): string | null {
    return window.localStorage.getItem(STORAGE_KEY);
}

/** What the next session reads: the stored text, decoded and sanitized exactly as the store loads it. */
function reloadedRun() {
    const raw = storedText();
    if (raw === null) {
        throw new Error('Expected persisted agent run state.');
    }
    const state: AgentRunState = sanitizeAgentRunState(parse<unknown>(raw));
    const run = state.runs.find((candidate) => candidate.runId === RUN_ID);
    if (run === undefined) {
        throw new Error('The run did not survive the reload.');
    }
    return run;
}

function planRecord(plan: AgentRunPlan, overrides: Partial<{ scope: AgentRunScope; grants: AgentRunGrants }> = {}) {
    return {
        runId: RUN_ID,
        summary: plan.summary,
        commandIds: plan.commandIds,
        serializedBatchIdentity: plan.serializedBatchIdentity,
        revision: 'revision-2',
        scope,
        grants,
        budgets,
        plan,
        ...overrides,
    };
}

function ids(prefix: string, count: number): string[] {
    return Array.from({ length: count }, (_, index) => `${prefix}-${String(index)}`);
}

function schedule(
    sliceCount: number,
    extra: Partial<AgentRunBulkSetBatchSchedule> = {},
    targetIds: string[] = ['track-1']
): AgentRunBatchSchedule {
    return {
        kind: 'bulk-set',
        schemaVersion: 1,
        scheduleId: 'schedule-1',
        position: 1,
        total: sliceCount,
        totalCommands: sliceCount,
        interactionMode: 'apply',
        trustCeiling: null,
        serializedProviderProposal: null,
        slices: Array.from({ length: sliceCount }, (_, index) => ({
            position: index + 1,
            commandCount: 1,
            targetIds,
            serializedSlice: `slice-${String(index)}`,
        })),
        ...extra,
    };
}

function protections(
    facts: Partial<{ unchanged: number; controls: number; clauses: number; operations: number; exceptions: number }>
) {
    const clauseCount = facts.clauses ?? 1;
    return {
        request: 'x'.repeat(clauseCount + 1),
        facts: {
            protectedUnchanged: ids('protected', facts.unchanged ?? 1).map((id) => ({ id, name: id })),
            protectedControls: ids('control', facts.controls ?? 1).map((trackId) => ({
                trackId,
                operations: ids('operation', facts.operations ?? 1),
                exceptOperations: ids('exception', facts.exceptions ?? 1),
            })),
        },
        resolvedTrackClauses: Array.from({ length: clauseCount }, (_, index) => ({ start: index, end: index + 1 })),
    };
}

type PlanWithRow = {
    field: string;
    plan: (count: number) => AgentRunPlan;
    kept: (plan: AgentRunPlan | null) => unknown;
};

function withSchedule(next: (count: number) => AgentRunBatchSchedule): PlanWithRow['plan'] {
    return (count) => ({ ...liveRun().plan, batchSchedule: next(count) });
}

const collectionRows: Array<PlanWithRow & { bound: number }> = [
    {
        field: 'batchSchedule.slices',
        bound: BOUND,
        plan: withSchedule((count) => schedule(count)),
        kept: (plan) => plan?.batchSchedule?.slices.length,
    },
    {
        field: 'batchSchedule.slices.targetIds',
        bound: BOUND,
        plan: withSchedule((count) => schedule(1, {}, ids('track', count))),
        kept: (plan) => plan?.batchSchedule?.slices[0]?.targetIds.length,
    },
    {
        field: 'batchSchedule.requestProtections.protectedUnchanged',
        bound: BOUND,
        plan: withSchedule((count) => schedule(1, { requestProtections: protections({ unchanged: count }) })),
        kept: (plan) => plan?.batchSchedule?.requestProtections?.facts.protectedUnchanged.length,
    },
    {
        field: 'batchSchedule.requestProtections.protectedControls',
        bound: BOUND,
        plan: withSchedule((count) => schedule(1, { requestProtections: protections({ controls: count }) })),
        kept: (plan) => plan?.batchSchedule?.requestProtections?.facts.protectedControls.length,
    },
    {
        field: 'batchSchedule.requestProtections.protectedControls.operations',
        bound: BOUND,
        plan: withSchedule((count) => schedule(1, { requestProtections: protections({ operations: count }) })),
        kept: (plan) => plan?.batchSchedule?.requestProtections?.facts.protectedControls[0]?.operations.length,
    },
    {
        field: 'batchSchedule.requestProtections.protectedControls.exceptOperations',
        bound: BOUND,
        plan: withSchedule((count) => schedule(1, { requestProtections: protections({ exceptions: count }) })),
        kept: (plan) => plan?.batchSchedule?.requestProtections?.facts.protectedControls[0]?.exceptOperations?.length,
    },
    {
        field: 'batchSchedule.requestProtections.resolvedTrackClauses',
        bound: BOUND,
        plan: withSchedule((count) => schedule(1, { requestProtections: protections({ clauses: count }) })),
        kept: (plan) => plan?.batchSchedule?.requestProtections?.resolvedTrackClauses.length,
    },
];

/** A string of exactly `bytes` UTF-8 bytes made of two-byte characters, so a character count cannot stand in for it. */
function textOfBytes(bytes: number): string {
    return 'é'.repeat(bytes / 2);
}

const byteRows: Array<PlanWithRow & { bound: number; write: (bytes: number) => AgentRunPlan }> = [
    {
        field: 'metricGoalState',
        bound: MAX_METRIC_GOAL_STATE_BYTES,
        write: (bytes) => ({ ...liveRun().plan, metricGoalState: textOfBytes(bytes) }),
        plan: () => liveRun().plan,
        kept: (plan) => plan?.metricGoalState?.length,
    },
    {
        field: 'batchSchedule.metricGoalState',
        bound: MAX_METRIC_GOAL_STATE_BYTES,
        write: (bytes) => ({
            ...liveRun().plan,
            batchSchedule: schedule(1, { metricGoalState: textOfBytes(bytes) }),
        }),
        plan: () => liveRun().plan,
        kept: (plan) => plan?.batchSchedule?.metricGoalState?.length,
    },
    {
        field: 'terminalMeasurementSettlement',
        bound: APPLICATION_TOOL_RECEIPT_MAX_BYTES,
        write: (bytes) => ({ ...liveRun().plan, terminalMeasurementSettlement: textOfBytes(bytes) }),
        plan: () => liveRun().plan,
        kept: (plan) => plan?.terminalMeasurementSettlement?.length,
    },
];

describe('restore-only bounds on agent run fields are checked when the run is written', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        createRun();
    });

    describe.each(collectionRows)('plan $field', ({ field, bound, plan, kept }) => {
        it('refuses one entry past the bound and keeps a run written at it across a reload', () => {
            const storedBefore = storedText();
            const overfull = planRecord(plan(bound + 1));

            expect(agentRunLifecycle.admitPlan(overfull)).toEqual({
                status: 'refused',
                reason: 'collection-bound',
                collection: field,
                bound,
            });
            expect(() => agentRunLifecycle.recordPlan(overfull)).toThrow(
                `the run's plan cannot hold more than ${String(bound)} entries in ${field}`
            );
            expect(storedText()).toBe(storedBefore);

            const atBound = planRecord(plan(bound));
            expect(agentRunLifecycle.admitPlan(atBound)).toBeNull();
            agentRunLifecycle.recordPlan(atBound);
            expect(kept(reloadedRun().plan)).toBe(kept(liveRun().plan));
            expect(kept(reloadedRun().plan)).toBe(bound);
        });
    });

    describe.each(byteRows)('plan $field', ({ field, bound, write, kept }) => {
        it('refuses a value past its byte bound and keeps one written at it across a reload', () => {
            const storedBefore = storedText();
            const oversized = planRecord(write(bound + 2));

            expect(agentRunLifecycle.admitPlan(oversized)).toEqual({
                status: 'refused',
                reason: 'field-bytes',
                collection: field,
                bound,
            });
            expect(() => agentRunLifecycle.recordPlan(oversized)).toThrow(
                `the run's plan cannot keep ${field} larger than ${String(bound)} bytes`
            );
            expect(storedText()).toBe(storedBefore);

            const atBound = planRecord(write(bound));
            expect(agentRunLifecycle.admitPlan(atBound)).toBeNull();
            agentRunLifecycle.recordPlan(atBound);
            expect(kept(reloadedRun().plan)).toBe(bound / 2);
        });
    });

    describe('run scope, grants and budgets recorded with the plan', () => {
        const scopeRows = [
            ['targetIds', (count: number) => ({ ...scope, targetIds: ids('track', count) })],
            ['protectedTargetIds', (count: number) => ({ ...scope, protectedTargetIds: ids('track', count) })],
            [
                'targetRanges',
                (count: number) => ({
                    ...scope,
                    targetRanges: Array.from({ length: count }, (_, index) => ({
                        startBeat: index,
                        endBeat: index + 1,
                    })),
                }),
            ],
            [
                'protectedRanges',
                (count: number) => ({
                    ...scope,
                    protectedRanges: Array.from({ length: count }, (_, index) => ({
                        startBeat: index,
                        endBeat: index + 1,
                    })),
                }),
            ],
        ] as const;

        it.each(scopeRows)('refuses run.scope.%s past the bound and keeps it at the bound', (name, build) => {
            const storedBefore = storedText();
            const { plan } = liveRun();
            const overfull = planRecord(plan, { scope: build(BOUND + 1) });

            expect(agentRunLifecycle.admitPlan(overfull)).toEqual({
                status: 'refused',
                reason: 'collection-bound',
                collection: `run.scope.${name}`,
                bound: BOUND,
            });
            expect(() => agentRunLifecycle.recordPlan(overfull)).toThrow(
                `the run cannot hold more than ${String(BOUND)} entries in run.scope.${name}`
            );
            expect(storedText()).toBe(storedBefore);

            agentRunLifecycle.recordPlan(planRecord(plan, { scope: build(BOUND) }));
            expect(reloadedRun().scope[name]).toHaveLength(BOUND);
        });

        it('refuses run.grants.allowedOperationPrefixes past the bound and keeps it at the bound', () => {
            const storedBefore = storedText();
            const { plan } = liveRun();
            const overfull = planRecord(plan, {
                grants: { ...grants, allowedOperationPrefixes: ids('project.', BOUND + 1) },
            });

            expect(agentRunLifecycle.admitPlan(overfull)).toEqual({
                status: 'refused',
                reason: 'collection-bound',
                collection: 'run.grants.allowedOperationPrefixes',
                bound: BOUND,
            });
            expect(() => agentRunLifecycle.recordPlan(overfull)).toThrow(
                `the run cannot hold more than ${String(BOUND)} entries in run.grants.allowedOperationPrefixes`
            );
            expect(storedText()).toBe(storedBefore);

            agentRunLifecycle.recordPlan(
                planRecord(plan, { grants: { ...grants, allowedOperationPrefixes: ids('project.', BOUND) } })
            );
            expect(reloadedRun().grants.allowedOperationPrefixes).toHaveLength(BOUND);
        });

        it.each(['limits', 'consumed'] as const)(
            'refuses run.budgets.%s past the bound on its keys and keeps it at the bound',
            (name) => {
                const storedBefore = storedText();
                const { plan, run } = liveRun();
                const held = Object.keys(run.budgets[name]).length;
                const keys = (count: number) =>
                    Object.fromEntries(ids('category', count - held).map((key) => [key, 1]));
                const record = (count: number) => ({
                    ...planRecord(plan),
                    budgets: { limits: {}, consumed: {}, [name]: keys(count) },
                });

                expect(agentRunLifecycle.admitPlan(record(BOUND + 1))).toEqual({
                    status: 'refused',
                    reason: 'collection-bound',
                    collection: `run.budgets.${name}`,
                    bound: BOUND,
                });
                expect(() => agentRunLifecycle.recordPlan(record(BOUND + 1))).toThrow(
                    `the run cannot hold more than ${String(BOUND)} entries in run.budgets.${name}`
                );
                expect(storedText()).toBe(storedBefore);

                agentRunLifecycle.recordPlan(record(BOUND));
                expect(Object.keys(reloadedRun().budgets[name])).toHaveLength(BOUND);
            }
        );
    });

    describe('budget attempts', () => {
        function attempts(count: number, from = 0) {
            return Array.from({ length: count }, (_, index) => ({
                attemptId: `attempt-${String(from + index)}`,
                category: 'remoteTokens',
                estimate: 1,
                provenance: 'versioned-estimate' as const,
            }));
        }

        it('refuses a reservation that would hold more attempts than the run reads back', () => {
            const storedBefore = storedText();

            expect(agentRunLifecycle.reserveBudgetBatch({ runId: RUN_ID, attempts: attempts(BOUND + 1) })).toEqual({
                status: 'hard-limit-reached',
                reason: 'budgetAttempts',
            });
            expect(storedText()).toBe(storedBefore);

            expect(agentRunLifecycle.reserveBudgetBatch({ runId: RUN_ID, attempts: attempts(BOUND) })).toEqual({
                status: 'reserved',
            });
            expect(reloadedRun().budgetAttempts).toHaveLength(BOUND);

            const storedFull = storedText();
            expect(agentRunLifecycle.reserveBudgetBatch({ runId: RUN_ID, attempts: attempts(1, BOUND) })).toEqual({
                status: 'hard-limit-reached',
                reason: 'budgetAttempts',
            });
            expect(storedText()).toBe(storedFull);
        });
    });

    describe('decision', () => {
        function decision(alternativeCount: number) {
            return {
                decisionId: 'decision-1',
                capabilitySchemaIdentity: 'schema-1',
                proposalIdentity: 'proposal-1',
                budgets,
                revision: 'revision-1',
                scope,
                grants,
                alternatives: ids('alternative', alternativeCount).map((id) => ({
                    id,
                    label: id,
                    changesAuthority: false,
                })),
                reason: 'Pick one.',
                selectedAlternativeId: null,
                resumeAttemptId: null,
            };
        }

        it('refuses alternatives past the bound and keeps a decision written at it across a reload', () => {
            const storedBefore = storedText();

            expect(() => agentRunLifecycle.recordDecision({ runId: RUN_ID, decision: decision(BOUND + 1) })).toThrow(
                `the run cannot hold more than ${String(BOUND)} entries in run.decision.alternatives`
            );
            expect(storedText()).toBe(storedBefore);

            agentRunLifecycle.recordDecision({ runId: RUN_ID, decision: decision(BOUND) });
            expect(reloadedRun().decision?.alternatives).toHaveLength(BOUND);
        });

        it('refuses a decision scope past the bound', () => {
            expect(() =>
                agentRunLifecycle.recordDecision({
                    runId: RUN_ID,
                    decision: { ...decision(1), scope: { ...scope, targetIds: ids('track', BOUND + 1) } },
                })
            ).toThrow(`the run cannot hold more than ${String(BOUND)} entries in run.decision.scope.targetIds`);
        });
    });

    describe('creation', () => {
        const CREATED_RUN_ID = 'created-past-bound-run';

        function create(targetCount: number) {
            return () =>
                agentRunLifecycle.create({
                    runId: CREATED_RUN_ID,
                    request: 'Brighten the vocal.',
                    mode: 'plan',
                    createdRevision: 'revision-1',
                    scope: { ...scope, targetIds: ids('track', targetCount) },
                });
        }

        it('refuses a run created with a scope past the bound and persists nothing', () => {
            const storedBefore = storedText();

            expect(create(BOUND + 1)).toThrow(
                `the run cannot hold more than ${String(BOUND)} entries in run.scope.targetIds`
            );
            expect(agentRunLifecycle.get(CREATED_RUN_ID)).toBeNull();
            expect(storedText()).toBe(storedBefore);
            expect(agentRunLifecycle.get(RUN_ID)?.runId).toBe(RUN_ID);
        });

        it('admits a run created with a scope at the bound', () => {
            expect(create(BOUND)()).toEqual({ status: 'created' });
            expect(agentRunLifecycle.get(CREATED_RUN_ID)?.scope.targetIds).toHaveLength(BOUND);
        });
    });
});
