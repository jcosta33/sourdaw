import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandReceipt,
    getVersionedCommandBatchCommitProof,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { agentRunLifecycle } from '../../useCases/agentRunLifecycle';
import { createAgentSagaStep } from '../../useCases/createAgentSagaStep';
import { prepareAgentRunPendingEffectContinuation } from '../../useCases/prepareAgentRunPendingEffectContinuation';
import { selectRetainedSectionRenderManualReviews } from '../../useCases/selectRetainedSectionRenderManualReviews';
import { settleRetainedSectionRenderManualReview } from '../../useCases/settleRetainedSectionRenderManualReview';
import { agentRunStore, readAgentRunState, sanitizeAgentRunState } from '../agentRunStore';

const mocks = vi.hoisted(() => ({ getExact: vi.fn(), disposeExact: vi.fn() }));
vi.mock('#/modules/AudioRendering/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioRendering/useCases')>()),
    getExactAgentSectionRenderArtifact: mocks.getExact,
    disposeExactAgentSectionRenderArtifact: mocks.disposeExact,
}));

type ReceiptPendingEffect = ReturnType<typeof createVerifiedBatchReceipt>['pendingEffects'][number];

const job: RenderProjectSectionJobSnapshot = {
    jobId: 'job-review',
    sectionId: 'section-review',
    sectionName: 'Review',
    startBeat: 0,
    endBeat: 16,
    sampleRate: 48_000,
    tailSeconds: 1,
};

function createObligation() {
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action: { type: 'renderProjectSections', payload: { sectionIds: [job.sectionId], jobs: [job] } },
        expectedEffect: 'Render exact section',
        normalizedProjectRevision: 'revision-source',
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-hydrate-review',
        batchId: 'batch-hydrate-review',
        projectId: 'project-review',
        baseRevision: 'revision-source',
        intent: 'Render retained review evidence',
        commands: [serializeVersionedCommandEnvelope({ ...command, commandId: 'command-review' })],
    });
    agentRunLifecycle.create({
        runId: 'run-hydrate-review',
        request: 'Review retained render after restart.',
        mode: 'macro',
        createdRevision: 'revision-source',
        createdAt: 1,
    });
    agentRunLifecycle.recordCommittedWork({
        runId: 'run-hydrate-review',
        workId: 'project-commit',
        receiptIdentity: 'receipt-project-commit',
        committedRevision: 'revision-source',
        completesRun: false,
        committedAt: 2,
    });
    agentRunLifecycle.recordCommittedWork({
        runId: 'run-hydrate-review',
        workId: 'batch-hydrate-review',
        receiptIdentity: '2:run-hydrate-review:batch-hydrate-review:partially-committed',
        committedRevision: 'revision-source',
        completesRun: false,
        committedAt: 2,
    });
    agentRunLifecycle.recordPendingEffectContinuation({
        runId: 'run-hydrate-review',
        continuation: {
            batchId: 'batch-hydrate-review',
            effects: [
                {
                    commandId: 'command-review',
                    kind: 'external-effect',
                    operation: 'renderProjectSections',
                    reason: 'Retained render requires review.',
                    remediation: 'manual-repair',
                    state: 'pending',
                },
            ],
            receiptIdentity: '2:run-hydrate-review:batch-hydrate-review:partially-committed',
            recovery: 'manual-repair',
            serializedBatch: commandBatch.serialized,
            authority: commandBatch.authority,
            lastError: 'Review exact retained evidence.',
            sourceRevision: 'revision-source',
        },
        recordedAt: 3,
    });
}

function restartFrom(serializedState: string): void {
    agentRunLifecycle.clear();
    agentRunStore.set(sanitizeAgentRunState(JSON.parse(serializedState)));
}

