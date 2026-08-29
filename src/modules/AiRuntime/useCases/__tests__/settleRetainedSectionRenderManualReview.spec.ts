import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { agentRunStore, readAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { selectRetainedSectionRenderManualReviews } from '../selectRetainedSectionRenderManualReviews';
import { settleRetainedSectionRenderManualReview } from '../settleRetainedSectionRenderManualReview';

const mocks = vi.hoisted(() => ({
    getExact: vi.fn(),
    disposeExact: vi.fn(),
    retryRenders: vi.fn(),
    executeProjectBatch: vi.fn(),
}));
vi.mock('#/modules/AudioRendering/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioRendering/useCases')>()),
    getExactAgentSectionRenderArtifact: mocks.getExact,
    disposeExactAgentSectionRenderArtifact: mocks.disposeExact,
    retryAgentProjectSectionRenders: mocks.retryRenders,
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppActionBatch: mocks.executeProjectBatch,
}));

const jobs: RenderProjectSectionJobSnapshot[] = [
    {
        jobId: 'job-verse',
        sectionId: 'section-verse',
        sectionName: 'Verse',
        startBeat: 0,
        endBeat: 16,
        sampleRate: 48_000,
        tailSeconds: 1,
    },
    {
        jobId: 'job-chorus',
        sectionId: 'section-chorus',
        sectionName: 'Chorus',
        startBeat: 16,
        endBeat: 32,
        sampleRate: 48_000,
        tailSeconds: 1,
    },
];
type ReviewBinding = ReturnType<typeof selectRetainedSectionRenderManualReviews>[number]['binding'];

function createCommand(commandId: string, commandJobs: readonly RenderProjectSectionJobSnapshot[]): string {
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action: {
            type: 'renderProjectSections',
            payload: { sectionIds: commandJobs.map(({ sectionId }) => sectionId), jobs: structuredClone(commandJobs) },
        },
        expectedEffect: 'Render exact project sections',
        normalizedProjectRevision: 'revision-original',
    });
    return serializeVersionedCommandEnvelope({ ...command, commandId });
}

function createReviewObligation() {
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-review',
        batchId: 'batch-review',
        projectId: 'project-review',
        baseRevision: 'revision-original',
        intent: 'Render retained sections',
        commands: [createCommand('command-verse', [jobs[0]!]), createCommand('command-chorus', [jobs[1]!])],
    });
    agentRunLifecycle.create({
        runId: 'run-review',
        request: 'Review retained section renders.',
        mode: 'macro',
        createdRevision: 'revision-original',
        createdAt: 1,
    });
    agentRunLifecycle.recordCommittedWork({
        runId: 'run-review',
        workId: 'project-commit',
        receiptIdentity: 'receipt-project-commit',
        committedRevision: 'revision-original',
        completesRun: false,
        committedAt: 2,
    });
    agentRunLifecycle.recordPendingEffectContinuation({
        runId: 'run-review',
        continuation: {
            batchId: 'batch-review',
            effects: ['command-verse', 'command-chorus'].map((commandId) => ({
                commandId,
                kind: 'external-effect' as const,
                operation: 'renderProjectSections',
                reason: 'Retained render requires review.',
                remediation: 'manual-repair' as const,
                state: 'pending' as const,
            })),
            receiptIdentity: '1:run-review:batch-review:partially-committed',
            recovery: 'manual-repair',
            serializedBatch: commandBatch.serialized,
            authority: commandBatch.authority,
            lastError: 'Review the exact retained render evidence.',
        },
        recordedAt: 3,
    });
    const review = selectRetainedSectionRenderManualReviews(readAgentRunState())[0];
    if (!review) {
        throw new Error('Expected exact retained render review fixture.');
    }
    return review;
}

function artifactFor(job: RenderProjectSectionJobSnapshot) {
    return {
        owner: 'agent-section-render' as const,
        retention: 'session' as const,
        ...job,
        sourceRevision: 'revision-original',
        renderedAt: 1,
        durationSeconds: 1,
        frameCount: 48_000,
        channelCount: 2,
        byteSize: 384_000,
        warnings: [],
        buffer: { jobId: job.jobId } as unknown as AudioBuffer,
    };
}

