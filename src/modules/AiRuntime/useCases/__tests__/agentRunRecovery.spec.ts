import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAgentRunState } from '../../stores/agentRunStore';
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

    it('persists a schema-versioned run and pauses orphaned work without losing committed truth', async () => {
        createAgentRun({
            runId: 'run-recovery',
            request: 'Render the comparison, analyze it, then apply the chosen mix.',
            mode: 'macro',
            createdRevision: 'heads-a',
            requestedRoute: 'auto',
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
                cachedInputTokens: null,
                provenance: 'unavailable',
                routeId: 'webllm:webllm:local-model',
                executor: 'webllm',
                fallbackReason: null,
                disclosure: {
                    requestId: 'request-recovery',
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

        const recovered = await recoverInterruptedAgentRuns({ recoveredAt: 200 });

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
            modelRoute: {
                requestedRoute: 'auto',
                selectedRouteId: 'webllm:webllm:local-model',
            },
            providerUsage: [
                {
                    attempt: 1,
                    provider: 'webllm',
                    provenance: 'unavailable',
                    routeId: 'webllm:webllm:local-model',
                    disclosure: {
                        requestId: 'request-recovery',
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
            ],
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
        expect(stored).toContain('webllm:webllm:local-model');

        vi.resetModules();
        const { agentRunStore: hydratedAgentRunStore } = await import('../../stores/agentRunStore');
        expect(hydratedAgentRunStore.value?.runs[0]?.providerUsage[0]?.cachedInputTokens).toBeNull();
        expect(hydratedAgentRunStore.value?.runs[0]?.providerUsage[0]?.disclosure).toEqual({
            requestId: 'request-recovery',
            categories: ['prompt-text', 'project-context'],
            retention: {
                applicationState: 'unknown',
                abuseMonitoring: 'unknown',
                promptCache: 'unknown',
                safetyLegalException: 'unknown',
                unknown: 'unknown',
            },
        });
    });

    it('leaves terminal runs unchanged during restart recovery', async () => {
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

        await expect(recoverInterruptedAgentRuns({ recoveredAt: 200 })).resolves.toEqual({ recoveredRunIds: [] });
        expect(getAgentRun('run-complete')?.phase).toBe('completed');
    });

    it('hydrates retired local-provider evidence without restoring an executable route', async () => {
        createAgentRun({
            runId: 'retired-provider-run',
            request: 'Keep the historical completion evidence.',
            mode: 'explain',
            createdRevision: 'heads-history',
            requestedRoute: 'webllm',
            createdAt: 100,
        });
        recordAgentRunProviderUsage({
            runId: 'retired-provider-run',
            usage: {
                attempt: 2,
                provider: 'webllm',
                model: 'browser-model',
                inputTokens: 12,
                outputTokens: 24,
                provenance: 'provider-reported',
            },
            recordedAt: 101,
        });
        const existingRun = readAgentRunState().runs[0];
        if (existingRun === undefined) {
            throw new Error('Expected the persisted AgentRun fixture to contain its created run');
        }
        const persistedFixture: unknown = {
            ...readAgentRunState(),
            runs: [
                {
                    ...existingRun,
                    modelRoute: {
                        requestedRoute: 'native',
                        selectedRouteId: 'native:retired-model',
                    },
                    providerUsage: [
                        {
                            attempt: 2,
                            provider: 'native',
                            model: 'retired-model',
                            inputTokens: 12,
                            outputTokens: 24,
                            cachedInputTokens: 3,
                            provenance: 'provider-reported',
                            correlationId: 'legacy-correlation',
                            status: 'failed',
                            retryable: false,
                            partialOutputDisposition: 'preserve',
                            routeId: 'native:retired-model',
                            executor: 'native',
                            fallbackReason: 'historical route',
                            disclosure: {
                                requestId: 'legacy-request',
                                categories: ['prompt-text'],
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
                },
            ],
        };
        window.localStorage.setItem('sourdaw-agent-runs', stringify(persistedFixture));

        vi.resetModules();
        const { agentRunStore: hydratedAgentRunStore } = await import('../../stores/agentRunStore');

        expect(hydratedAgentRunStore.value).toMatchObject({
            runs: [
                {
                    runId: 'retired-provider-run',
                    modelRoute: {
                        requestedRoute: 'legacy-unknown',
                        selectedRouteId: 'native:retired-model',
                    },
                    providerUsage: [
                        {
                            attempt: 2,
                            provider: 'native',
                            model: 'retired-model',
                            inputTokens: 12,
                            outputTokens: 24,
                            cachedInputTokens: 3,
                            provenance: 'provider-reported',
                            correlationId: 'legacy-correlation',
                            status: 'failed',
                            retryable: false,
                            partialOutputDisposition: 'preserve',
                            routeId: 'native:retired-model',
                            executor: 'legacy-unknown',
                            fallbackReason: 'historical route',
                            disclosure: {
                                requestId: 'legacy-request',
                                categories: ['prompt-text'],
                            },
                        },
                    ],
                },
            ],
        });
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

    it('orphans live work and schedules asset cleanup for an already-paused run after restart', async () => {
        createAgentRun({
            runId: 'run-paused-with-live-work',
            request: 'Resume the analysis after approval.',
            mode: 'macro',
            createdRevision: 'heads-a',
            createdAt: 100,
        });
        agentRunLifecycle.transitionPhase({
            runId: 'run-paused-with-live-work',
            phase: 'planning',
            revision: 'heads-a',
            transitionedAt: 101,
        });
        expect(
            claimAgentRunWorkLease({
                runId: 'run-paused-with-live-work',
                workId: 'analysis-1',
                ownerKind: 'analysis',
                cleanupOwner: 'analysis-worker',
                idempotencyKey: 'analysis-key',
                receiptIdentity: 'analysis-receipt',
                idempotent: true,
                retriable: true,
                claimedAt: 102,
            }).status
        ).toBe('claimed');
        registerAgentRunTemporaryAsset({
            runId: 'run-paused-with-live-work',
            assetId: 'analysis-input.wav',
            kind: 'analysis',
            cleanupOwner: 'analysis-worker',
            createdAt: 103,
        });
        agentRunLifecycle.requireManualResume({
            runId: 'run-paused-with-live-work',
            reason: 'Waiting for a manual choice.',
            workIds: ['analysis-1'],
            requiredAt: 104,
        });

        await expect(recoverInterruptedAgentRuns({ recoveredAt: 200 })).resolves.toEqual({
            recoveredRunIds: ['run-paused-with-live-work'],
        });
        expect(getAgentRun('run-paused-with-live-work')).toMatchObject({
            phase: 'paused',
            workLeases: [{ workId: 'analysis-1', terminalState: 'orphaned', settledAt: 200 }],
            temporaryAssets: [{ assetId: 'analysis-input.wav', status: 'cleanup-pending' }],
            manualResume: {
                required: true,
                workIds: ['analysis-1'],
                reason: expect.stringContaining('restarted'),
                requiredAt: 200,
            },
        });
    });

    it('keeps a supported persisted schema writable after hydration', async () => {
        window.localStorage.setItem('sourdaw-agent-runs', stringify({ schemaVersion: 1, runs: [] }));

        vi.resetModules();
        const { agentRunLifecycle: hydratedAgentRunLifecycle } = await import('../agentRunLifecycle');

        expect(() =>
            hydratedAgentRunLifecycle.create({
                runId: 'current-build-run',
                request: 'Run from the current build.',
                mode: 'apply',
                createdRevision: 'heads-current',
            })
        ).not.toThrow();
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toContain('current-build-run');
    });

    it('rejects unsupported persisted schema versions without overwriting their bytes', async () => {
        const futureState = { schemaVersion: 2, runs: [{ runId: 'future-run', futureReceipt: 'receipt-v2' }] };
        const rawFutureState = stringify(futureState);
        window.localStorage.setItem('sourdaw-agent-runs', rawFutureState);

        vi.resetModules();
        const { agentRunStore: futureAgentRunStore } = await import('../../stores/agentRunStore');
        const { agentRunLifecycle: futureAgentRunLifecycle } = await import('../agentRunLifecycle');

        expect(futureAgentRunStore.value).toEqual({
            schemaVersion: 1,
            runs: [],
        });
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toBe(rawFutureState);
        expect(() =>
            futureAgentRunLifecycle.create({
                runId: 'older-build-run',
                request: 'Run from the older build.',
                mode: 'apply',
                createdRevision: 'heads-old',
            })
        ).toThrow('Agent run state could not be persisted locally');
        expect(futureAgentRunStore.value).toEqual({ schemaVersion: 1, runs: [] });
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toBe(rawFutureState);
    });
});
