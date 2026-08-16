import { beforeEach, describe, expect, it } from 'vitest';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunCancellation } from '../cancelAgentRun';
import { deleteAgentRunArtifacts } from '../deleteAgentRunArtifacts';

describe('deleteAgentRunArtifacts', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('deletes only owner-cleaned temporary resources while preserving durable run evidence', async () => {
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
                disclosure: {
                    requestId: 'request-artifacts',
                    categories: ['prompt-text', 'project-context'],
                    retention: {
                        applicationState: 'unknown',
                        abuseMonitoring: 'unknown',
                        promptCache: 'unknown',
                        safetyLegalException: 'unknown',
                        unknown: 'unknown',
                    },
                },
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
        agentRunCancellation.registerTemporaryAssetCleanup({
            runId: 'run-artifacts',
            assetId: 'render-preview.wav',
            cleanupOwner: 'render-worker',
            cleanup: () => undefined,
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

        await expect(deleteAgentRunArtifacts('run-artifacts')).resolves.toEqual({
            status: 'completed',
            deletedAssetIds: ['render-preview.wav'],
            failedAssetIds: [],
        });

        const after = agentRunLifecycle.get('run-artifacts');
        expect(after).toMatchObject({ temporaryAssets: [] });
        expect(after?.renders).toEqual(before?.renders);
        expect(after?.analyses).toEqual(before?.analyses);
        expect(after?.plan).toEqual(before?.plan);
        expect(after?.workLeases).toEqual(before?.workLeases);
        expect(after?.providerUsage).toEqual(before?.providerUsage);
        expect(after?.committedWork).toEqual(before?.committedWork);
    });

    it('retains failed and unowned resources for retry while deleting successful resources', async () => {
        agentRunLifecycle.create({
            runId: 'run-partial',
            request: 'Clean previews.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        for (const assetId of ['success.wav', 'retry.wav', 'unowned.wav']) {
            agentRunLifecycle.registerTemporaryAsset({
                runId: 'run-partial',
                assetId,
                kind: 'render',
                cleanupOwner: `${assetId}-owner`,
            });
        }
        agentRunCancellation.registerTemporaryAssetCleanup({
            runId: 'run-partial',
            assetId: 'success.wav',
            cleanupOwner: 'success.wav-owner',
            cleanup: () => undefined,
        });
        let shouldFail = true;
        agentRunCancellation.registerTemporaryAssetCleanup({
            runId: 'run-partial',
            assetId: 'retry.wav',
            cleanupOwner: 'retry.wav-owner',
            cleanup: () => {
                if (shouldFail) {
                    throw new Error('disk busy');
                }
            },
        });

        await expect(deleteAgentRunArtifacts('run-partial')).resolves.toEqual({
            status: 'partial',
            deletedAssetIds: ['success.wav'],
            failedAssetIds: ['retry.wav', 'unowned.wav'],
        });
        expect(agentRunLifecycle.get('run-partial')?.temporaryAssets.map((asset) => asset.assetId)).toEqual([
            'retry.wav',
            'unowned.wav',
        ]);

        shouldFail = false;
        await expect(deleteAgentRunArtifacts('run-partial')).resolves.toEqual({
            status: 'partial',
            deletedAssetIds: ['retry.wav'],
            failedAssetIds: ['unowned.wav'],
        });
        expect(agentRunLifecycle.get('run-partial')?.temporaryAssets.map((asset) => asset.assetId)).toEqual([
            'unowned.wav',
        ]);
    });
});