describe('settleRetainedSectionRenderManualReview', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        clearHandlerRegistry();
        registerHandlerMap(getAudioRenderingHandlers());
        vi.clearAllMocks();
        mocks.getExact.mockImplementation(({ job }) => artifactFor(job));
        mocks.disposeExact.mockReturnValue(true);
    });

    it.each(['accepted', 'discarded'] as const)(
        'durably records a reviewed %s disposition for the whole batch',
        (disposition) => {
            const review = createReviewObligation();

            settleRetainedSectionRenderManualReview({ binding: review.binding, disposition });

            const state = readAgentRunState();
            expect(state.runs[0]?.pendingEffectContinuations).toEqual([]);
            expect(state.pendingEffectRecoveryLedger).toBeUndefined();
            expect(state.runs[0]?.saga.steps).toHaveLength(2);
            expect(state.runs[0]?.saga.steps).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ state: 'reviewed', manualReviewDisposition: disposition }),
                    expect.objectContaining({ state: 'reviewed', manualReviewDisposition: disposition }),
                ])
            );
            expect(window.localStorage.getItem('sourdaw-agent-runs')).toContain(
                `"manualReviewDisposition":"${disposition}"`
            );
            expect(mocks.disposeExact).toHaveBeenCalledTimes(disposition === 'discarded' ? 2 : 0);
            expect(mocks.retryRenders).not.toHaveBeenCalled();
            expect(mocks.executeProjectBatch).not.toHaveBeenCalled();
        }
    );

    it('acknowledges missing evidence only when at least one exact artifact is unavailable', () => {
        mocks.getExact.mockImplementation(({ job }) => (job.jobId === 'job-verse' ? artifactFor(job) : null));
        const review = createReviewObligation();

        settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'missing-evidence' });

        expect(readAgentRunState().runs[0]?.saga.steps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ state: 'reviewed', manualReviewDisposition: 'missing-evidence' }),
            ])
        );
        expect(mocks.disposeExact).not.toHaveBeenCalled();
    });

    it('persists discard settlement before disposing every exact artifact', () => {
        const review = createReviewObligation();
        mocks.disposeExact.mockImplementation(() => {
            expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toEqual([]);
            expect(readAgentRunState().pendingEffectRecoveryLedger).toBeUndefined();
            return true;
        });

        settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'discarded' });

        expect(mocks.disposeExact.mock.calls).toEqual(
            jobs.map((job) => [{ job, sourceRevision: 'revision-original' }])
        );
    });

    it('keeps both artifacts and the exact obligation when durable persistence fails', () => {
        const review = createReviewObligation();
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        });

        expect(() =>
            settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'discarded' })
        ).toThrow('could not be persisted locally');

        expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toHaveLength(1);
        expect(readAgentRunState().pendingEffectRecoveryLedger).toHaveLength(1);
        expect(mocks.disposeExact).not.toHaveBeenCalled();
        setItem.mockRestore();
    });

    it.each([
        [
            'command',
            (binding: ReviewBinding) => {
                binding.commands[0]!.commandId = 'wrong-command';
            },
        ],
        [
            'job',
            (binding: ReviewBinding) => {
                binding.commands[0]!.jobs[0]!.endBeat = 15;
            },
        ],
        [
            'receipt',
            (binding: ReviewBinding) => {
                binding.receiptIdentity = 'wrong-receipt';
            },
        ],
        [
            'revision',
            (binding: ReviewBinding) => {
                binding.sourceRevision = 'wrong-revision';
            },
        ],
        [
            'partial aggregate',
            (binding: ReviewBinding) => {
                binding.commands.pop();
            },
        ],
    ])('rejects a partial or stale %s binding without settling any job', (_label, mutate) => {
        const review = createReviewObligation();
        const binding = structuredClone(review.binding);
        mutate(binding);

        expect(() => settleRetainedSectionRenderManualReview({ binding, disposition: 'accepted' })).toThrow(
            'stale, ambiguous, or unavailable'
        );
        expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toHaveLength(1);
        expect(mocks.disposeExact).not.toHaveBeenCalled();
    });

    it.each([
        [
            'authority',
            (state: ReturnType<typeof readAgentRunState>) => {
                state.pendingEffectRecoveryLedger![0]!.authority.baseRevision = 'wrong-revision';
            },
        ],
        [
            'effect',
            (state: ReturnType<typeof readAgentRunState>) => {
                state.pendingEffectRecoveryLedger![0]!.effects[0]!.reason = 'mutated';
            },
        ],
        [
            'prepared ledger',
            (state: ReturnType<typeof readAgentRunState>) => {
                state.pendingEffectRecoveryLedger![0]!.checkpoint = 'prepared';
            },
        ],
    ])('rejects settlement after the durable %s no longer exactly matches', (_label, mutate) => {
        const review = createReviewObligation();
        const state = readAgentRunState();
        mutate(state);
        agentRunStore.set(state);

        expect(() =>
            settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'accepted' })
        ).toThrow('stale, ambiguous, or unavailable');
        expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toHaveLength(1);
    });
});
