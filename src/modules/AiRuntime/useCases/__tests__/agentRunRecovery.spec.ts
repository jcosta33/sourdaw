import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sanitizeAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { recoverInterruptedAgentRuns } from '../agentRunRecovery';
import { agentRunWorkLease } from '../agentRunWorkLease';

const {
    clear: clearAgentRuns,
    create: createAgentRun,
    get: getAgentRun,
    recordArtifact: recordAgentRunArtifact,
    recordBatch: recordAgentRunBatch,
    recordCommittedWork: recordAgentRunCommittedWork,
    recordPlan: recordAgentRunPlan,
    recordProviderUsage: recordAgentRunProviderUsage,
    registerTemporaryAsset: registerAgentRunTemporaryAsset,
} = agentRunLifecycle;
const { claim: claimAgentRunWorkLease } = agentRunWorkLease;

describe('agent run recovery', () => {
    beforeEach(() => {
        clearAgentRuns();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('persists a schema-versioned run and pauses orphaned work without losing committed truth', () => {
        createAgentRun({
            runId: 'run-recovery',
            request: 'Render the comparison, analyze it, then apply the chosen mix.',
            mode: 'macro',
            createdRevision: 'heads-a',
            createdAt: 100,
        });
        recordAgentRunPlan({
            runId: 'run-recovery',
            summary: 'Render, analyze, then apply one command batch.',
            commandIds: ['command-1'],
            serializedBatchIdentity: 'batch-sha-1',
            revision: 'heads-a',
            scope: {
                targetIds: ['track-1'],
                targetRanges: [{ startBeat: 16, endBeat: 32 }],
                protectedTargetIds: ['master'],
                protectedRanges: [],
            },
            grants: {
                allowedOperationPrefixes: ['setTrackGain'],
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
            budgets: { limits: { maxCommands: 1, maxRenderJobs: 1 }, consumed: { commands: 1 } },
            recordedAt: 105,
        });
        recordAgentRunBatch({
            runId: 'run-recovery',
            batch: {
                batchId: 'batch-1',
                commandIds: ['command-1'],
                status: 'executing',
                receiptIdentity: null,
            },
            recordedAt: 106,
        });
        recordAgentRunArtifact({
            runId: 'run-recovery',
            kind: 'render',
            artifact: { artifactId: 'render-1', workId: 'render-work', status: 'completed', summary: 'Chorus WAV' },
            recordedAt: 107,
        });
        recordAgentRunArtifact({
            runId: 'run-recovery',
            kind: 'analysis',
            artifact: { artifactId: 'analysis-1', workId: 'analysis-1', status: 'pending', summary: null },
            recordedAt: 108,
        });
        recordAgentRunProviderUsage({
            runId: 'run-recovery',
            usage: {
                provider: 'webllm',
                model: 'local-model',
                inputTokens: null,
                outputTokens: null,
                provenance: 'unavailable',
            },
            recordedAt: 109,
        });
        recordAgentRunCommittedWork({
            runId: 'run-recovery',
            workId: 'batch-committed',
            receiptIdentity: 'receipt-committed',
            revertGroupId: 'undo-group-1',
            renderJobIds: ['render-from-receipt'],
            analysisIds: ['analysis-from-receipt'],
            completesRun: false,
            committedAt: 110,
        });
        registerAgentRunTemporaryAsset({
            runId: 'run-recovery',
            assetId: 'render-preview.wav',
            kind: 'render',
            cleanupOwner: 'render-worker',
            createdAt: 120,
        });
        expect(
            claimAgentRunWorkLease({
                runId: 'run-recovery',
                workId: 'analysis-1',
                ownerKind: 'analysis',
                cleanupOwner: 'analysis-worker',
                idempotencyKey: 'analysis-key',
                receiptIdentity: 'analysis-receipt',
                idempotent: true,
                retriable: true,
                claimedAt: 130,
            }).status
        ).toBe('claimed');

        const recovered = recoverInterruptedAgentRuns({ recoveredAt: 200 });

        expect(recovered).toEqual({ recoveredRunIds: ['run-recovery'] });
        expect(getAgentRun('run-recovery')).toMatchObject({
            schemaVersion: 1,
            phase: 'paused',
            revisions: { created: 'heads-a', planned: 'heads-a' },
            scope: { targetIds: ['track-1'], protectedTargetIds: ['master'] },
            grants: { allowedOperationPrefixes: ['setTrackGain'] },
            budgets: { limits: { maxCommands: 1, maxRenderJobs: 1 }, consumed: { commands: 1 } },
            plan: { commandIds: ['command-1'], serializedBatchIdentity: 'batch-sha-1' },
            batches: [{ batchId: 'batch-1', status: 'executing' }],
            renders: [
                { artifactId: 'render-1', status: 'completed' },
                { artifactId: 'render-from-receipt', workId: 'batch-committed', status: 'completed' },
            ],
            analyses: [
                { artifactId: 'analysis-1', status: 'pending' },
                { artifactId: 'analysis-from-receipt', workId: 'batch-committed', status: 'completed' },
            ],
            providerUsage: [{ provider: 'webllm', provenance: 'unavailable' }],
            committedWork: [
                {
                    workId: 'batch-committed',
                    receiptIdentity: 'receipt-committed',
                    revertGroupId: 'undo-group-1',
                },
            ],
            manualResume: {
                required: true,
                reason: 'The application restarted before this run finished. Its exact continuation is unavailable; start a new run from the retained request and receipts.',
                workIds: ['analysis-1'],
            },
            temporaryAssets: [
                {
                    assetId: 'render-preview.wav',
                    cleanupOwner: 'render-worker',
                    status: 'cleanup-pending',
                },
            ],
            workLeases: [
                {
                    runId: 'run-recovery',
                    workId: 'analysis-1',
                    ownerKind: 'analysis',
                    cleanupOwner: 'analysis-worker',
                    idempotencyKey: 'analysis-key',
                    receiptIdentity: 'analysis-receipt',
                    terminalState: 'orphaned',
                },
            ],
        });

        const stored = window.localStorage.getItem('sourdaw-agent-runs');
        expect(stored).toContain('"schemaVersion":1');
        expect(stored).toContain('run-recovery');
    });

    it('leaves terminal runs unchanged during restart recovery', () => {
        createAgentRun({
            runId: 'run-complete',
            request: 'Explain the bridge.',
            mode: 'explain',
            createdRevision: 'heads-a',
            createdAt: 100,
        });
        recordAgentRunCommittedWork({
            runId: 'run-complete',
            workId: 'response',
            receiptIdentity: 'response-receipt',
            committedAt: 110,
        });

        expect(recoverInterruptedAgentRuns({ recoveredAt: 200 })).toEqual({ recoveredRunIds: [] });
        expect(getAgentRun('run-complete')?.phase).toBe('completed');
    });

    it('fails before work starts when the run cannot be persisted durably', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });

        expect(() =>
            createAgentRun({
                runId: 'run-not-durable',
                request: 'Apply this change.',
                mode: 'apply',
                createdRevision: 'heads-a',
                createdAt: 100,
            })
        ).toThrow('Agent run state could not be persisted locally');
    });

    it('rejects unsupported persisted schema versions instead of executing them as current runs', () => {
        expect(sanitizeAgentRunState({ schemaVersion: 2, runs: [{ runId: 'future-run' }] })).toEqual({
            schemaVersion: 1,
            runs: [],
        });
    });
});
