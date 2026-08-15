import { beforeEach, describe, expect, it } from 'vitest';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { deleteAgentRunArtifacts } from '../deleteAgentRunArtifacts';

describe('deleteAgentRunArtifacts', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('deletes derived artifacts without deleting the run receipt, plan, lease, usage, or committed evidence', () => {
        agentRunLifecycle.create({
            runId: 'run-artifacts',
            request: 'Render then analyze the chorus.',
            mode: 'plan',
            createdRevision: 'revision-1',
            requestedRoute: 'cloud',
        });
        agentRunLifecycle.recordPlan({
            runId: 'run-artifacts',
            summary: 'Render the chorus.',
            commandIds: ['command-1'],
            serializedBatchIdentity: 'batch-1',
            revision: 'revision-1',
            scope: { targetIds: ['track-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            grants: {
                allowedOperationPrefixes: ['render'],
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
            budgets: { limits: { maxRenderJobs: 1 }, consumed: { commands: 1 } },
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'run-artifacts',
            usage: {
                provider: 'openai-compatible',
                model: 'fixture',
                inputTokens: 10,
                outputTokens: 2,
                provenance: 'provider-reported',
                routeId: 'cloud:openai-compatible:fixture',
                executor: 'cloud',
                fallbackReason: null,
            },
        });
        agentRunLifecycle.recordCommittedWork({
            runId: 'run-artifacts',
            workId: 'batch-1',
            receiptIdentity: 'receipt-1',
            renderJobIds: ['render-1'],
            analysisIds: ['analysis-1'],
            completesRun: false,
        });
        agentRunLifecycle.recordArtifact({
            runId: 'run-artifacts',
            kind: 'render',
            artifact: { artifactId: 'render-1', workId: 'render-work', status: 'completed', summary: 'Chorus WAV' },
        });
        agentRunLifecycle.recordArtifact({
            runId: 'run-artifacts',
            kind: 'analysis',
            artifact: { artifactId: 'analysis-1', workId: 'analysis-work', status: 'completed', summary: 'Loudness' },
        });
        agentRunLifecycle.registerTemporaryAsset({
            runId: 'run-artifacts',
            assetId: 'render-preview.wav',
            kind: 'render',
            cleanupOwner: 'render-worker',
        });
        expect(
            agentRunWorkLease.claim({
                runId: 'run-artifacts',
                workId: 'render-work',
                ownerKind: 'render',
                cleanupOwner: 'render-worker',
                idempotencyKey: 'render-key',
                receiptIdentity: 'render-receipt',
                idempotent: true,
                retriable: true,
            }).status
        ).toBe('claimed');
        const before = agentRunLifecycle.get('run-artifacts');

        deleteAgentRunArtifacts('run-artifacts');

        const after = agentRunLifecycle.get('run-artifacts');
        expect(after).toMatchObject({ renders: [], analyses: [], temporaryAssets: [] });
        expect(after?.plan).toEqual(before?.plan);
        expect(after?.workLeases).toEqual(before?.workLeases);
        expect(after?.providerUsage).toEqual(before?.providerUsage);
        expect(after?.committedWork).toEqual(before?.committedWork);
    });
});
