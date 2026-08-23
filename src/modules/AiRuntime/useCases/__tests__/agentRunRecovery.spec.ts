import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { recoverInterruptedAgentRuns } from '../agentRunRecovery';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { createAgentSagaStep } from '../createAgentSagaStep';

const commandRecoveryMocks = vi.hoisted(() => ({
    executeVersionedCommandBatchEnvelope: vi.fn(),
    getVersionedCommandBatchIdempotentReplay: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeVersionedCommandBatchEnvelope: commandRecoveryMocks.executeVersionedCommandBatchEnvelope,
    getVersionedCommandBatchIdempotentReplay: commandRecoveryMocks.getVersionedCommandBatchIdempotentReplay,
}));

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

function createContinuationAuthority() {
    return {
        projectId: 'project-runtime-recovery',
        baseRevision: 'heads-runtime-base',
        scope: {
            targetIds: ['track-runtime'],
            targetRanges: [{ startBeat: 8, endBeat: 8 }],
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
            autoCommit: true,
        },
        budgets: {
            maxCommands: 2,
            maxCreatedTracks: 0,
            maxDeletedObjects: 0,
            maxAffectedTracks: 1,
            maxAffectedClips: 0,
            maxAutomationPoints: 0,
            maxImportedAssets: 0,
            maxRenderJobs: 0,
        },
    };
}

type RecoveryPendingEffect = {
    commandId: string;
    operation: string;
    reason: string;
    state: 'pending';
} & (
    | { kind: 'runtime-graph'; remediation: 'retry' | 'repair' }
    | { kind: 'external-effect'; remediation: 'reconcile' | 'manual-repair' }
);

function createPendingEffectRecoveryReceipt(input: {
    batchId: string;
    pendingEffects: readonly RecoveryPendingEffect[];
    outcome: 'partially-committed' | 'committed';
}) {
    return {
        schemaVersion: 1,
        runId: 'run-persisted-runtime-effects',
        batchId: input.batchId,
        outcome: input.outcome,
        pendingEffects: input.outcome === 'partially-committed' ? [...input.pendingEffects] : [],
    };
}