describe('retained section render review hydration', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        clearHandlerRegistry();
        registerHandlerMap(getAudioRenderingHandlers());
        mocks.getExact.mockReset();
        mocks.getExact.mockReturnValue({ buffer: {} as AudioBuffer, warnings: [] });
        mocks.disposeExact.mockReset();
        mocks.disposeExact.mockReturnValue(true);
    });

    it('preserves source revision and keeps an unsettled exact review actionable after restart', () => {
        createObligation();
        const serializedState = JSON.stringify(readAgentRunState());

        restartFrom(serializedState);

        expect(readAgentRunState().runs[0]?.pendingEffectContinuations[0]?.sourceRevision).toBe('revision-source');
        expect(readAgentRunState().pendingEffectRecoveryLedger?.[0]?.sourceRevision).toBe('revision-source');
        expect(selectRetainedSectionRenderManualReviews(readAgentRunState())).toHaveLength(1);
    });

    it('keeps an evicted review owner actionable from its durable capsule after restart', () => {
        createObligation();
        for (let index = 0; index < 50; index += 1) {
            agentRunLifecycle.create({
                runId: `run-capacity-${String(index)}`,
                request: 'Fill bounded run history.',
                mode: 'explain',
                createdRevision: 'revision-source',
                createdAt: 10 + index,
            });
        }
        const serializedState = JSON.stringify(readAgentRunState());
        restartFrom(serializedState);

        expect(readAgentRunState().runs.some(({ runId }) => runId === 'run-hydrate-review')).toBe(false);
        const review = selectRetainedSectionRenderManualReviews(readAgentRunState())[0];
        if (!review) {
            throw new Error('Expected the evicted owner review to remain actionable.');
        }
        expect(review.binding).toMatchObject({
            runId: 'run-hydrate-review',
            batchId: 'batch-hydrate-review',
            sourceRevision: 'revision-source',
        });

        settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'accepted' });

        expect(readAgentRunState().pendingEffectRecoveryLedger).toBeUndefined();
        expect(selectRetainedSectionRenderManualReviews(readAgentRunState())).toEqual([]);
    });

    it('preserves reviewed disposition and never resurrects a settled review after restart', () => {
        createObligation();
        const review = selectRetainedSectionRenderManualReviews(readAgentRunState())[0];
        if (!review) {
            throw new Error('Expected actionable review.');
        }
        settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'accepted' });
        const serializedState = JSON.stringify(readAgentRunState());

        restartFrom(serializedState);

        expect(selectRetainedSectionRenderManualReviews(readAgentRunState())).toEqual([]);
        expect(readAgentRunState().runs[0]?.saga.steps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ state: 'reviewed', manualReviewDisposition: 'accepted' }),
            ])
        );
        expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toEqual([]);
    });

    it.each(['accepted', 'discarded', 'missing-evidence'] as const)(
        'preserves %s review across exact receipt replay and hydration',
        async (disposition) => {
            const action = {
                type: 'renderProjectSections' as const,
                payload: { sectionIds: [job.sectionId], jobs: [structuredClone(job)] },
            };
            const command = migrateLegacyAppActionToVersionedCommandEnvelope({
                action,
                expectedEffect: 'Render exact review evidence',
                normalizedProjectRevision: 'revision-source',
            });
            const commandBatch = compileVersionedCommandBatchEnvelope({
                runId: 'run-replay-review',
                batchId: 'batch-replay-review',
                projectId: 'project-review',
                baseRevision: 'revision-source',
                intent: 'Review retained render evidence',
                commands: [serializeVersionedCommandEnvelope({ ...command, commandId: 'command-replay-review' })],
            });
            const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
            if (parsed.status === 'invalid') {
                throw new Error(parsed.reason);
            }
            const commandEnvelope = parsed.envelope.commands[0];
            if (!commandEnvelope) {
                throw new Error('Expected the replay-bound render command.');
            }
            const pendingEffect = {
                commandId: commandEnvelope.commandId,
                kind: 'external-effect',
                operation: 'renderProjectSections',
                reason: 'The retained render requires review.',
                remediation: 'reconcile',
                state: 'pending',
            } satisfies ReceiptPendingEffect;
            const proof = await getVersionedCommandBatchCommitProof(commandBatch);
            const receipt = createVerifiedBatchReceipt({
                contentHash: proof.contentHash,
                envelope: parsed.envelope,
                observedBaseRevision: 'revision-source',
                resultingRevision: 'revision-committed',
                result: {
                    status: 'committed-with-warning',
                    warning: pendingEffect.reason,
                    warningDetails: [
                        {
                            kind: 'external-effect',
                            message: pendingEffect.reason,
                            commandId: commandEnvelope.commandId,
                            pendingEffect,
                        },
                    ],
                    actions: [
                        {
                            action,
                            receipt: createVersionedCommandReceipt({
                                envelope: commandEnvelope,
                                compensation: { available: false, strategy: 'none' },
                            }),
                        },
                    ],
                },
            });
            agentRunLifecycle.create({
                runId: receipt.runId,
                request: 'Review retained render replay.',
                mode: 'macro',
                createdRevision: 'revision-source',
                createdAt: 1,
            });
            agentRunLifecycle.recordReceiptSaga({
                runId: receipt.runId,
                receipt,
                actions: [action],
                commandBatch,
                committedRevision: 'revision-committed',
                completesRun: false,
            });
            agentRunLifecycle.requirePendingEffectManualRepair({
                runId: receipt.runId,
                batchId: receipt.batchId,
                reason: 'Review the retained evidence.',
                requiredAt: 2,
            });
            if (disposition === 'missing-evidence') {
                mocks.getExact.mockReturnValue(null);
            }
            const review = selectRetainedSectionRenderManualReviews(readAgentRunState())[0];
            if (!review) {
                throw new Error('Expected the exact replay review.');
            }
            settleRetainedSectionRenderManualReview({ binding: review.binding, disposition });

            agentRunLifecycle.recordReceiptSaga({
                runId: receipt.runId,
                receipt,
                actions: [action],
                commandBatch,
                committedRevision: 'revision-committed',
                completesRun: false,
            });
            const serializedState = JSON.stringify(readAgentRunState());
            restartFrom(serializedState);

            const restarted = readAgentRunState();
            expect(restarted.runs[0]?.saga.steps).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ state: 'reviewed', manualReviewDisposition: disposition }),
                ])
            );
            expect(restarted.runs[0]?.pendingEffectContinuations).toEqual([]);
            expect(restarted.pendingEffectRecoveryLedger).toBeUndefined();
            expect(selectRetainedSectionRenderManualReviews(restarted)).toEqual([]);
        }
    );

    it('rejects reviewed steps without a disposition and non-reviewed steps carrying one', () => {
        agentRunLifecycle.create({
            runId: 'run-invalid-disposition',
            request: 'Reject invalid hydrated review state.',
            mode: 'macro',
            createdRevision: 'revision-source',
            createdAt: 1,
        });
        agentRunLifecycle.recordSagaStep({
            runId: 'run-invalid-disposition',
            step: createAgentSagaStep({
                stepId: 'effect:batch:command',
                order: 0,
                owner: 'external-effect',
                workId: 'batch',
                receiptIdentity: 'receipt',
                state: 'manual-repair',
                relatedArtifactIds: [],
                updatedAt: 2,
                compensationAvailable: false,
            }),
        });
        const state = readAgentRunState();
        const step = state.runs[0]!.saga.steps[0]!;

        expect(
            sanitizeAgentRunState({
                ...state,
                runs: [{ ...state.runs[0]!, saga: { schemaVersion: 1, steps: [{ ...step, state: 'reviewed' }] } }],
            }).runs
        ).toEqual([]);
        expect(
            sanitizeAgentRunState({
                ...state,
                runs: [
                    {
                        ...state.runs[0]!,
                        saga: {
                            schemaVersion: 1,
                            steps: [{ ...step, manualReviewDisposition: 'accepted' }],
                        },
                    },
                ],
            }).runs
        ).toEqual([]);
    });

    it('accepts absent legacy source revision but rejects one attached to a non-render continuation', () => {
        createObligation();
        const legacy = structuredClone(readAgentRunState());
        delete legacy.runs[0]!.pendingEffectContinuations[0]!.sourceRevision;
        delete legacy.pendingEffectRecoveryLedger![0]!.sourceRevision;
        expect(sanitizeAgentRunState(legacy).runs[0]?.pendingEffectContinuations[0]?.sourceRevision).toBeUndefined();

        const invalid = structuredClone(readAgentRunState());
        invalid.runs[0]!.pendingEffectContinuations[0]!.effects[0]!.operation = 'setTrackGain';
        invalid.pendingEffectRecoveryLedger![0]!.effects[0]!.operation = 'setTrackGain';
        expect(sanitizeAgentRunState(invalid)).toEqual({ schemaVersion: 1, runs: [] });
    });

    it('keeps a restarted prepared second batch unbound when only the prior committed revision is known', () => {
        createObligation();
        const preparedState = structuredClone(readAgentRunState());
        preparedState.runs[0]!.pendingEffectContinuations = [];
        preparedState.pendingEffectRecoveryLedger![0]!.checkpoint = 'prepared';
        delete preparedState.pendingEffectRecoveryLedger![0]!.sourceRevision;

        restartFrom(JSON.stringify(preparedState));

        const preparedRecovery = readAgentRunState().pendingEffectRecoveryLedger?.[0];
        if (!preparedRecovery) {
            throw new Error('Expected the restarted prepared recovery.');
        }
        const { checkpoint: _checkpoint, runId: _runId, ...continuation } = preparedRecovery;
        agentRunLifecycle.recordPendingEffectContinuation({
            runId: 'run-hydrate-review',
            continuation,
            recordedAt: 4,
        });

        agentRunLifecycle.requirePendingEffectManualRepair({
            runId: 'run-hydrate-review',
            batchId: 'batch-hydrate-review',
            reason: 'Review exact retained evidence.',
            requiredAt: 5,
        });

        expect(readAgentRunState().runs[0]?.revisions.committed).toBe('revision-source');
        expect(readAgentRunState().runs[0]?.pendingEffectContinuations[0]).not.toHaveProperty('sourceRevision');
        expect(readAgentRunState().pendingEffectRecoveryLedger?.[0]).not.toHaveProperty('sourceRevision');
        const serializedState = JSON.stringify(readAgentRunState());

        restartFrom(serializedState);

        expect(selectRetainedSectionRenderManualReviews(readAgentRunState())).toEqual([]);
        expect(mocks.getExact).not.toHaveBeenCalled();
    });

    it('recovers a failed render promotion from the exact receipt revision before hydration', async () => {
        const action = {
            type: 'renderProjectSections' as const,
            payload: { sectionIds: [job.sectionId], jobs: [structuredClone(job)] },
        };
        const command = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Render exact review evidence',
            normalizedProjectRevision: 'revision-before-receipt',
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'run-receipt-review',
            batchId: 'batch-receipt-review',
            projectId: 'project-review',
            baseRevision: 'revision-before-receipt',
            intent: 'Render retained review evidence',
            commands: [serializeVersionedCommandEnvelope({ ...command, commandId: 'command-receipt-review' })],
        });
        const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        const commandEnvelope = parsed.envelope.commands[0];
        if (!commandEnvelope) {
            throw new Error('Expected the receipt-bound render command.');
        }
        const pendingEffect = {
            commandId: commandEnvelope.commandId,
            kind: 'external-effect',
            operation: 'renderProjectSections',
            reason: 'The retained render requires review.',
            remediation: 'reconcile',
            state: 'pending',
        } satisfies ReceiptPendingEffect;
        const proof = await getVersionedCommandBatchCommitProof(commandBatch);
        const receipt = createVerifiedBatchReceipt({
            contentHash: proof.contentHash,
            envelope: parsed.envelope,
            observedBaseRevision: 'revision-before-receipt',
            resultingRevision: 'revision-receipt-commit',
            result: {
                status: 'committed-with-warning',
                warning: 'A retained render effect remains pending.',
                warningDetails: [
                    {
                        kind: 'external-effect',
                        message: pendingEffect.reason,
                        commandId: commandEnvelope.commandId,
                        pendingEffect,
                    },
                ],
                actions: [
                    {
                        action,
                        receipt: createVersionedCommandReceipt({
                            envelope: commandEnvelope,
                            compensation: { available: false, strategy: 'none' },
                        }),
                    },
                ],
            },
        });
        agentRunLifecycle.create({
            runId: 'run-receipt-review',
            request: 'Review the ordinary retained render receipt.',
            mode: 'macro',
            createdRevision: 'revision-before-receipt',
            createdAt: 1,
        });
        agentRunLifecycle.recordCommittedWork({
            runId: 'run-receipt-review',
            workId: 'prior-work',
            receiptIdentity: 'receipt-prior-work',
            committedRevision: 'revision-prior-work',
            completesRun: false,
            committedAt: 1,
        });

        agentRunLifecycle.recordReceiptSaga({
            runId: 'run-receipt-review',
            receipt,
            actions: [action],
            committedRevision: 'revision-receipt-commit',
            completesRun: true,
            commandBatch,
        });

        expect(agentRunLifecycle.get('run-receipt-review')?.pendingEffectContinuations[0]?.sourceRevision).toBe(
            'revision-receipt-commit'
        );
        expect(readAgentRunState().pendingEffectRecoveryLedger?.[0]?.sourceRevision).toBe('revision-receipt-commit');

        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: 'run-receipt-review',
            request: 'Review the ordinary retained render receipt.',
            mode: 'macro',
            createdRevision: 'revision-before-receipt',
            createdAt: 1,
        });
        agentRunLifecycle.recordCommittedWork({
            runId: 'run-receipt-review',
            workId: 'prior-work',
            receiptIdentity: 'receipt-prior-work',
            committedRevision: 'revision-prior-work',
            completesRun: false,
            committedAt: 1,
        });
        let finalizedRevision: string | undefined;
        const preparation = prepareAgentRunPendingEffectContinuation({
            runId: 'run-receipt-review',
            receipt,
            commandBatch,
            getFinalizedRevision: () => finalizedRevision,
        });

        preparation.promote({ receipt });

        expect(agentRunLifecycle.get('run-receipt-review')?.pendingEffectContinuations).toEqual([]);
        expect(readAgentRunState().pendingEffectRecoveryLedger?.[0]).toMatchObject({ checkpoint: 'prepared' });
        expect(readAgentRunState().pendingEffectRecoveryLedger?.[0]).not.toHaveProperty('sourceRevision');

        finalizedRevision = 'revision-receipt-commit';
        const recordContinuation = vi
            .spyOn(agentRunLifecycle, 'recordPendingEffectContinuation')
            .mockImplementationOnce(() => {
                throw new Error('simulated one-shot continuation persistence failure');
            });

        expect(() => preparation.promote({ receipt })).toThrow('simulated one-shot continuation persistence failure');
        recordContinuation.mockRestore();

        expect(agentRunLifecycle.get('run-receipt-review')?.revisions.committed).toBe('revision-prior-work');
        expect(agentRunLifecycle.get('run-receipt-review')?.pendingEffectContinuations).toEqual([]);
        expect(readAgentRunState().pendingEffectRecoveryLedger?.[0]).toMatchObject({
            checkpoint: 'prepared',
            receiptIdentity: '2:run-receipt-review:batch-receipt-review:partially-committed',
        });
        expect(readAgentRunState().pendingEffectRecoveryLedger?.[0]).not.toHaveProperty('sourceRevision');
        expect(selectRetainedSectionRenderManualReviews(readAgentRunState())).toEqual([]);

        agentRunLifecycle.recordReceiptSaga({
            runId: 'run-receipt-review',
            receipt,
            actions: [action],
            committedRevision: 'revision-receipt-commit',
            completesRun: true,
            commandBatch,
        });
        agentRunLifecycle.requirePendingEffectManualRepair({
            runId: 'run-receipt-review',
            batchId: 'batch-receipt-review',
            reason: 'Review the exact retained evidence.',
            requiredAt: 2,
        });

        expect(selectRetainedSectionRenderManualReviews(readAgentRunState())).toHaveLength(1);

        expect(agentRunLifecycle.get('run-receipt-review')?.pendingEffectContinuations[0]?.receiptIdentity).toBe(
            '2:run-receipt-review:batch-receipt-review:partially-committed'
        );
        expect(agentRunLifecycle.get('run-receipt-review')?.pendingEffectContinuations[0]?.sourceRevision).toBe(
            'revision-receipt-commit'
        );
        expect(readAgentRunState().pendingEffectRecoveryLedger?.[0]?.sourceRevision).toBe('revision-receipt-commit');
        const serializedState = JSON.stringify(readAgentRunState());

        restartFrom(serializedState);

        expect(selectRetainedSectionRenderManualReviews(readAgentRunState())).toHaveLength(1);
    });

    it('hydrates an unsettled source-revision-bound review from serialized localStorage', async () => {
        createObligation();
        const serializedState = window.localStorage.getItem('sourdaw-agent-runs');
        if (!serializedState) {
            throw new Error('Expected the persisted agent run payload.');
        }
        agentRunLifecycle.clear();
        window.localStorage.setItem('sourdaw-agent-runs', serializedState);
        vi.resetModules();

        const freshStoreModule = await import('../agentRunStore');
        const freshSelectorModule = await import('../../useCases/selectRetainedSectionRenderManualReviews');
        const hydratedState = freshStoreModule.readAgentRunState();

        expect(hydratedState.runs[0]?.pendingEffectContinuations[0]?.sourceRevision).toBe('revision-source');
        expect(hydratedState.pendingEffectRecoveryLedger?.[0]?.sourceRevision).toBe('revision-source');
        expect(freshSelectorModule.selectRetainedSectionRenderManualReviews(hydratedState)).toHaveLength(1);
    });
});
