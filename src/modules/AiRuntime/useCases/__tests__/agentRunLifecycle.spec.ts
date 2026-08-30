import { parse as parsePersistedValue } from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AgentRun, type AgentRunPendingEffect } from '../../models/AgentRun';
import { MISSING_EXACT_CHECKPOINT_RECOVERY_REASON } from '../../models/GetPendingEffectRecoveryPolicy';
import { agentRunStore, readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import * as pendingActionConfirmationStore from '../../stores/pendingActionConfirmationStore';
import { selectAgentRunPendingEffectRecoveries } from '../../stores/selectAgentRunPendingEffectRecoveries';
import { requireSectionRenderManualRepair } from '../agentRequestOrchestration/requireSectionRenderManualRepair';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { createAgentSagaStep } from '../createAgentSagaStep';

/**
 * Seed the store the way a reload does — persisted bytes, parsed, then through
 * the same sanitizer. `agentRunStore.hydrate()` cannot stand in for it: the
 * local-storage adapter exposes no `hydrate`, so that call is inert and the
 * store would keep whatever `clear()` last wrote.
 */
function reloadPersistedAgentRun(serializedState: string, runId: string): AgentRun | undefined {
    const reloaded = sanitizeAgentRunState(parsePersistedValue(serializedState));
    if (!agentRunStore.trySet(reloaded)) {
        throw new Error('Expected the reloaded agent run state to be accepted.');
    }
    return reloaded.runs.find((run) => run.runId === runId);
}

type VerifiedPendingEffects = NonNullable<
    Parameters<typeof requireSectionRenderManualRepair>[0]['missingEffects']
>['existingEffects'];

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

    it('retries persistence from the exact live settled continuation after a local storage refusal', () => {
        createRenderReviewRun();
        const receiptIdentity = '1:run-render-review:batch-render-review:committed';
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });

        expect(() =>
            agentRunLifecycle.completePendingEffectContinuation({
                runId: 'run-render-review',
                batchId: 'batch-render-review',
                receiptIdentity,
                completedAt: 3,
            })
        ).toThrow('could not be persisted locally');

        expect(agentRunLifecycle.get('run-render-review')).toMatchObject({
            pendingEffectContinuations: [],
            receipts: [{ workId: 'batch-render-review', receiptIdentity }],
            committedWork: [{ workId: 'batch-render-review', receiptIdentity }],
            batches: [{ batchId: 'batch-render-review', status: 'committed', receiptIdentity }],
            saga: {
                steps: [
                    expect.objectContaining({ workId: 'batch-render-review', state: 'committed', receiptIdentity }),
                ],
            },
        });

        setItem.mockRestore();
        expect(() =>
            agentRunLifecycle.completePendingEffectContinuation({
                runId: 'run-render-review',
                batchId: 'batch-render-review',
                receiptIdentity,
                completedAt: 4,
            })
        ).not.toThrow();
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toContain(receiptIdentity);
    });

    it('keeps non-render pending effect recoveries in the generic projection', () => {
        createRenderReviewRun();
        const state = structuredClone(readAgentRunState());
        const continuation = state.runs[0]?.pendingEffectContinuations[0];
        const durableRecovery = state.pendingEffectRecoveryLedger?.[0];
        if (!continuation || !durableRecovery) {
            throw new Error('Expected durable pending effect recovery');
        }
        continuation.effects[0] = { ...continuation.effects[0]!, operation: 'setTrackGain' };
        durableRecovery.effects[0] = { ...durableRecovery.effects[0]!, operation: 'setTrackGain' };
        // The recorded reason is stamped from the effects it was recorded with,
        // and the projection prefers it over the policy. Clearing it is what
        // makes this a genuine non-render continuation rather than a render one
        // still carrying the render reason.
        continuation.lastError = null;
        durableRecovery.lastError = null;

        expect(selectAgentRunPendingEffectRecoveries(state)).toEqual([
            expect.objectContaining({
                recovery: 'manual-repair',
                lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            }),
        ]);
    });

    it('does not hide a retryable confirmation for a runtime-graph effect that only shares the render operation name', () => {
        createRenderReviewRun();
        const state = structuredClone(readAgentRunState());
        const continuation = state.runs[0]?.pendingEffectContinuations[0];
        const durableRecovery = state.pendingEffectRecoveryLedger?.[0];
        if (!continuation || !durableRecovery) {
            throw new Error('Expected durable pending effect recovery');
        }
        continuation.effects[0] = {
            ...continuation.effects[0]!,
            kind: 'runtime-graph',
            remediation: 'repair',
        };
        durableRecovery.effects[0] = {
            ...durableRecovery.effects[0]!,
            kind: 'runtime-graph',
            remediation: 'repair',
        };
        continuation.lastError = null;
        durableRecovery.lastError = null;
        const retryableFollowUp = vi
            .spyOn(pendingActionConfirmationStore, 'hasRetryableSectionRenderFollowUp')
            .mockReturnValue(true);

        expect(selectAgentRunPendingEffectRecoveries(state)).toEqual([
            expect.objectContaining({
                effects: [expect.objectContaining({ kind: 'runtime-graph', operation: 'renderProjectSections' })],
                recovery: 'manual-repair',
                lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            }),
        ]);

        retryableFollowUp.mockRestore();
    });

    it('hides an executed retryable confirmation that owns the exact retained section-render continuation', () => {
        createRenderReviewRun();
        agentRunLifecycle.recordCommittedWork({
            runId: 'run-render-review',
            workId: 'batch-render-review',
            receiptIdentity: '1:run-render-review:batch-render-review:partially-committed',
            committedRevision: 'heads-render-review',
            completesRun: false,
        });
        const continuation = agentRunLifecycle.get('run-render-review')?.pendingEffectContinuations[0];
        if (!continuation) {
            throw new Error('Expected retained render continuation');
        }
        pendingActionConfirmationStore.clearPendingActionConfirmations();
        pendingActionConfirmationStore.proposePendingActionConfirmation({
            id: 'confirmation-render-retry',
            runId: 'run-render-review',
            prompt: 'Retry the retained verse render.',
            assistantMessageId: 'assistant-render-retry',
            actions: [{ type: 'renderProjectSections', payload: { jobs: [], sectionIds: [] } }],
            actionLabels: ['Render Verse'],
            executionMode: 'atomic',
            projectRevision: 'heads-render-review',
            groupId: 'batch-render-review',
            commandBatch: {
                authority: continuation.authority,
                serialized: continuation.serializedBatch,
            },
        });
        pendingActionConfirmationStore.updatePendingActionConfirmationStatus({
            confirmationId: 'confirmation-render-retry',
            status: 'executed',
        });
        pendingActionConfirmationStore.recordPendingActionExecution({
            confirmationId: 'confirmation-render-retry',
            execution: {
                actionType: 'renderProjectSections',
                commandId: 'command-render-review',
                label: 'Render Verse',
                executionKind: 'project',
                affectedIds: ['render-verse'],
                outcome: 'committed-with-warning',
            },
        });
        pendingActionConfirmationStore.updatePendingActionFollowUp({
            confirmationId: 'confirmation-render-retry',
            projectRevision: 'heads-render-review',
            status: 'retryable',
        });

        expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([]);

        pendingActionConfirmationStore.clearPendingActionConfirmations();
    });

    it('atomically converts mixed pending effects to durable manual repair without changing their kinds', () => {
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
        agentRunLifecycle.recordSagaStep({
            runId: 'run-render-review',
            step: createAgentSagaStep({
                stepId: 'runtime:render-review',
                order: 1,
                owner: 'render',
                workId: 'batch-render-review',
                receiptIdentity: '1:run-render-review:batch-render-review:partially-committed',
                state: 'external-pending',
                relatedArtifactIds: [],
                updatedAt: 3,
                compensationAvailable: false,
            }),
        });

        agentRunLifecycle.requirePendingEffectManualRepair({
            runId: 'run-render-review',
            batchId: 'batch-render-review',
            reason: 'Manual review required.',
            requiredAt: 4,
        });

        const state = readAgentRunState();
        expect(agentRunLifecycle.get('run-render-review')?.pendingEffectContinuations).toEqual([
            expect.objectContaining({
                recovery: 'manual-repair',
                lastError: 'Manual review required.',
                effects: [
                    expect.objectContaining({ kind: 'runtime-graph', remediation: 'repair' }),
                    expect.objectContaining({ kind: 'external-effect', remediation: 'manual-repair' }),
                ],
            }),
        ]);
        expect(state.pendingEffectRecoveryLedger).toEqual([
            expect.objectContaining({
                recovery: 'manual-repair',
                lastError: 'Manual review required.',
                effects: [
                    expect.objectContaining({ kind: 'runtime-graph', remediation: 'repair' }),
                    expect.objectContaining({ kind: 'external-effect', remediation: 'manual-repair' }),
                ],
            }),
        ]);
        expect(agentRunLifecycle.get('run-render-review')?.saga.steps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ stepId: 'effect:render-review', state: 'manual-repair', updatedAt: 4 }),
                expect.objectContaining({ stepId: 'runtime:render-review', state: 'external-pending', updatedAt: 3 }),
            ])
        );
        expect(selectAgentRunPendingEffectRecoveries(state)).toEqual([
            expect.objectContaining({
                recovery: 'manual-repair',
                effects: [
                    expect.objectContaining({ kind: 'runtime-graph', remediation: 'repair' }),
                    expect.objectContaining({ kind: 'external-effect', remediation: 'manual-repair' }),
                ],
            }),
        ]);
    });

    it.each([1, 2])(
        'durably projects %i synthesized render repair step(s) before terminal restart recovery',
        (renderCount) => {
            createRenderReviewRun();
            const recovery = agentRunLifecycle.getPendingEffectRecovery({
                runId: 'run-render-review',
                batchId: 'batch-render-review',
            });
            if (!recovery) {
                throw new Error('Expected the render recovery authority fixture.');
            }
            const receiptIdentity = `2:run-render-review:batch-render-review:partially-committed`;
            const state = readAgentRunState();
            agentRunStore.set({
                ...state,
                runs: state.runs.map((run) =>
                    run.runId === 'run-render-review'
                        ? {
                              ...run,
                              phase: 'failed',
                              saga: {
                                  schemaVersion: 1,
                                  steps: [
                                      createAgentSagaStep({
                                          stepId: 'effect:batch-render-review:command-render-repair-1',
                                          order: 0,
                                          owner: 'external-effect',
                                          workId: 'batch-render-review',
                                          receiptIdentity,
                                          state: 'committed',
                                          relatedArtifactIds: [],
                                          updatedAt: 4,
                                          compensationAvailable: false,
                                      }),
                                  ],
                              },
                          }
                        : run
                ),
            });
            const effects: AgentRunPendingEffect[] = Array.from({ length: renderCount }, (_, index) => ({
                commandId: `command-render-repair-${String(index + 1)}`,
                kind: 'external-effect',
                operation: 'renderProjectSections',
                reason: 'The finalized render artifact binding is unavailable.',
                remediation: 'manual-repair',
                state: 'pending',
            }));
            agentRunLifecycle.recordPendingEffectContinuation({
                runId: 'run-render-review',
                continuation: {
                    authority: recovery.authority,
                    batchId: 'batch-render-review',
                    effects,
                    lastError: 'The finalized render artifact binding is unavailable.',
                    receiptIdentity,
                    recovery: 'manual-repair',
                    serializedBatch: recovery.serializedBatch,
                },
                recordedAt: 5,
            });

            const serializedState = window.localStorage.getItem('sourdaw-agent-runs');
            if (!serializedState) {
                throw new Error('Expected the manual render repair projection to be durable.');
            }
            agentRunLifecycle.clear();

            const hydrated = reloadPersistedAgentRun(serializedState, 'run-render-review');
            expect(hydrated?.saga.steps).toHaveLength(renderCount);
            expect(hydrated?.saga.steps).toEqual(
                effects.map((effect, index) =>
                    expect.objectContaining({
                        stepId: `effect:batch-render-review:${effect.commandId}`,
                        order: index,
                        owner: 'external-effect',
                        workId: 'batch-render-review',
                        receiptIdentity,
                        state: 'manual-repair',
                    })
                )
            );
            expect(agentRunLifecycle.recoverInterruptedState({ recoveredAt: 6 })).toEqual({
                recoveredRunIds: ['run-render-review'],
            });
            expect(
                selectAgentRunPendingEffectRecoveries(readAgentRunState()).find(
                    ({ runId, batchId }) => runId === 'run-render-review' && batchId === 'batch-render-review'
                )
                // The projection emits only durable ledger entries, so finding
                // this one here is the durability evidence; `checkpoint` itself is
                // ledger bookkeeping the public projection does not carry.
            ).toMatchObject({ recovery: 'manual-repair', effects });
        }
    );

    it('hydrates an existing reconcile render effect with matching ledger and saga manual repair', () => {
        createRenderReviewRun();
        const recovery = agentRunLifecycle.getPendingEffectRecovery({
            runId: 'run-render-review',
            batchId: 'batch-render-review',
        });
        if (!recovery) {
            throw new Error('Expected the existing reconcile render recovery.');
        }
        const existingEffects = [
            {
                commandId: 'command-render-review',
                kind: 'external-effect',
                operation: 'renderProjectSections',
                reason: 'tail truncated',
                remediation: 'reconcile',
                state: 'pending',
            },
        ] satisfies VerifiedPendingEffects;
        const state = readAgentRunState();
        agentRunStore.set({
            ...state,
            runs: state.runs.map((run) =>
                run.runId === 'run-render-review'
                    ? {
                          ...run,
                          phase: 'failed',
                          saga: {
                              schemaVersion: 1,
                              steps: [
                                  createAgentSagaStep({
                                      stepId: 'effect:batch-render-review:command-render-review',
                                      order: 0,
                                      owner: 'external-effect',
                                      workId: 'batch-render-review',
                                      receiptIdentity: recovery.receiptIdentity,
                                      state: 'external-pending',
                                      relatedArtifactIds: [],
                                      updatedAt: 3,
                                      compensationAvailable: false,
                                  }),
                              ],
                          },
                      }
                    : run
            ),
        });

        expect(
            requireSectionRenderManualRepair({
                runId: 'run-render-review',
                batchId: 'batch-render-review',
                reason: 'The finalized render binding is unavailable.',
                missingEffects: {
                    commandIds: ['command-render-review'],
                    existingEffects,
                    receiptIdentity: recovery.receiptIdentity,
                    serializedBatch: recovery.serializedBatch,
                    authority: recovery.authority,
                },
            })
        ).toBeNull();

        const serializedState = window.localStorage.getItem('sourdaw-agent-runs');
        if (!serializedState) {
            throw new Error('Expected the normalized render recovery to be durable.');
        }
        agentRunLifecycle.clear();

        const hydrated = reloadPersistedAgentRun(serializedState, 'run-render-review');
        expect(hydrated?.pendingEffectContinuations).toMatchObject([
            {
                recovery: 'manual-repair',
                effects: [
                    {
                        commandId: 'command-render-review',
                        kind: 'external-effect',
                        operation: 'renderProjectSections',
                        remediation: 'manual-repair',
                    },
                ],
            },
        ]);
        expect(
            selectAgentRunPendingEffectRecoveries(readAgentRunState()).find(
                ({ runId, batchId }) => runId === 'run-render-review' && batchId === 'batch-render-review'
            )
        ).toMatchObject({
            recovery: 'manual-repair',
            effects: [
                expect.objectContaining({
                    commandId: 'command-render-review',
                    operation: 'renderProjectSections',
                    remediation: 'manual-repair',
                }),
            ],
        });
        expect(hydrated?.saga.steps).toEqual([
            expect.objectContaining({
                stepId: 'effect:batch-render-review:command-render-review',
                receiptIdentity: recovery.receiptIdentity,
                state: 'manual-repair',
            }),
        ]);
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
            checkpoint ? [expect.objectContaining({ checkpoint: 'prepared', recovery: 'manual-repair' })] : []
        );
    });
});
