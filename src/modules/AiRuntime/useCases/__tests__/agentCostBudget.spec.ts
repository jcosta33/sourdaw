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
});
