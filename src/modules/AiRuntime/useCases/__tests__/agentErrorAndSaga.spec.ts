import { beforeEach, describe, expect, it } from 'vitest';

import { admitAgentRetry } from '../admitAgentRetry';
import { admitBoundedAgentCorrection } from '../admitBoundedAgentCorrection';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { recoverInterruptedAgentRuns } from '../agentRunRecovery';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { createAgentSagaStep } from '../createAgentSagaStep';
import { getAgentRunSagaProjection } from '../getAgentRunSagaProjection';

describe('agent error and saga contract', () => {
    beforeEach(() => agentRunLifecycle.clear());

    it.each([
        'schema',
        'authorization',
        'resolution',
        'conflict',
        'project',
        'device',
        'plugin',
        'asset',
        'render',
        'analysis',
        'provider',
        'network',
        'budget',
        'cancellation',
        'internal',
    ] as const)('normalizes %s without leaking cause content', (category) => {
        const error = normalizeAgentFailure({
            category,
            source: 'provider-planning',
            related: { commandIds: ['command-1'], targetIds: ['track-1'], workIds: ['work-1'] },
            knownDomain: category !== 'internal',
        });
        expect(error).toMatchObject({
            code: `agent.${category}`,
            category,
            workId: 'work-1',
            related: { commandIds: ['command-1'], targetIds: ['track-1'] },
        });
        expect(error.message).not.toContain('provider-planning');
    });

    it('admits only reads and owner-proven idempotent writes, and stops correction on any boundary change', () => {
        expect(
            admitAgentRetry({
                operation: 'read',
                ownerProvesIdempotent: false,
                cancellationRequested: false,
                stale: false,
            })
        ).toBe('read-only');
        expect(
            admitAgentRetry({
                operation: 'write',
                ownerProvesIdempotent: true,
                cancellationRequested: false,
                stale: false,
            })
        ).toBe('owner-proven-idempotent');
        expect(
            admitAgentRetry({
                operation: 'write',
                ownerProvesIdempotent: false,
                cancellationRequested: false,
                stale: false,
            })
        ).toBe('never');
        expect(
            admitBoundedAgentCorrection({
                attempt: 1,
                maxAttempts: 2,
                reservedBudgetAvailable: true,
                cancellationRequested: false,
                stale: false,
                sameRevision: true,
                sameScope: true,
                sameGrants: true,
            })
        ).toBe(true);
        expect(
            admitBoundedAgentCorrection({
                attempt: 2,
                maxAttempts: 2,
                reservedBudgetAvailable: true,
                cancellationRequested: false,
                stale: false,
                sameRevision: true,
                sameScope: true,
                sameGrants: true,
            })
        ).toBe(false);
        expect(
            admitBoundedAgentCorrection({
                attempt: 0,
                maxAttempts: 2,
                reservedBudgetAvailable: true,
                cancellationRequested: false,
                stale: false,
                sameRevision: true,
                sameScope: false,
                sameGrants: true,
            })
        ).toBe(false);
    });

    it('persists and recovers every committed or uncompensated external step without a false clean success', () => {
        agentRunLifecycle.create({
            runId: 'run-saga',
            request: 'Render and analyze.',
            mode: 'macro',
            createdRevision: 'heads-a',
            createdAt: 1,
        });
        agentRunLifecycle.recordSagaStep({
            runId: 'run-saga',
            step: createAgentSagaStep({
                stepId: 'command:1',
                order: 0,
                owner: 'command',
                workId: 'command-1',
                receiptIdentity: 'receipt-1',
                state: 'committed',
                relatedArtifactIds: [],
                updatedAt: 2,
                compensationAvailable: true,
            }),
        });
        agentRunLifecycle.recordSagaStep({
            runId: 'run-saga',
            step: createAgentSagaStep({
                stepId: 'render:1',
                order: 1,
                owner: 'render',
                workId: 'render-1',
                receiptIdentity: 'receipt-1',
                state: 'external-pending',
                relatedArtifactIds: ['render-1'],
                updatedAt: 2,
                compensationAvailable: false,
            }),
        });
        expect(
            agentRunWorkLease.claim({
                runId: 'run-saga',
                workId: 'render-1',
                ownerKind: 'render',
                cleanupOwner: 'renderer',
                idempotencyKey: 'render-1',
                receiptIdentity: 'receipt-1',
                idempotent: false,
                retriable: true,
                operation: 'write',
            }).status
        ).toBe('claimed');

        expect(recoverInterruptedAgentRuns({ recoveredAt: 3 })).toEqual({ recoveredRunIds: ['run-saga'] });
        expect(getAgentRunSagaProjection('run-saga')).toMatchObject([
            { stepId: 'command:1', state: 'committed', receiptIdentity: 'receipt-1' },
            { stepId: 'render:1', state: 'manual-repair', compensation: { available: false } },
        ]);
        expect(agentRunLifecycle.get('run-saga')).toMatchObject({
            phase: 'paused',
            errors: [{ code: 'agent.internal', remediation: { compensation: 'manual-repair' } }],
        });
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toContain('"saga"');
    });
});