describe('agent run recovery', () => {
    beforeEach(() => {
        commandRecoveryMocks.executeVersionedCommandBatchEnvelope.mockReset();
        commandRecoveryMocks.getVersionedCommandBatchIdempotentReplay.mockReset();
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

    it('hydrates generic-only, mixed, and manual pending-effect continuations after restart', async () => {
        createAgentRun({
            runId: 'run-persisted-runtime-effects',
            request: 'Recover the persisted runtime follow-up effects.',
            mode: 'apply',
            createdRevision: 'heads-runtime-base',
            createdAt: 100,
        });
        agentRunLifecycle.transitionPhase({
            runId: 'run-persisted-runtime-effects',
            phase: 'planning',
            revision: 'heads-runtime-base',
            transitionedAt: 101,
        });
        agentRunLifecycle.transitionPhase({
            runId: 'run-persisted-runtime-effects',
            phase: 'executing',
            revision: 'heads-runtime-base',
            transitionedAt: 102,
        });

        const continuationAuthority = createContinuationAuthority();
        const continuations = [
            {
                batchId: 'batch-generic-effect',
                effects: [
                    {
                        commandId: 'command-generic-effect',
                        kind: 'external-effect' as const,
                        operation: 'setTrackGain',
                        reason: 'publication queue unavailable',
                        remediation: 'reconcile' as const,
                        state: 'pending' as const,
                    },
                ],
                recovery: 'reconcile-batch' as const,
                serializedBatch: '{"batch":"generic-effect"}',
            },
            {
                batchId: 'batch-mixed-effects',
                effects: [
                    {
                        commandId: 'command-repair-runtime',
                        kind: 'runtime-graph' as const,
                        operation: 'setTrackGain',
                        reason: 'runtime graph revision is stale',
                        remediation: 'repair' as const,
                        state: 'pending' as const,
                    },
                    {
                        commandId: 'command-reconcile-generic',
                        kind: 'external-effect' as const,
                        operation: 'setTrackPan',
                        reason: 'publication queue unavailable',
                        remediation: 'reconcile' as const,
                        state: 'pending' as const,
                    },
                ],
                recovery: 'reconcile-batch' as const,
                serializedBatch: '{"batch":"mixed-effects"}',
            },
            {
                batchId: 'batch-manual-effect',
                effects: [
                    {
                        commandId: 'command-manual-effect',
                        kind: 'external-effect' as const,
                        operation: 'renderProjectSections',
                        reason: 'the external renderer cannot prove an exact retry',
                        remediation: 'manual-repair' as const,
                        state: 'pending' as const,
                    },
                ],
                recovery: 'manual-repair' as const,
                serializedBatch: '{"batch":"manual-effect"}',
            },
        ];
        for (const [index, continuation] of continuations.entries()) {
            for (const [effectIndex, effect] of continuation.effects.entries()) {
                agentRunLifecycle.recordSagaStep({
                    runId: 'run-persisted-runtime-effects',
                    step: createAgentSagaStep({
                        stepId: `effect:${continuation.batchId}:${effect.commandId}`,
                        order: index * 2 + effectIndex,
                        owner: 'external-effect',
                        workId: continuation.batchId,
                        receiptIdentity: `1:run-persisted-runtime-effects:${continuation.batchId}:partially-committed`,
                        state: 'external-pending',
                        relatedArtifactIds: [],
                        updatedAt: 110 + index,
                        compensationAvailable: false,
                    }),
                });
            }
            agentRunLifecycle.recordPendingEffectContinuation({
                runId: 'run-persisted-runtime-effects',
                continuation: {
                    authority: structuredClone(continuationAuthority),
                    batchId: continuation.batchId,
                    effects: structuredClone(continuation.effects),
                    lastError: null,
                    recovery: continuation.recovery,
                    receiptIdentity: `1:run-persisted-runtime-effects:${continuation.batchId}:partially-committed`,
                    serializedBatch: continuation.serializedBatch,
                },
                recordedAt: 120 + index,
            });
        }

        const persistedBytes = window.localStorage.getItem('sourdaw-agent-runs');
        expect(persistedBytes).toContain('"pendingEffectContinuations"');
        expect(persistedBytes).toContain('"kind":"external-effect"');
        expect(persistedBytes).toContain('"kind":"runtime-graph"');
        expect(persistedBytes).toContain('"recovery":"reconcile-batch"');
        expect(persistedBytes).toContain('"startBeat":8');
        expect(persistedBytes).toContain('"endBeat":8');

        vi.resetModules();

        const replayBySerializedBatch = new Map(
            continuations.map((continuation) => [
                continuation.serializedBatch,
                createPendingEffectRecoveryReceipt({
                    batchId: continuation.batchId,
                    pendingEffects: continuation.effects,
                    outcome: 'partially-committed',
                }),
            ])
        );
        commandRecoveryMocks.getVersionedCommandBatchIdempotentReplay.mockImplementation(
            async ({ serialized }: { serialized: string }) => replayBySerializedBatch.get(serialized) ?? null
        );
        commandRecoveryMocks.executeVersionedCommandBatchEnvelope.mockImplementation(
            async ({ serialized }: { serialized: string }) => {
                const pendingReceipt = replayBySerializedBatch.get(serialized);
                if (pendingReceipt === undefined) {
                    return { status: 'rejected' as const, reason: 'unknown test batch', actions: [] };
                }
                return {
                    status: 'idempotent-replay' as const,
                    actions: [],
                    receipt: createPendingEffectRecoveryReceipt({
                        batchId: pendingReceipt.batchId,
                        pendingEffects: [],
                        outcome: 'committed',
                    }),
                };
            }
        );

        const { agentRunLifecycle: hydratedAgentRunLifecycle } = await import('../agentRunLifecycle');
        const { recoverInterruptedAgentRuns: recoverHydratedAgentRuns } = await import('../agentRunRecovery');
        const { recoverAgentRunPendingEffects } = await import('../recoverAgentRunPendingEffects');

        expect(recoverHydratedAgentRuns({ recoveredAt: 200 })).toEqual({
            recoveredRunIds: ['run-persisted-runtime-effects'],
        });
        expect(hydratedAgentRunLifecycle.get('run-persisted-runtime-effects')).toMatchObject({
            phase: 'partially-completed',
            manualResume: { required: false, workIds: [] },
            pendingEffectContinuations: [
                {
                    batchId: 'batch-generic-effect',
                    effects: [expect.objectContaining({ kind: 'external-effect', remediation: 'reconcile' })],
                    recovery: 'reconcile-batch',
                    serializedBatch: '{"batch":"generic-effect"}',
                    authority: {
                        projectId: 'project-runtime-recovery',
                        scope: { targetRanges: [{ startBeat: 8, endBeat: 8 }] },
                        budgets: { maxCommands: 2, maxAffectedTracks: 1 },
                    },
                    lastError: null,
                },
                {
                    batchId: 'batch-mixed-effects',
                    effects: [
                        expect.objectContaining({ kind: 'runtime-graph', remediation: 'repair' }),
                        expect.objectContaining({ kind: 'external-effect', remediation: 'reconcile' }),
                    ],
                    recovery: 'reconcile-batch',
                    serializedBatch: '{"batch":"mixed-effects"}',
                },
                {
                    batchId: 'batch-manual-effect',
                    effects: [expect.objectContaining({ kind: 'external-effect', remediation: 'manual-repair' })],
                    recovery: 'manual-repair',
                    serializedBatch: '{"batch":"manual-effect"}',
                },
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ workId: 'batch-generic-effect', state: 'external-pending' }),
                    expect.objectContaining({ workId: 'batch-mixed-effects', state: 'external-pending' }),
                    expect.objectContaining({ workId: 'batch-manual-effect', state: 'external-pending' }),
                ]),
            },
        });

        await expect(
            recoverAgentRunPendingEffects({
                runId: 'run-persisted-runtime-effects',
                batchId: 'batch-generic-effect',
            })
        ).resolves.toEqual({ status: 'recovered' });
        await expect(
            recoverAgentRunPendingEffects({
                runId: 'run-persisted-runtime-effects',
                batchId: 'batch-mixed-effects',
            })
        ).resolves.toEqual({ status: 'recovered' });
        await expect(
            recoverAgentRunPendingEffects({
                runId: 'run-persisted-runtime-effects',
                batchId: 'batch-manual-effect',
            })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'At least one retained external effect requires manual repair and cannot be retried exactly.',
        });

        expect(commandRecoveryMocks.getVersionedCommandBatchIdempotentReplay).toHaveBeenCalledTimes(3);
        expect(commandRecoveryMocks.executeVersionedCommandBatchEnvelope).toHaveBeenCalledTimes(2);
        expect(commandRecoveryMocks.executeVersionedCommandBatchEnvelope).toHaveBeenNthCalledWith(1, {
            authority: continuationAuthority,
            serialized: '{"batch":"generic-effect"}',
        });
        expect(commandRecoveryMocks.executeVersionedCommandBatchEnvelope).toHaveBeenNthCalledWith(2, {
            authority: continuationAuthority,
            serialized: '{"batch":"mixed-effects"}',
        });
        expect(hydratedAgentRunLifecycle.get('run-persisted-runtime-effects')).toMatchObject({
            phase: 'partially-completed',
            manualResume: { required: false, workIds: [] },
            pendingEffectContinuations: [
                {
                    batchId: 'batch-manual-effect',
                    recovery: 'manual-repair',
                    lastError:
                        'At least one retained external effect requires manual repair and cannot be retried exactly.',
                },
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({
                        workId: 'batch-generic-effect',
                        receiptIdentity: '1:run-persisted-runtime-effects:batch-generic-effect:committed',
                        state: 'committed',
                    }),
                    expect.objectContaining({
                        workId: 'batch-mixed-effects',
                        receiptIdentity: '1:run-persisted-runtime-effects:batch-mixed-effects:committed',
                        state: 'committed',
                    }),
                    expect.objectContaining({
                        workId: 'batch-manual-effect',
                        state: 'external-pending',
                    }),
                ]),
            },
        });
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

    it('orphans live work and schedules asset cleanup for an already-paused run after restart', () => {
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

        expect(recoverInterruptedAgentRuns({ recoveredAt: 200 })).toEqual({
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
