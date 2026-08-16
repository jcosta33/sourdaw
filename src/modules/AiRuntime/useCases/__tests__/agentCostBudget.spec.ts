import { beforeEach, describe, expect, it } from 'vitest';

import { agentRunLifecycle } from '../agentRunLifecycle';

describe('agent cost budget', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('reserves estimated work, reconciles cumulative and final usage once, and keeps the ceiling monotonic', () => {
        agentRunLifecycle.create({
            runId: 'budget-run',
            request: 'Analyze and render the chorus.',
            mode: 'macro',
            createdRevision: 'revision-a',
            budgets: { limits: { remoteTokens: 100, renderJobs: 1 }, consumed: {} },
        });

        expect(
            agentRunLifecycle.reserveBudget({
                runId: 'budget-run',
                attemptId: 'remote-1',
                category: 'remoteTokens',
                estimate: 10,
                provenance: 'versioned-estimate',
            })
        ).toMatchObject({ status: 'reserved' });

        agentRunLifecycle.reconcileBudgetAttempt({
            runId: 'budget-run',
            attemptId: 'remote-1',
            consumed: 5,
            mode: 'delta',
            provenance: 'provider-reported',
        });
        agentRunLifecycle.reconcileBudgetAttempt({
            runId: 'budget-run',
            attemptId: 'remote-1',
            consumed: 20,
            mode: 'final',
            provenance: 'provider-reported',
        });

        expect(agentRunLifecycle.get('budget-run')?.budgets.consumed).toEqual({ remoteTokens: 20 });
        expect(
            agentRunLifecycle.reserveBudget({
                runId: 'budget-run',
                attemptId: 'render-1',
                category: 'renderJobs',
                estimate: 2,
                provenance: 'versioned-estimate',
            })
        ).toMatchObject({ status: 'hard-limit-reached', reason: 'renderJobs' });
    });

    it('preserves already-reserved provider usage when the resulting plan records its own command budget', () => {
        agentRunLifecycle.create({
            runId: 'budget-plan-run',
            request: 'Plan a chorus render.',
            mode: 'plan',
            createdRevision: 'revision-a',
            budgets: { limits: { remoteTokens: 100, commands: 3 }, consumed: {} },
        });
        agentRunLifecycle.reserveBudget({
            runId: 'budget-plan-run',
            attemptId: 'remote-attempt',
            category: 'remoteTokens',
            estimate: 20,
            provenance: 'versioned-estimate',
        });

        agentRunLifecycle.recordPlan({
            runId: 'budget-plan-run',
            summary: 'Plan a chorus render.',
            commandIds: ['command-a'],
            serializedBatchIdentity: 'batch-a',
            revision: 'revision-a',
            scope: {
                targetIds: [],
                targetRanges: [],
                protectedTargetIds: [],
                protectedRanges: [],
            },
            grants: {
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
            },
            budgets: { limits: { commands: 1 }, consumed: { commands: 1 } },
        });

        expect(agentRunLifecycle.get('budget-plan-run')?.budgets).toEqual({
            limits: { remoteTokens: 100, commands: 1 },
            consumed: { remoteTokens: 20, commands: 1 },
        });
    });
});
