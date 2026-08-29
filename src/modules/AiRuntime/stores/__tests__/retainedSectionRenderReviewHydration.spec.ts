import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { agentRunLifecycle } from '../../useCases/agentRunLifecycle';
import { createAgentSagaStep } from '../../useCases/createAgentSagaStep';
import { selectRetainedSectionRenderManualReviews } from '../../useCases/selectRetainedSectionRenderManualReviews';
import { settleRetainedSectionRenderManualReview } from '../../useCases/settleRetainedSectionRenderManualReview';
import { agentRunStore, readAgentRunState, sanitizeAgentRunState } from '../agentRunStore';

const mocks = vi.hoisted(() => ({ getExact: vi.fn(), disposeExact: vi.fn() }));
vi.mock('#/modules/AudioRendering/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioRendering/useCases')>()),
    getExactAgentSectionRenderArtifact: mocks.getExact,
    disposeExactAgentSectionRenderArtifact: mocks.disposeExact,
}));

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
            receiptIdentity: '1:run-hydrate-review:batch-hydrate-review:partially-committed',
            recovery: 'manual-repair',
            serializedBatch: commandBatch.serialized,
            authority: commandBatch.authority,
            lastError: 'Review exact retained evidence.',
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
