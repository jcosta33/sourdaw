import { beforeEach, describe, expect, it } from 'vitest';

import { agentRunStore, readAgentRunState } from '../../stores/agentRunStore';
import { selectAgentRunPendingEffectRecoveries } from '../../stores/selectAgentRunPendingEffectRecoveries';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { createAgentSagaStep } from '../createAgentSagaStep';

function createRenderReviewRun(): void {
    agentRunLifecycle.create({
        runId: 'run-render-review',
        request: 'Retain the warned render for review.',
        mode: 'macro',
        createdRevision: 'heads-render-review',
        createdAt: 1,
    });
    agentRunLifecycle.recordSagaStep({
        runId: 'run-render-review',
        step: createAgentSagaStep({
            stepId: 'effect:render-review',
            order: 0,
            owner: 'external-effect',
            workId: 'batch-render-review',
            receiptIdentity: '1:run-render-review:batch-render-review:partially-committed',
            state: 'external-pending',
            relatedArtifactIds: ['render-verse'],
            updatedAt: 2,
            compensationAvailable: false,
        }),
    });
    agentRunLifecycle.recordPendingEffectContinuation({
        runId: 'run-render-review',
        continuation: {
            authority: {
                projectId: 'project-render-review',
                baseRevision: 'heads-render-review',
                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                grants: {
                    allowedOperationPrefixes: ['renderProjectSections'],
                    create: false,
                    delete: false,
                    routing: false,
                    tempo: false,
                    master: false,
                    file: true,
                    audioUpload: false,
                    remoteGeneration: false,
                    autoCommit: true,
                },
                budgets: {
                    maxCommands: 1,
                    maxCreatedTracks: 0,
                    maxDeletedObjects: 0,
                    maxAffectedTracks: 0,
                    maxAffectedClips: 0,
                    maxAutomationPoints: 0,
                    maxImportedAssets: 0,
                    maxRenderJobs: 1,
                },
            },
            batchId: 'batch-render-review',
            effects: [
                {
                    commandId: 'command-render-review',
                    kind: 'external-effect',
                    operation: 'renderProjectSections',
                    reason: 'tail truncated',
                    remediation: 'reconcile',
                    state: 'pending',
                },
            ],
            lastError: null,
            receiptIdentity: '1:run-render-review:batch-render-review:partially-committed',
            recovery: 'reconcile-batch',
            serializedBatch: '{"batch":"render-review"}',
        },
        recordedAt: 2,
    });
}

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

    it('keeps a committed run partially completed while external saga work remains unsettled', () => {
        agentRunLifecycle.create({
            runId: 'run-unsettled-saga',
            request: 'Render the chorus.',
            mode: 'macro',
            createdRevision: 'revision-1',
            createdAt: 100,
        });
        agentRunLifecycle.recordSagaStep({
            runId: 'run-unsettled-saga',
            step: createAgentSagaStep({
                stepId: 'render:chorus',
                order: 0,
                owner: 'render',
                workId: 'render-chorus',
                receiptIdentity: 'receipt-chorus',
                state: 'external-pending',
                relatedArtifactIds: ['render-chorus'],
                updatedAt: 110,
                compensationAvailable: false,
            }),
        });

        agentRunLifecycle.recordCommittedWork({
            runId: 'run-unsettled-saga',
            workId: 'batch-chorus',
            receiptIdentity: 'receipt-chorus',
            committedAt: 120,
        });

        expect(agentRunLifecycle.get('run-unsettled-saga')).toMatchObject({ phase: 'partially-completed' });
    });

    it('atomically converts both durable continuation copies to manual repair', () => {
        createRenderReviewRun();

        expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([
            expect.objectContaining({
                recovery: 'manual-repair',
                lastError:
                    'Generic pending-effect recovery cannot execute receipt-bound section renders. The original confirmation is required and may be unavailable after reload.',
            }),
        ]);

        agentRunLifecycle.requirePendingEffectManualRepair({
            runId: 'run-render-review',
            batchId: 'batch-render-review',
            reason: 'The retained render has a truncated tail.',
            requiredAt: 3,
        });

        expect(agentRunLifecycle.get('run-render-review')?.pendingEffectContinuations).toEqual([
            expect.objectContaining({
                batchId: 'batch-render-review',
                recovery: 'manual-repair',
                lastError: 'The retained render has a truncated tail.',
                effects: [expect.objectContaining({ remediation: 'manual-repair' })],
            }),
        ]);
        expect(readAgentRunState().pendingEffectRecoveryLedger).toEqual([
            expect.objectContaining({
                runId: 'run-render-review',
                batchId: 'batch-render-review',
                checkpoint: 'durable',
                recovery: 'manual-repair',
                lastError: 'The retained render has a truncated tail.',
                effects: [expect.objectContaining({ remediation: 'manual-repair' })],
            }),
        ]);
        expect(agentRunLifecycle.get('run-render-review')?.saga.steps).toContainEqual(
            expect.objectContaining({
                owner: 'external-effect',
                workId: 'batch-render-review',
                state: 'manual-repair',
                updatedAt: 3,
            })
        );
        expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([
            expect.objectContaining({
                runId: 'run-render-review',
                batchId: 'batch-render-review',
                recovery: 'manual-repair',
                lastError: 'The retained render has a truncated tail.',
            }),
        ]);
    });

    it('rejects mixed pending effects without changing durable recovery state', () => {
        createRenderReviewRun();
        const recovery = agentRunLifecycle.getPendingEffectRecovery({
            runId: 'run-render-review',
            batchId: 'batch-render-review',
        });
        if (!recovery) {
            throw new Error('Expected render review recovery');
        }
        agentRunLifecycle.recordPendingEffectContinuation({
            runId: 'run-render-review',
            continuation: {
                ...recovery,
                effects: [
                    {
                        commandId: 'command-runtime-review',
                        kind: 'runtime-graph',
                        operation: 'setTrackGain',
                        reason: 'runtime graph unavailable',
                        remediation: 'repair',
                        state: 'pending',
                    },
                    {
                        commandId: 'command-render-review',
                        kind: 'external-effect',
                        operation: 'renderProjectSections',
                        reason: 'tail truncated',
                        remediation: 'reconcile',
                        state: 'pending',
                    },
                ],
            },
        });
        const before = readAgentRunState();

        expect(() =>
            agentRunLifecycle.requirePendingEffectManualRepair({
                runId: 'run-render-review',
                batchId: 'batch-render-review',
                reason: 'Manual review required.',
                requiredAt: 4,
            })
        ).toThrow('Pending effect continuation cannot be converted to manual repair');
        expect(readAgentRunState()).toEqual(before);
    });

    it.each([
        ['missing', undefined],
        ['prepared', 'prepared' as const],
    ])('refuses manual repair when the matching durable recovery copy is %s', (_label, checkpoint) => {
        createRenderReviewRun();
        const state = readAgentRunState();
        const recovery = state.pendingEffectRecoveryLedger?.[0];
        if (!recovery) {
            throw new Error('Expected pending effect recovery');
        }
        agentRunStore.set({
            ...state,
            pendingEffectRecoveryLedger: checkpoint ? [{ ...recovery, checkpoint }] : [],
        });
        const continuationBefore = agentRunLifecycle.get('run-render-review')?.pendingEffectContinuations;

        expect(() =>
            agentRunLifecycle.requirePendingEffectManualRepair({
                runId: 'run-render-review',
                batchId: 'batch-render-review',
                reason: 'The retained render has a truncated tail.',
            })
        ).toThrow('Unknown durable pending effect continuation: batch-render-review');
        expect(agentRunLifecycle.get('run-render-review')?.pendingEffectContinuations).toEqual(continuationBefore);
        expect(readAgentRunState().pendingEffectRecoveryLedger).toEqual(
            checkpoint ? [expect.objectContaining({ checkpoint: 'prepared', recovery: 'reconcile-batch' })] : []
        );
    });
});
