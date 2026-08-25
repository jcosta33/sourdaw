import { beforeEach, describe, expect, it } from 'vitest';

import { agentRunLifecycle } from '../agentRunLifecycle';

describe('agentRunLifecycle', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('refuses to record a plan on a terminal run', () => {
        agentRunLifecycle.create({
            runId: 'run-cancelled',
            request: 'Play',
            mode: 'apply',
            createdRevision: 'revision-1',
            createdAt: 100,
        });
        agentRunLifecycle.transitionPhase({ runId: 'run-cancelled', phase: 'planning', revision: 'revision-1' });
        agentRunLifecycle.cancel({
            runId: 'run-cancelled',
            reason: 'Cancelled while provider planning completed.',
            requestedAt: 110,
        });

        expect(() =>
            agentRunLifecycle.recordPlan({
                runId: 'run-cancelled',
                summary: 'Toggle playback',
                commandIds: ['command-1'],
                serializedBatchIdentity: 'batch-key-1',
                revision: 'revision-1',
                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                grants: {
                    allowedOperationPrefixes: ['togglePlayback'],
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
                budgets: { limits: {}, consumed: {} },
                recordedAt: 120,
            })
        ).toThrow('Terminal agent run cannot record a plan');
        expect(agentRunLifecycle.get('run-cancelled')).toMatchObject({ phase: 'cancelled', plan: null });
    });
});
