import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
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
            payload: {
                sectionIds: commandJobs.map(({ sectionId }) => sectionId),
                jobs: commandJobs.map((job) => structuredClone(job)),
            },
        },
        expectedEffect: 'Render exact project sections',
        normalizedProjectRevision: 'revision-original',
    });
    return serializeVersionedCommandEnvelope({ ...command, commandId });
}

function createTempoCommand(commandId: string): string {
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action: { type: 'setTempo', payload: { bpm: 121 } },
        expectedEffect: 'Set tempo',
        normalizedProjectRevision: 'revision-original',
    });
    return serializeVersionedCommandEnvelope({ ...command, commandId });
}

function createReviewObligation(input?: { commands?: string[]; effectCommandIds?: string[] }) {
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-review',
        batchId: 'batch-review',
        projectId: 'project-review',
        baseRevision: 'revision-original',
        intent: 'Render retained sections',
        commands: input?.commands ?? [
            createCommand('command-verse', [jobs[0]!]),
            createCommand('command-chorus', [jobs[1]!]),
        ],
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
    agentRunLifecycle.recordCommittedWork({
        runId: 'run-review',
        workId: 'batch-review',
        receiptIdentity: '2:run-review:batch-review:partially-committed',
        committedRevision: 'revision-original',
        completesRun: false,
        committedAt: 2,
    });
    agentRunLifecycle.recordPendingEffectContinuation({
        runId: 'run-review',
        continuation: {
            batchId: 'batch-review',
            effects: (input?.effectCommandIds ?? ['command-verse', 'command-chorus']).map((commandId) => ({
                commandId,
                kind: 'external-effect' as const,
                operation: 'renderProjectSections',
                reason: 'Retained render requires review.',
                remediation: 'manual-repair' as const,
                state: 'pending' as const,
            })),
            receiptIdentity: '2:run-review:batch-review:partially-committed',
            recovery: 'manual-repair',
            serializedBatch: commandBatch.serialized,
            authority: commandBatch.authority,
            lastError: 'Review the exact retained render evidence.',
            sourceRevision: 'revision-original',
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
        registerHandlerMap(getTransportHandlers());
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

    it.each(['accepted', 'discarded'] as const)(
        'preserves the exact obligation when evidence expires before %s settlement',
        (disposition) => {
            const review = createReviewObligation();
            mocks.getExact.mockReturnValue(null);

            expect(() => settleRetainedSectionRenderManualReview({ binding: review.binding, disposition })).toThrow(
                'The exact retained render is no longer available.'
            );

            expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toHaveLength(1);
            expect(readAgentRunState().pendingEffectRecoveryLedger).toHaveLength(1);
            expect(mocks.disposeExact).not.toHaveBeenCalled();
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

    it('rejects missing-evidence settlement while every exact artifact remains available', () => {
        const review = createReviewObligation();

        expect(() =>
            settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'missing-evidence' })
        ).toThrow('Missing evidence cannot be acknowledged while the exact retained render remains available.');

        expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toHaveLength(1);
        expect(readAgentRunState().pendingEffectRecoveryLedger).toHaveLength(1);
        expect(mocks.disposeExact).not.toHaveBeenCalled();
    });

    it.each(['accepted', 'discarded'] as const)(
        'rejects %s settlement for mixed artifact availability without settling or disposal',
        (disposition) => {
            mocks.getExact.mockImplementation(({ job }) => (job.jobId === 'job-verse' ? artifactFor(job) : null));
            const review = createReviewObligation();

            expect(() => settleRetainedSectionRenderManualReview({ binding: review.binding, disposition })).toThrow(
                'The exact retained render is no longer available.'
            );

            expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toHaveLength(1);
            expect(readAgentRunState().pendingEffectRecoveryLedger).toHaveLength(1);
            expect(mocks.disposeExact).not.toHaveBeenCalled();
        }
    );

    it('settles the exact manual-review aggregate when the original batch has a non-render sibling', () => {
        const review = createReviewObligation({
            commands: [
                createTempoCommand('command-tempo'),
                createCommand('command-verse', [jobs[0]!]),
                createCommand('command-chorus', [jobs[1]!]),
            ],
        });

        expect(review.binding.commands.map(({ commandId }) => commandId)).toEqual(['command-verse', 'command-chorus']);
        settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'accepted' });

        expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toEqual([]);
        expect(readAgentRunState().runs[0]?.saga.steps).toHaveLength(2);
    });

    it('settles only the warned render command when a clean render sibling has no pending effect', () => {
        const review = createReviewObligation({
            commands: [createCommand('command-clean', [jobs[0]!]), createCommand('command-chorus', [jobs[1]!])],
            effectCommandIds: ['command-chorus'],
        });

        expect(review.binding.commands).toEqual([{ commandId: 'command-chorus', jobs: [jobs[1]] }]);
        settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'accepted' });

        expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toEqual([]);
        expect(readAgentRunState().runs[0]?.saga.steps).toEqual([
            expect.objectContaining({
                stepId: 'effect:batch-review:command-chorus',
                state: 'reviewed',
                manualReviewDisposition: 'accepted',
            }),
        ]);
    });

    it('updates only the exact effect step IDs when another external effect shares the work ID', () => {
        const review = createReviewObligation();
        const state = readAgentRunState();
        state.runs[0]!.saga.steps.push({
            ...structuredClone(state.runs[0]!.saga.steps[0]!),
            stepId: 'external:batch-review:unrelated',
            order: 2,
        });
        agentRunStore.set(state);

        settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'accepted' });

        expect(readAgentRunState().runs[0]?.saga.steps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    stepId: 'effect:batch-review:command-verse',
                    state: 'reviewed',
                    manualReviewDisposition: 'accepted',
                }),
                expect.objectContaining({
                    stepId: 'effect:batch-review:command-chorus',
                    state: 'reviewed',
                    manualReviewDisposition: 'accepted',
                }),
                expect.objectContaining({
                    stepId: 'external:batch-review:unrelated',
                    state: 'manual-repair',
                }),
            ])
        );
    });

    it('removes only the settled batch from manual resume and preserves unrelated recovery work', () => {
        const review = createReviewObligation();
        const state = readAgentRunState();
        state.runs[0]!.manualResume = {
            required: true,
            reason: 'Two retained operations require manual review.',
            workIds: ['batch-review', 'unrelated-manual-work'],
            requiredAt: 4,
        };
        agentRunStore.set(state);

        settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'accepted' });

        expect(readAgentRunState().runs[0]?.manualResume).toEqual({
            required: true,
            reason: 'Two retained operations require manual review.',
            workIds: ['unrelated-manual-work'],
            requiredAt: 4,
        });
        expect(readAgentRunState().runs[0]?.phase).toBe('partially-completed');
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

    it('reports cleanup failure when an exact discarded artifact cannot be disposed', () => {
        const review = createReviewObligation();
        mocks.disposeExact.mockReturnValueOnce(false);

        expect(() =>
            settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'discarded' })
        ).toThrow('one or more retained artifacts could not be discarded');

        expect(readAgentRunState().runs[0]?.pendingEffectContinuations).toEqual([]);
        expect(mocks.disposeExact).toHaveBeenCalledTimes(2);
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
            'job ID',
            (binding: ReviewBinding) => {
                binding.commands[0]!.jobs[0]!.jobId = 'wrong-job';
            },
        ],
        [
            'job section ID',
            (binding: ReviewBinding) => {
                binding.commands[0]!.jobs[0]!.sectionId = 'wrong-section';
            },
        ],
        [
            'job end beat',
            (binding: ReviewBinding) => {
                binding.commands[0]!.jobs[0]!.endBeat = 15;
            },
        ],
        [
            'removed job',
            (binding: ReviewBinding) => {
                binding.commands[0]!.jobs.pop();
            },
        ],
        [
            'job tail',
            (binding: ReviewBinding) => {
                binding.commands[0]!.jobs[0]!.tailSeconds = 2;
            },
        ],
        [
            'job section name',
            (binding: ReviewBinding) => {
                binding.commands[0]!.jobs[0]!.sectionName = 'Wrong section';
            },
        ],
        [
            'job start beat',
            (binding: ReviewBinding) => {
                binding.commands[0]!.jobs[0]!.startBeat = 4;
            },
        ],
        [
            'job sample rate',
            (binding: ReviewBinding) => {
                binding.commands[0]!.jobs[0]!.sampleRate = 44_100;
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

    it.each([
        [
            'missing saga step',
            (state: ReturnType<typeof readAgentRunState>) => {
                state.runs[0]!.saga.steps.shift();
            },
        ],
        [
            'duplicate saga step',
            (state: ReturnType<typeof readAgentRunState>) => {
                state.runs[0]!.saga.steps.push(structuredClone(state.runs[0]!.saga.steps[0]!));
            },
        ],
        [
            'wrong saga receipt',
            (state: ReturnType<typeof readAgentRunState>) => {
                state.runs[0]!.saga.steps[0]!.receiptIdentity = 'wrong-receipt';
            },
        ],
        [
            'wrong saga owner',
            (state: ReturnType<typeof readAgentRunState>) => {
                state.runs[0]!.saga.steps[0]!.owner = 'render';
            },
        ],
        [
            'wrong saga work ID',
            (state: ReturnType<typeof readAgentRunState>) => {
                state.runs[0]!.saga.steps[0]!.workId = 'wrong-batch';
            },
        ],
        [
            'wrong saga state',
            (state: ReturnType<typeof readAgentRunState>) => {
                state.runs[0]!.saga.steps[0]!.state = 'committed';
            },
        ],
        [
            'extra targeted saga step',
            (state: ReturnType<typeof readAgentRunState>) => {
                state.runs[0]!.saga.steps.push({
                    ...structuredClone(state.runs[0]!.saga.steps[0]!),
                    stepId: 'effect:batch-review:command-extra',
                    order: 2,
                });
            },
        ],
    ])('keeps the durable obligation when there is a %s', (_label, mutate) => {
        const review = createReviewObligation();
        const state = readAgentRunState();
        mutate(state);
        agentRunStore.set(state);

        expect(() =>
            settleRetainedSectionRenderManualReview({ binding: review.binding, disposition: 'accepted' })
        ).toThrow('exact manual-review obligation is stale or unavailable');

        const unsettled = readAgentRunState();
        expect(unsettled.runs[0]?.pendingEffectContinuations).toHaveLength(1);
        expect(unsettled.pendingEffectRecoveryLedger).toHaveLength(1);
        expect(unsettled.runs[0]?.saga.steps.some(({ state }) => state === 'reviewed')).toBe(false);
    });
});
