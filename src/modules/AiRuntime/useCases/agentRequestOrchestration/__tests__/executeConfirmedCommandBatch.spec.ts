import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandEnvelope,
    issueCommandApprovalBinding,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
    type executeVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type AgentRunWorkLease } from '../../../models/AgentRun';
import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { executeConfirmedCommandBatch } from '../executeConfirmedCommandBatch';

type ExecuteBatch = typeof executeVersionedCommandBatchEnvelope;
type ExecuteBatchResult = Awaited<ReturnType<ExecuteBatch>>;
type CommittedBatchResult = Extract<ExecuteBatchResult, { status: 'committed' }>;
type CommittedWarningBatchResult = Extract<ExecuteBatchResult, { status: 'committed-with-warning' }>;
type NarrowBatchResult<Result, Status> = Result extends { status: infer CandidateStatus }
    ? Status extends CandidateStatus
        ? Omit<Result, 'status'> & { status: Status }
        : never
    : never;
type CancelledBatchResult = NarrowBatchResult<ExecuteBatchResult, 'cancelled'>;
type PreviewedBatchResult = Pick<Extract<ExecuteBatchResult, { status: 'previewed' }>, 'status' | 'resource'>;
type TestBatchExecutorResultByStatus = {
    committed: CommittedBatchResult;
    'committed-with-warning': CommittedWarningBatchResult;
    cancelled: CancelledBatchResult;
    previewed: PreviewedBatchResult;
};
type TestBatchExecutorResult = TestBatchExecutorResultByStatus[keyof TestBatchExecutorResultByStatus];
type TestBatchExecutor = (input: Parameters<ExecuteBatch>[0]) => Promise<TestBatchExecutorResult>;
type ApprovalBindingIssuer = typeof import('../../issueAgentCommandApprovalBinding').issueAgentCommandApprovalBinding;
type PrepareResourceLease =
    typeof import('../../../stores/pendingActionConfirmationStore').preparePendingActionResourceLeaseForCommit;
type ProtectResourceLease =
    typeof import('../../../stores/pendingActionConfirmationStore').protectPendingActionResourceLease;
type PrepareContinuation =
    typeof import('../../prepareAgentRunPendingEffectContinuation').prepareAgentRunPendingEffectContinuation;
type RecordTrackedAgentRunReceipt =
    typeof import('../confirmedBatchOutcomeSupport').confirmedBatchOutcomeSupport.recordTrackedAgentRunReceipt;
type BindCancellation = typeof import('../../cancelAgentRun').agentRunCancellation.bindAbortController;
type CancelRun = typeof import('../../cancelAgentRun').agentRunCancellation.cancel;
type CaptureAuthorization = typeof import('#/modules/CrdtDocument/useCases').captureProjectMutationAuthorization;
type CaptureRevision = typeof import('#/modules/CrdtDocument/useCases').captureProjectRevision;
type RecordPostCommitRecoveryFailure =
    typeof import('../agentRunExecutionSettlement').agentRunExecutionSettlement.recordPostCommitRecoveryFailure;
type RecordCommittedRecoveryFailure =
    typeof import('../agentRunExecutionSettlement').agentRunExecutionSettlement.recordCommittedRecoveryFailure;
type GetArtifacts = typeof import('#/modules/AudioRendering/useCases').getAgentSectionRenderArtifacts;
type RebindArtifacts = typeof import('#/modules/AudioRendering/useCases').rebindAgentProjectSectionArtifactRevisions;
type AgentSectionRenderArtifact = ReturnType<GetArtifacts>[number];

const mocks = vi.hoisted(() => ({
    bindCancellation: vi.fn<BindCancellation>(),
    cancelRun: vi.fn<CancelRun>(),
    captureAuthorization: vi.fn<CaptureAuthorization>(),
    captureRevision: vi.fn<CaptureRevision>(),
    executeBatch: vi.fn<TestBatchExecutor>(),
    getArtifacts: vi.fn<GetArtifacts>(),
    rebindArtifacts: vi.fn<RebindArtifacts>(),
    issueApprovalBinding: vi.fn<ApprovalBindingIssuer>(),
    prepareContinuation: vi.fn<PrepareContinuation>(),
    prepareResourceLease: vi.fn<PrepareResourceLease>(),
    protectResourceLease: vi.fn<ProtectResourceLease>(),
    recordCommittedRecoveryFailure: vi.fn<RecordCommittedRecoveryFailure>(),
    recordPostCommitRecoveryFailure: vi.fn<RecordPostCommitRecoveryFailure>(),
    recordReceipt: vi.fn<RecordTrackedAgentRunReceipt>(),
    retainCommitted: vi.fn(),
    setActiveAborter: vi.fn(),
    setChatGenerating: vi.fn(),
    updateConfirmation: vi.fn(),
    updateMessage: vi.fn(),
}));

const collaboration = vi.hoisted(() => ({ value: undefined as { localPeerId: string } | undefined }));

vi.mock('#/modules/AudioRendering/useCases', () => ({
    getAgentSectionRenderArtifacts: mocks.getArtifacts,
    rebindAgentProjectSectionArtifactRevisions: mocks.rebindArtifacts,
}));
vi.mock('#/modules/Collaboration/stores', () => ({ collaborationStore: collaboration }));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeVersionedCommandBatchEnvelope: mocks.executeBatch,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectMutationAuthorization: mocks.captureAuthorization,
    captureProjectRevision: mocks.captureRevision,
}));
vi.mock('../../../stores/chatStore', () => ({
    setActiveAborter: mocks.setActiveAborter,
    setChatGenerating: mocks.setChatGenerating,
    updateChatMessage: mocks.updateMessage,
}));
vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    preparePendingActionResourceLeaseForCommit: mocks.prepareResourceLease,
    protectPendingActionResourceLease: mocks.protectResourceLease,
    updatePendingActionConfirmationStatus: mocks.updateConfirmation,
}));
vi.mock('../../cancelAgentRun', () => ({
    agentRunCancellation: {
        bindAbortController: mocks.bindCancellation,
        cancel: mocks.cancelRun,
    },
}));
vi.mock('../../issueAgentCommandApprovalBinding', () => ({
    issueAgentCommandApprovalBinding: mocks.issueApprovalBinding,
}));
vi.mock('../../prepareAgentRunPendingEffectContinuation', () => ({
    prepareAgentRunPendingEffectContinuation: mocks.prepareContinuation,
}));
vi.mock('../agentRunExecutionSettlement', () => ({
    agentRunExecutionSettlement: {
        recordCommittedRecoveryFailure: mocks.recordCommittedRecoveryFailure,
        recordPostCommitRecoveryFailure: mocks.recordPostCommitRecoveryFailure,
    },
}));
vi.mock('../confirmedBatchOutcomeSupport', () => ({
    confirmedBatchOutcomeSupport: {
        createCommittedEffectFailureResult: vi.fn((receipt, reason) => ({
            status: 'committed-effect-failed',
            receipt,
            reason,
        })),
        getVerifiedReceiptIdentity: vi.fn(() => 'receipt-identity'),
        recordTrackedAgentRunReceipt: mocks.recordReceipt,
    },
}));
vi.mock('../pendingActionResourceSettlement', () => ({
    pendingActionResourceSettlement: { retainCommitted: mocks.retainCommitted },
}));

const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies AppAction;
const command = createVersionedCommandEnvelope({
    action,
    availableDeviceVersions: {},
    expectedEffect: 'Tempo changes to 132 BPM.',
    normalizedProjectRevision: 'revision-1',
    objectReferences: [],
    parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
    reason: 'Apply the confirmed tempo change.',
    time: [],
});
const commandBatch = compileVersionedCommandBatchEnvelope({
    runId: 'run-1',
    batchId: 'batch-1',
    projectId: 'project-1',
    baseRevision: 'revision-1',
    intent: 'Set tempo to 132 BPM.',
    commands: [serializeVersionedCommandEnvelope(command)],
});
const parsedBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
if (parsedBatch.status === 'invalid') {
    throw new Error(parsedBatch.reason);
}
const parsedBatchEnvelope = parsedBatch.envelope;
const receipt = createVerifiedBatchReceipt({
    contentHash: 'receipt-1',
    envelope: parsedBatchEnvelope,
    observedBaseRevision: 'revision-1',
    resultingRevision: 'revision-2',
    result: { status: 'committed', actions: [] },
});
const completedBatchResult = {
    status: 'committed' as const,
    actions: [] as [],
    receipt,
} satisfies CommittedBatchResult;
const cancelledBatchResult = {
    status: 'cancelled' as const,
    reason: 'execution refused',
    actions: [] as [],
    receipt,
} satisfies CancelledBatchResult;

function createNonDurableReceipt(status: 'no-op' | 'cancelled' | 'ambiguous' | 'failed') {
    return createVerifiedBatchReceipt({
        contentHash: `receipt-${status}`,
        envelope: parsedBatchEnvelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: 'revision-2',
        result: {
            status,
            actions: [],
            reason: `The prior batch was ${status}.`,
        },
    });
}

function createRuntimeReceipt() {
    return createVerifiedBatchReceipt({
        contentHash: 'receipt-executed',
        envelope: parsedBatchEnvelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: 'revision-2',
        result: { status: 'executed', actions: [] },
    });
}

const confirmation = {
    id: 'confirmation-1',
    runId: 'run-1',
    prompt: 'Set tempo to 132 BPM.',
    assistantMessageId: 'assistant-1',
    actions: [action],
    actionLabels: ['Set tempo to 132 BPM'],
    affectedIds: [],
    protectedUnchanged: [],
    risk: null,
    executedActions: [],
    status: 'accepted',
    error: null,
    followUpProjectRevision: null,
    followUpStatus: null,
    createdAt: 0,
    resolvedAt: null,
    kind: 'app_actions',
    projectRevision: 'revision-1',
    approvalSnapshot: {
        actions: [action],
        actionLabels: ['Set tempo to 132 BPM'],
        commandBatch,
        agentApproval: {
            schemaVersion: 1,
            actionHashes: [],
            sourceRevision: 'revision-1',
            targetFingerprints: {},
            advertisedTargetFingerprints: {},
            consequences: {
                audioUpload: false,
                fileAccess: false,
                maxImportedAssets: 0,
                maxRenderJobs: 0,
                remoteGeneration: false,
            },
            localActorId: 'actor-1',
            policy: {
                decision: 'confirm',
                reasons: [],
                requiredTrustMode: 'apply-reversible',
                risk: 'bounded-reversible',
            },
        },
        protectedUnchanged: [],
    },
    executionMode: 'atomic',
    groupId: 'group-1',
    groupLabel: 'Set tempo',
} satisfies PendingAppActionConfirmation;

const lease = {
    leaseId: 'lease-1',
    runId: 'run-1',
    workId: 'batch-1',
    attempt: 1,
    ownerKind: 'command',
    cancellationGeneration: 0,
    idempotencyKey: 'idempotency-1',
    receiptIdentity: 'command:run-1:batch-1',
    cleanupOwner: 'command-executor',
    idempotent: true,
    retriable: false,
    claimedAt: 0,
    terminalState: null,
    settledAt: null,
} satisfies AgentRunWorkLease;

let projectMutationAuthorized = true;

function createTestAudioBuffer(sampleRate: number): AudioBuffer {
    const channelData = new Float32Array(sampleRate);
    return {
        copyFromChannel(destination: Float32Array, _channelNumber: number, bufferOffset = 0): void {
            destination.set(channelData.subarray(bufferOffset, bufferOffset + destination.length));
        },
        copyToChannel(source: Float32Array, _channelNumber: number, bufferOffset = 0): void {
            channelData.set(source, bufferOffset);
        },
        duration: 1,
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 2,
        sampleRate,
    };
}

function createRenderArtifact(input: {
    jobId: string;
    sectionId: string;
    sectionName: string;
    startBeat: number;
    endBeat: number;
    sampleRate: number;
    tailSeconds: number;
    sourceRevision: string;
    renderedAt: number;
}): AgentSectionRenderArtifact {
    const frameCount = input.sampleRate;
    return {
        ...input,
        owner: 'agent-section-render',
        retention: 'session',
        durationSeconds: 1,
        frameCount,
        channelCount: 2,
        byteSize: frameCount * 2 * Float32Array.BYTES_PER_ELEMENT,
        warnings: [],
        buffer: createTestAudioBuffer(input.sampleRate),
    };
}

function createRenderBatchFixture(
    input: { duplicateSecondJobId?: boolean; pendingCommandIndex?: number; singleCommand?: boolean } = {}
) {
    const jobs = [
        {
            jobId: 'render-verse',
            sectionId: 'section-verse',
            sectionName: 'Verse',
            startBeat: 0,
            endBeat: 16,
            sampleRate: 44_100,
            tailSeconds: 0,
        },
        {
            jobId: input.duplicateSecondJobId ? 'render-verse' : 'render-chorus',
            sectionId: 'section-chorus',
            sectionName: 'Chorus',
            startBeat: 16,
            endBeat: 32,
            sampleRate: 48_000,
            tailSeconds: 0.5,
        },
    ];
    const actions = input.singleCommand
        ? [
              {
                  type: 'renderProjectSections',
                  payload: { sectionIds: jobs.map(({ sectionId }) => sectionId), jobs },
              } satisfies AppAction,
          ]
        : jobs.map(
              (job) =>
                  ({
                      type: 'renderProjectSections',
                      payload: { sectionIds: [job.sectionId], jobs: [job] },
                  }) satisfies AppAction
          );
    const commands = actions.map((renderAction, index) =>
        createVersionedCommandEnvelope({
            action: renderAction,
            availableDeviceVersions: {},
            expectedEffect: `Render ${jobs[index]?.sectionName ?? 'section'}.`,
            normalizedProjectRevision: 'revision-1',
            objectReferences: [
                ...renderAction.payload.sectionIds.map((sectionId, sectionIndex) => ({
                    argument: `sectionIds[${String(sectionIndex)}]`,
                    id: sectionId,
                    scope: 'stable' as const,
                })),
                ...renderAction.payload.jobs.flatMap((job, jobIndex) => [
                    { argument: `jobs[${String(jobIndex)}].jobId`, id: job.jobId, scope: 'stable' as const },
                    { argument: `jobs[${String(jobIndex)}].sectionId`, id: job.sectionId, scope: 'stable' as const },
                ]),
            ],
            parameterUnits: renderAction.payload.jobs.flatMap((_job, jobIndex) => [
                { argument: `jobs[${String(jobIndex)}].startBeat`, unit: 'beats' },
                { argument: `jobs[${String(jobIndex)}].endBeat`, unit: 'beats' },
                { argument: `jobs[${String(jobIndex)}].sampleRate`, unit: 'unitless' },
                { argument: `jobs[${String(jobIndex)}].tailSeconds`, unit: 'seconds' },
            ]),
            reason: 'Create the confirmed section render.',
            time: renderAction.payload.jobs.flatMap((job, jobIndex) => [
                {
                    argument: `jobs[${String(jobIndex)}].startBeat`,
                    domain: 'musical' as const,
                    unit: 'beats',
                    value: job.startBeat,
                },
                {
                    argument: `jobs[${String(jobIndex)}].endBeat`,
                    domain: 'musical' as const,
                    unit: 'beats',
                    value: job.endBeat,
                },
                {
                    argument: `jobs[${String(jobIndex)}].tailSeconds`,
                    domain: 'absolute' as const,
                    unit: 'seconds',
                    value: job.tailSeconds,
                },
            ]),
        })
    );
    const renderCommandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-1',
        batchId: 'batch-render',
        projectId: 'project-1',
        baseRevision: 'revision-1',
        intent: 'Render the approved project sections.',
        commands: commands.map(serializeVersionedCommandEnvelope),
    });
    const parsed = parseVersionedCommandBatchEnvelope(renderCommandBatch.serialized, renderCommandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const executedActions = actions.map((renderAction, index) => ({
        action: renderAction,
        receipt: {
            commandId: commands[index]!.commandId,
            schemaVersion: commands[index]!.schemaVersion,
            applicationAssigned: { ids: [], timestamps: [] },
        },
    }));
    const pendingCommand = input.pendingCommandIndex === undefined ? undefined : commands[input.pendingCommandIndex];
    const warningDetails: CommittedWarningBatchResult['warningDetails'] = pendingCommand
        ? [
              {
                  kind: 'external-effect',
                  message: 'Renderer unavailable.',
                  commandId: pendingCommand.commandId,
                  pendingEffect: {
                      commandId: pendingCommand.commandId,
                      operation: 'renderProjectSections',
                      reason: 'Renderer unavailable.',
                      state: 'pending',
                      kind: 'external-effect',
                      remediation: 'reconcile',
                  },
              },
          ]
        : undefined;
    const renderReceipt = createVerifiedBatchReceipt({
        contentHash: 'receipt-render',
        envelope: parsed.envelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: 'revision-2',
        result: pendingCommand
            ? {
                  status: 'committed-with-warning',
                  actions: executedActions,
                  warning: 'Renderer unavailable.',
                  warningDetails,
              }
            : { status: 'committed', actions: executedActions },
    });
    const batchResult = pendingCommand
        ? ({
              status: 'committed-with-warning',
              actions: executedActions.map(({ action: executedAction, receipt: commandReceipt }) => ({
                  action: executedAction,
                  label: executedAction.type,
                  receipt: commandReceipt,
              })),
              receipt: renderReceipt,
              warning: 'Renderer unavailable.',
              warningDetails,
          } satisfies CommittedWarningBatchResult)
        : ({
              status: 'committed',
              actions: executedActions.map(({ action: executedAction, receipt: commandReceipt }) => ({
                  action: executedAction,
                  label: executedAction.type,
                  receipt: commandReceipt,
              })),
              receipt: renderReceipt,
          } satisfies CommittedBatchResult);
    const renderConfirmation = {
        ...confirmation,
        actions,
        approvalSnapshot: {
            ...confirmation.approvalSnapshot,
            actions,
            actionLabels: ['Render Verse', 'Render Chorus'],
            commandEnvelopes: commands.map(serializeVersionedCommandEnvelope),
            commandBatch: renderCommandBatch,
        },
        groupId: 'batch-render',
    } satisfies PendingAppActionConfirmation;
    return {
        actions,
        batchResult,
        commandBatch: renderCommandBatch,
        commands,
        confirmation: renderConfirmation,
        jobs,
        receipt: renderReceipt,
    };
}

function execute(
    options: {
        trackedWorkLease?: AgentRunWorkLease | null;
        priorVerifiedBatchReceipt?: typeof receipt | null;
        recoveringPendingEffects?: boolean;
        confirmation?: PendingAppActionConfirmation;
    } = {}
) {
    return executeConfirmedCommandBatch({
        confirmation: options.confirmation ?? confirmation,
        commandBatch,
        approvedBatchId: parsedBatchEnvelope.batchId,
        trackedWorkLease: options.trackedWorkLease === undefined ? lease : options.trackedWorkLease,
        priorVerifiedBatchReceipt: options.priorVerifiedBatchReceipt ?? null,
        recoveringPendingEffects: options.recoveringPendingEffects ?? false,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    collaboration.value = { localPeerId: 'actor-1' };
    projectMutationAuthorized = true;
    mocks.captureAuthorization.mockReturnValue(() => projectMutationAuthorized);
    mocks.captureRevision.mockReturnValue('revision-2');
    mocks.getArtifacts.mockReturnValue([]);
    mocks.rebindArtifacts.mockReset();
    mocks.prepareResourceLease.mockResolvedValue(undefined);
    mocks.protectResourceLease.mockReturnValue(undefined);
    mocks.prepareContinuation.mockReturnValue({ promote: () => undefined, discard: () => undefined });
    mocks.issueApprovalBinding.mockImplementation(({ commandBatch: approvedBatch }) =>
        issueCommandApprovalBinding({
            authority: approvedBatch.authority,
            serialized: approvedBatch.serialized,
            validate: () => ({ status: 'valid' }),
        })
    );
    mocks.bindCancellation.mockReturnValue(vi.fn());
    mocks.cancelRun.mockResolvedValue({
        status: 'cancelled',
        phase: 'cancelled',
        cancelledWorkIds: [],
        cleanupPendingAssetIds: [],
        releasedAssetIds: [],
    });
    mocks.retainCommitted.mockResolvedValue(undefined);
    mocks.executeBatch.mockResolvedValue(completedBatchResult);
});

describe('executeConfirmedCommandBatch', () => {
    it('should wire the confirmed batch through prepared resources, protection, and exact executor options', async () => {
        const events: string[] = [];
        const releaseCancellation = vi.fn(() => events.push('release-cancellation'));
        mocks.bindCancellation.mockReturnValue(releaseCancellation);
        mocks.prepareResourceLease.mockImplementation(async () => {
            events.push('prepare');
        });
        mocks.protectResourceLease.mockImplementation(() => {
            events.push('protect');
        });
        mocks.executeBatch.mockImplementation(async (input) => {
            events.push('execute');
            input.options?.onDeferredEffectAttempt?.({
                kind: 'work-attempt',
                operation: 'renderProjectSections',
                workId: 'render-1',
            });
            input.options?.onDeferredEffectAttempt?.({
                kind: 'work-attempt',
                operation: 'setTempo',
                workId: 'tempo-1',
            });
            input.onProjectCommitPrepared?.();
            input.options?.onProjectCommitCheckpoint?.({ receipt });
            input.options?.onProjectCommitFinalized?.({ receipt, revision: 'revision-checkpoint' });
            return completedBatchResult;
        });

        const result = await execute();

        expect(result).toMatchObject({
            status: 'completed',
            batchResult: completedBatchResult,
            group: { groupId: 'batch-1', groupLabel: 'Set tempo' },
            committedProjectRevision: 'revision-checkpoint',
            canRebindSectionRenderArtifacts: true,
            renderJobAttempts: 1,
            cancellationTriggeredByInvalidation: false,
            abortSignal: expect.objectContaining({ aborted: false }),
        });
        expect(mocks.prepareResourceLease).toHaveBeenCalledWith('confirmation-1', commandBatch);
        expect(mocks.issueApprovalBinding).toHaveBeenCalledWith({
            approval: confirmation.approvalSnapshot.agentApproval,
            commandBatch,
        });
        expect(mocks.executeBatch).toHaveBeenCalledWith({
            authority: commandBatch.authority,
            approvalBinding: expect.any(Object),
            serialized: commandBatch.serialized,
            onProjectCommitPrepared: expect.any(Function),
            options: expect.objectContaining({
                groupId: 'batch-1',
                groupLabel: 'Set tempo',
                source: 'prompt',
                requireCompensation: true,
                signal: expect.any(AbortSignal),
            }),
        });
        expect(mocks.prepareContinuation).toHaveBeenCalledWith({
            runId: 'run-1',
            receipt,
            commandBatch,
            getFinalizedRevision: expect.any(Function),
        });
        expect(mocks.prepareContinuation.mock.calls[0]?.[0].getFinalizedRevision?.()).toBe('revision-checkpoint');
        expect(mocks.captureAuthorization).toHaveBeenCalledOnce();
        expect(events).toEqual(['prepare', 'execute', 'protect', 'release-cancellation']);
        const boundController = mocks.bindCancellation.mock.calls[0]?.[0].controller;
        expect(mocks.bindCancellation).toHaveBeenCalledWith({
            runId: 'run-1',
            lease,
            controller: boundController,
            reason: 'User cancelled the run while confirmed command execution was active.',
        });
        expect(mocks.setActiveAborter).toHaveBeenNthCalledWith(1, boundController);
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.setChatGenerating).toHaveBeenNthCalledWith(1, true);
        expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
    });

    it('keeps fresh render artifacts unrebound when Command denies finalization after a foreign project mutation', async () => {
        mocks.getArtifacts.mockReturnValueOnce([]).mockReturnValueOnce([
            createRenderArtifact({
                jobId: 'render-1',
                sectionId: 'section-1',
                sectionName: 'Verse',
                startBeat: 0,
                endBeat: 16,
                sampleRate: 44_100,
                tailSeconds: 0,
                renderedAt: 1,
                sourceRevision: 'revision-before-command',
            }),
        ]);
        const renderConfirmation = {
            ...confirmation,
            approvalSnapshot: {
                ...confirmation.approvalSnapshot,
                actions: [
                    {
                        type: 'renderProjectSections',
                        payload: {
                            sectionIds: ['section-1'],
                            jobs: [
                                {
                                    jobId: 'render-1',
                                    sectionId: 'section-1',
                                    sectionName: 'Verse',
                                    startBeat: 0,
                                    endBeat: 16,
                                    sampleRate: 44_100,
                                    tailSeconds: 0,
                                },
                            ],
                        },
                    },
                ],
            },
        } satisfies PendingAppActionConfirmation;
        mocks.executeBatch.mockImplementation(async (input) => {
            projectMutationAuthorized = false;
            expect(input.options?.shouldFinalizeProjectCommit?.()).toBe(false);
            input.options?.onProjectCommitCheckpoint?.({ receipt });
            input.options?.onProjectCommitFinalizationUnavailable?.({
                reason: 'The project changed outside the confirmed command before finalization evidence was recorded.',
            });
            return completedBatchResult;
        });

        const result = await execute({ confirmation: renderConfirmation });

        expect(result).toMatchObject({
            status: 'completed',
            committedProjectRevision: null,
            canRebindSectionRenderArtifacts: false,
            finalizationEvidenceFailure:
                'The project changed outside the confirmed command before finalization evidence was recorded.',
        });
        expect(mocks.rebindArtifacts).not.toHaveBeenCalled();
        expect(mocks.prepareContinuation.mock.calls[0]?.[0].getFinalizedRevision?.()).toBeUndefined();
    });

    it('keeps exact final revision evidence when cancellation arrives during a post-commit effect', async () => {
        mocks.executeBatch.mockImplementation(async (input) => {
            const controller = mocks.bindCancellation.mock.calls[0]?.[0].controller;
            controller?.abort('cancelled after project commit');
            expect(input.options?.signal?.aborted).toBe(true);
            expect(input.options?.shouldFinalizeProjectCommit?.()).toBe(true);
            input.options?.onProjectCommitFinalized?.({ receipt, revision: 'revision-checkpoint' });
            return completedBatchResult;
        });

        const result = await execute();

        expect(result).toMatchObject({
            status: 'completed',
            committedProjectRevision: 'revision-checkpoint',
            canRebindSectionRenderArtifacts: true,
            finalizationEvidenceFailure: null,
            abortSignal: expect.objectContaining({ aborted: true }),
        });
    });

    it('keeps a rebind failure fail-closed after Command reports unavailable finalization evidence', async () => {
        const fixture = createRenderBatchFixture({ pendingCommandIndex: 1 });
        const verseArtifact = createRenderArtifact({
            ...fixture.jobs[0]!,
            renderedAt: 1,
            sourceRevision: 'revision-before-command',
        });
        mocks.getArtifacts.mockReturnValueOnce([]).mockReturnValueOnce([verseArtifact]);
        mocks.rebindArtifacts.mockImplementation(() => {
            throw new Error('render artifact vanished');
        });
        mocks.executeBatch.mockImplementation(async (input) => {
            input.options?.onProjectCommitCheckpoint?.({ receipt: fixture.receipt });
            try {
                input.options?.onProjectCommitFinalized?.({
                    receipt: fixture.receipt,
                    revision: 'revision-checkpoint',
                });
            } catch (error) {
                input.options?.onProjectCommitFinalizationUnavailable?.({
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
            return fixture.batchResult;
        });

        const result = await executeConfirmedCommandBatch({
            confirmation: fixture.confirmation,
            commandBatch: fixture.commandBatch,
            approvedBatchId: 'batch-render',
            trackedWorkLease: lease,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });
        expect(result).toMatchObject({
            status: 'completed',
            committedProjectRevision: 'revision-checkpoint',
            canRebindSectionRenderArtifacts: false,
            finalizationEvidenceFailure: 'render artifact vanished',
        });
        expect(mocks.rebindArtifacts).toHaveBeenCalledWith({
            artifacts: [
                {
                    job: fixture.jobs[0],
                    renderedAt: 1,
                    sourceRevision: 'revision-before-command',
                },
            ],
            sourceRevision: 'revision-checkpoint',
        });
    });

    it('rebinds every committed approved render action to the finalized revision', async () => {
        const fixture = createRenderBatchFixture();
        const artifacts = fixture.jobs.map((job, index) =>
            createRenderArtifact({
                ...job,
                renderedAt: index + 1,
                sourceRevision: 'revision-before-command',
            })
        );
        mocks.getArtifacts.mockReturnValueOnce([]).mockReturnValueOnce(artifacts);
        mocks.executeBatch.mockImplementation(async (input) => {
            input.options?.onProjectCommitCheckpoint?.({ receipt: fixture.receipt });
            input.options?.onProjectCommitFinalized?.({ receipt: fixture.receipt, revision: 'revision-checkpoint' });
            return fixture.batchResult;
        });

        const result = await executeConfirmedCommandBatch({
            confirmation: fixture.confirmation,
            commandBatch: fixture.commandBatch,
            approvedBatchId: 'batch-render',
            trackedWorkLease: lease,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });
        expect(result).toMatchObject({
            status: 'completed',
            canRebindSectionRenderArtifacts: true,
            finalizationEvidenceFailure: null,
        });
        expect(mocks.rebindArtifacts).toHaveBeenCalledWith({
            artifacts: fixture.jobs.map((job, index) => ({
                job,
                renderedAt: index + 1,
                sourceRevision: 'revision-before-command',
            })),
            sourceRevision: 'revision-checkpoint',
        });
    });

    it('does not require an artifact for a render command retained as a pending checkpoint effect', async () => {
        const fixture = createRenderBatchFixture({ pendingCommandIndex: 1 });
        const verseArtifact = createRenderArtifact({
            ...fixture.jobs[0]!,
            renderedAt: 1,
            sourceRevision: 'revision-before-command',
        });
        mocks.getArtifacts.mockReturnValueOnce([]).mockReturnValueOnce([verseArtifact]);
        mocks.executeBatch.mockImplementation(async (input) => {
            input.options?.onProjectCommitCheckpoint?.({ receipt });
            input.options?.onProjectCommitFinalized?.({ receipt: fixture.receipt, revision: 'revision-checkpoint' });
            return fixture.batchResult;
        });

        const result = await executeConfirmedCommandBatch({
            confirmation: fixture.confirmation,
            commandBatch: fixture.commandBatch,
            approvedBatchId: 'batch-render',
            trackedWorkLease: lease,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });

        expect(result).toMatchObject({ status: 'completed', canRebindSectionRenderArtifacts: true });
        expect(mocks.rebindArtifacts).toHaveBeenCalledWith({
            artifacts: [
                {
                    job: fixture.jobs[0],
                    renderedAt: 1,
                    sourceRevision: 'revision-before-command',
                },
            ],
            sourceRevision: 'revision-checkpoint',
        });
    });

    it('rebinds the successful job while a sibling job in the same pending render command remains missing', async () => {
        const fixture = createRenderBatchFixture({ pendingCommandIndex: 0, singleCommand: true });
        const verseArtifact = createRenderArtifact({
            ...fixture.jobs[0]!,
            renderedAt: 1,
            sourceRevision: 'revision-before-command',
        });
        mocks.getArtifacts.mockReturnValueOnce([]).mockReturnValueOnce([verseArtifact]);
        mocks.executeBatch.mockImplementation(async (input) => {
            input.options?.onProjectCommitCheckpoint?.({ receipt: fixture.receipt });
            input.options?.onProjectCommitFinalized?.({ receipt: fixture.receipt, revision: 'revision-checkpoint' });
            return fixture.batchResult;
        });

        const result = await executeConfirmedCommandBatch({
            confirmation: fixture.confirmation,
            commandBatch: fixture.commandBatch,
            approvedBatchId: 'batch-render',
            trackedWorkLease: lease,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });

        expect(result).toMatchObject({ status: 'completed', canRebindSectionRenderArtifacts: true });
        expect(mocks.rebindArtifacts).toHaveBeenCalledWith({
            artifacts: [
                {
                    job: fixture.jobs[0],
                    renderedAt: 1,
                    sourceRevision: 'revision-before-command',
                },
            ],
            sourceRevision: 'revision-checkpoint',
        });
    });

    it('withholds finalization when an exact matching render artifact predates execution', async () => {
        const fixture = createRenderBatchFixture();
        const verseArtifact = createRenderArtifact({
            ...fixture.jobs[0]!,
            renderedAt: 1,
            sourceRevision: 'revision-before-command',
        });
        const chorusArtifact = createRenderArtifact({
            ...fixture.jobs[1]!,
            renderedAt: 2,
            sourceRevision: 'revision-before-command',
        });
        mocks.getArtifacts.mockReturnValueOnce([verseArtifact]).mockReturnValueOnce([verseArtifact, chorusArtifact]);
        mocks.executeBatch.mockImplementation(async (input) => {
            try {
                input.options?.onProjectCommitFinalized?.({
                    receipt: fixture.receipt,
                    revision: 'revision-checkpoint',
                });
            } catch (error) {
                input.options?.onProjectCommitFinalizationUnavailable?.({
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
            return fixture.batchResult;
        });

        const result = await executeConfirmedCommandBatch({
            confirmation: fixture.confirmation,
            commandBatch: fixture.commandBatch,
            approvedBatchId: 'batch-render',
            trackedWorkLease: lease,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });

        expect(result).toMatchObject({
            status: 'completed',
            canRebindSectionRenderArtifacts: false,
            finalizationEvidenceFailure:
                'Exactly one fresh section render artifact is required for committed job render-verse.',
        });
        expect(mocks.rebindArtifacts).not.toHaveBeenCalled();
    });

    it.each([
        ['job ID', { jobId: 'wrong-job' }],
        ['section ID', { sectionId: 'wrong-section' }],
        ['section name', { sectionName: 'Wrong section' }],
        ['start beat', { startBeat: 4 }],
        ['end beat', { endBeat: 15 }],
        ['sample rate', { sampleRate: 96_000 }],
        ['tail seconds', { tailSeconds: 2 }],
    ])('does not rebind a fresh render artifact with the wrong %s', async (_label, mutation) => {
        const fixture = createRenderBatchFixture();
        const verseArtifact = createRenderArtifact({
            ...fixture.jobs[0]!,
            ...mutation,
            renderedAt: Date.now() + 1,
            sourceRevision: 'revision-before-command',
        });
        const chorusArtifact = createRenderArtifact({
            ...fixture.jobs[1]!,
            renderedAt: Date.now() + 2,
            sourceRevision: 'revision-before-command',
        });
        mocks.getArtifacts.mockReturnValueOnce([]).mockReturnValueOnce([verseArtifact, chorusArtifact]);
        mocks.executeBatch.mockImplementation(async (input) => {
            try {
                input.options?.onProjectCommitFinalized?.({
                    receipt: fixture.receipt,
                    revision: 'revision-checkpoint',
                });
            } catch (error) {
                input.options?.onProjectCommitFinalizationUnavailable?.({
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
            return fixture.batchResult;
        });

        const result = await executeConfirmedCommandBatch({
            confirmation: fixture.confirmation,
            commandBatch: fixture.commandBatch,
            approvedBatchId: 'batch-render',
            trackedWorkLease: lease,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });

        expect(result).toMatchObject({
            status: 'completed',
            canRebindSectionRenderArtifacts: false,
            finalizationEvidenceFailure:
                'Exactly one fresh section render artifact is required for committed job render-verse.',
        });
        expect(mocks.rebindArtifacts).not.toHaveBeenCalled();
    });

    it.each([
        [
            'missing artifact',
            createRenderBatchFixture(),
            'Exactly one fresh section render artifact is required for committed job render-chorus.',
        ],
        [
            'duplicate approved job identity',
            createRenderBatchFixture({ duplicateSecondJobId: true }),
            'The approved section render job identity is ambiguous: render-verse.',
        ],
        [
            'mismatched action and command payloads',
            (() => {
                const fixture = createRenderBatchFixture();
                fixture.confirmation.approvalSnapshot.actions.reverse();
                return fixture;
            })(),
            expect.stringContaining('The approved render command payload does not match action'),
        ],
    ])('fails finalization evidence closed for %s', async (_label, fixture, expectedFailure) => {
        const verseArtifact = createRenderArtifact({
            ...fixture.jobs[0]!,
            renderedAt: 1,
            sourceRevision: 'revision-before-command',
        });
        mocks.getArtifacts.mockReturnValueOnce([]).mockReturnValueOnce([verseArtifact]);
        mocks.executeBatch.mockImplementation(async (input) => {
            input.options?.onProjectCommitCheckpoint?.({ receipt: fixture.receipt });
            try {
                input.options?.onProjectCommitFinalized?.({
                    receipt: fixture.receipt,
                    revision: 'revision-checkpoint',
                });
            } catch (error) {
                input.options?.onProjectCommitFinalizationUnavailable?.({
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
            return fixture.batchResult;
        });

        const result = await executeConfirmedCommandBatch({
            confirmation: fixture.confirmation,
            commandBatch: fixture.commandBatch,
            approvedBatchId: 'batch-render',
            trackedWorkLease: lease,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });

        expect(result).toMatchObject({
            status: 'completed',
            canRebindSectionRenderArtifacts: false,
            finalizationEvidenceFailure: expectedFailure,
        });
    });

    it('fails finalization evidence closed when a committed job has duplicate fresh matching artifacts', async () => {
        const fixture = createRenderBatchFixture();
        const verseArtifact = createRenderArtifact({
            ...fixture.jobs[0]!,
            renderedAt: 1,
            sourceRevision: 'revision-before-command',
        });
        const chorusArtifact = createRenderArtifact({
            ...fixture.jobs[1]!,
            renderedAt: 2,
            sourceRevision: 'revision-before-command',
        });
        mocks.getArtifacts
            .mockReturnValueOnce([])
            .mockReturnValueOnce([verseArtifact, chorusArtifact, { ...chorusArtifact, renderedAt: 3 }]);
        mocks.executeBatch.mockImplementation(async (input) => {
            input.options?.onProjectCommitCheckpoint?.({ receipt: fixture.receipt });
            try {
                input.options?.onProjectCommitFinalized?.({
                    receipt: fixture.receipt,
                    revision: 'revision-checkpoint',
                });
            } catch (error) {
                input.options?.onProjectCommitFinalizationUnavailable?.({
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
            return fixture.batchResult;
        });

        const result = await executeConfirmedCommandBatch({
            confirmation: fixture.confirmation,
            commandBatch: fixture.commandBatch,
            approvedBatchId: 'batch-render',
            trackedWorkLease: lease,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });

        expect(result).toMatchObject({
            status: 'completed',
            canRebindSectionRenderArtifacts: false,
            finalizationEvidenceFailure:
                'Exactly one fresh section render artifact is required for committed job render-chorus.',
        });
        expect(mocks.rebindArtifacts).not.toHaveBeenCalled();
    });

    it('should derive the approved batch group ID when confirmation metadata differs or is incomplete', async () => {
        const mismatchedGroupConfirmation = {
            ...confirmation,
            groupId: 'unapproved-group-1',
            groupLabel: undefined,
        } satisfies PendingAppActionConfirmation;
        const missingGroupConfirmation = {
            ...confirmation,
            groupId: undefined,
            groupLabel: undefined,
        } satisfies PendingAppActionConfirmation;

        const result = await execute({ confirmation: mismatchedGroupConfirmation });

        expect(result).toMatchObject({
            status: 'completed',
            group: { groupId: 'batch-1', groupLabel: confirmation.prompt },
        });
        expect(mocks.executeBatch).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({ groupId: 'batch-1', groupLabel: confirmation.prompt }),
            })
        );

        mocks.prepareResourceLease.mockRejectedValueOnce(new Error('pending-effect continuation failed'));

        await expect(
            execute({
                confirmation: missingGroupConfirmation,
                priorVerifiedBatchReceipt: receipt,
                recoveringPendingEffects: true,
            })
        ).resolves.toMatchObject({ status: 'recovery-failed' });

        expect(mocks.recordCommittedRecoveryFailure).toHaveBeenLastCalledWith(missingGroupConfirmation, {
            category: 'internal',
            retriable: false,
            receipt,
            actions: missingGroupConfirmation.actions,
            commandBatch,
            revertGroupId: 'batch-1',
            committedRevision: 'revision-2',
        });
        expect(mocks.recordReceipt).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'actor changes',
            configure: () => {
                collaboration.value = { localPeerId: 'actor-2' };
            },
        },
        {
            name: 'the abort controller is aborted',
            configure: () => {
                const controller = mocks.setActiveAborter.mock.calls[0]?.[0];
                if (!(controller instanceof AbortController)) {
                    throw new Error('Expected the active abort controller.');
                }
                controller.abort();
            },
        },
        {
            name: 'a foreign project mutation invalidates authorization',
            configure: () => {
                projectMutationAuthorized = false;
            },
        },
    ])('should refuse execution when $name', async ({ configure }) => {
        mocks.executeBatch.mockImplementation(async (input) => {
            configure();
            expect(input.options?.shouldExecute?.()).toBe(false);
            return cancelledBatchResult;
        });

        const result = await execute();

        expect(result).toMatchObject({ status: 'completed', batchResult: { status: 'cancelled' } });
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        expect(mocks.updateMessage).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'resource preparation fails',
            configure: () => mocks.prepareResourceLease.mockRejectedValue(new Error('resource preparation failed')),
        },
        {
            name: 'the command executor fails',
            configure: () => mocks.executeBatch.mockRejectedValue(new Error('command execution failed')),
        },
    ])('should clean up and return the error to the adapter when $name', async ({ configure }) => {
        const releaseCancellation = vi.fn();
        mocks.bindCancellation.mockReturnValue(releaseCancellation);
        configure();

        const result = await execute();

        expect(result).toMatchObject({ status: 'failed' });
        expect(releaseCancellation).toHaveBeenCalledOnce();
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        expect(mocks.updateMessage).not.toHaveBeenCalled();
        expect(mocks.retainCommitted).not.toHaveBeenCalled();
    });

    it('should omit a fresh approval binding and preserve durable state during verified receipt recovery', async () => {
        const result = await execute({
            trackedWorkLease: null,
            priorVerifiedBatchReceipt: receipt,
            recoveringPendingEffects: true,
        });

        expect(result).toMatchObject({ status: 'completed', batchResult: completedBatchResult });
        expect(mocks.issueApprovalBinding).not.toHaveBeenCalled();
        expect(mocks.bindCancellation).not.toHaveBeenCalled();
        expect(mocks.cancelRun).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        expect(mocks.updateMessage).not.toHaveBeenCalled();
        expect(mocks.retainCommitted).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'resource preparation rejects before replay completes',
            configure: () =>
                mocks.prepareResourceLease.mockRejectedValue(new Error('pending-effect continuation failed')),
            recoveringPendingEffects: false,
        },
        {
            name: 'the command executor rejects during pending-effect recovery',
            configure: () => mocks.executeBatch.mockRejectedValue(new Error('pending-effect continuation failed')),
            recoveringPendingEffects: true,
        },
    ])('should retain durable receipt resources when $name', async ({ configure, recoveringPendingEffects }) => {
        const releaseCancellation = vi.fn();
        mocks.bindCancellation.mockReturnValue(releaseCancellation);
        configure();

        const result = await execute({ priorVerifiedBatchReceipt: receipt, recoveringPendingEffects });

        expect(result).toMatchObject({ status: 'recovery-failed' });
        expect(mocks.retainCommitted).toHaveBeenCalledWith('confirmation-1');
        expect(mocks.updateConfirmation).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'failed',
            error: 'pending-effect continuation failed',
        });
        expect(mocks.updateMessage).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'failed',
            error: 'pending-effect continuation failed',
            content:
                'The project change remains durably committed, but pending-effect reconciliation could not continue: pending-effect continuation failed',
        });
        expect(mocks.recordCommittedRecoveryFailure).toHaveBeenCalledExactlyOnceWith(confirmation, {
            category: 'internal',
            retriable: false,
            receipt,
            actions: confirmation.actions,
            commandBatch,
            revertGroupId: 'batch-1',
            committedRevision: 'revision-2',
        });
        expect(mocks.recordReceipt).not.toHaveBeenCalled();
        expect(mocks.recordPostCommitRecoveryFailure).not.toHaveBeenCalled();
        expect(releaseCancellation).toHaveBeenCalledOnce();
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
    });

    it.each(['no-op', 'cancelled', 'ambiguous', 'failed'] as const)(
        'should return ordinary failure for a non-durable prior $status receipt',
        async (status) => {
            mocks.prepareResourceLease.mockRejectedValue(new Error('resource preparation failed'));

            const result = await execute({
                priorVerifiedBatchReceipt: createNonDurableReceipt(status),
                recoveringPendingEffects: true,
            });

            expect(result).toMatchObject({ status: 'failed' });
            expect(mocks.retainCommitted).not.toHaveBeenCalled();
            expect(mocks.updateConfirmation).not.toHaveBeenCalled();
            expect(mocks.updateMessage).not.toHaveBeenCalled();
        }
    );

    it('should return ordinary failure for an executed runtime receipt without retaining project resources', async () => {
        mocks.prepareResourceLease.mockRejectedValue(new Error('resource preparation failed'));

        const result = await execute({
            priorVerifiedBatchReceipt: createRuntimeReceipt(),
            recoveringPendingEffects: true,
        });

        expect(result).toMatchObject({ status: 'failed' });
        expect(mocks.retainCommitted).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        expect(mocks.updateMessage).not.toHaveBeenCalled();
        expect(mocks.recordReceipt).not.toHaveBeenCalled();
        expect(mocks.recordPostCommitRecoveryFailure).not.toHaveBeenCalled();
    });

    it('should avoid a split receipt writer when recovery settlement reports a persistence warning', async () => {
        mocks.prepareResourceLease.mockRejectedValue(new Error('pending-effect continuation failed'));
        mocks.recordCommittedRecoveryFailure.mockReturnValue('Agent run persistence warning.');

        const result = await execute({ priorVerifiedBatchReceipt: receipt, recoveringPendingEffects: true });

        const reason = 'pending-effect continuation failed Agent run persistence warning.';
        expect(result).toMatchObject({ status: 'recovery-failed', result: { reason } });
        expect(mocks.updateConfirmation).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'failed',
            error: reason,
        });
        expect(mocks.updateMessage).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'failed',
            error: reason,
            content: `The project change remains durably committed, but pending-effect reconciliation could not continue: ${reason}`,
        });
        expect(mocks.recordCommittedRecoveryFailure).toHaveBeenCalledExactlyOnceWith(confirmation, {
            category: 'internal',
            retriable: false,
            receipt,
            actions: confirmation.actions,
            commandBatch,
            revertGroupId: 'batch-1',
            committedRevision: 'revision-2',
        });
        expect(mocks.recordReceipt).not.toHaveBeenCalled();
        expect(mocks.recordPostCommitRecoveryFailure).not.toHaveBeenCalled();
    });

    it('should surface a terminal lifecycle persistence warning through committed-effect recovery failure', async () => {
        mocks.prepareResourceLease.mockRejectedValue(new Error('pending-effect continuation failed'));
        mocks.recordCommittedRecoveryFailure.mockReturnValue('Terminal lifecycle persistence warning.');

        const result = await execute({ priorVerifiedBatchReceipt: receipt, recoveringPendingEffects: true });

        const reason = 'pending-effect continuation failed Terminal lifecycle persistence warning.';
        expect(result).toMatchObject({ status: 'recovery-failed', result: { reason } });
        expect(mocks.updateConfirmation).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'failed',
            error: reason,
        });
        expect(mocks.updateMessage).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'failed',
            error: reason,
            content: `The project change remains durably committed, but pending-effect reconciliation could not continue: ${reason}`,
        });
        expect(mocks.recordReceipt).not.toHaveBeenCalled();
        expect(mocks.recordCommittedRecoveryFailure).toHaveBeenCalledOnce();
    });

    it('should release preview resources and return the exact preview-mode failure', async () => {
        const resource = { baseRevision: 'revision-1', release: vi.fn() };
        const previewedBatchResult = { status: 'previewed' as const, resource } satisfies PreviewedBatchResult;
        mocks.executeBatch.mockResolvedValue(previewedBatchResult);

        const result = await execute();

        expect(resource.release).toHaveBeenCalledOnce();
        expect(result).toEqual({
            status: 'failed',
            error: new Error('A confirmed command batch cannot execute in preview mode'),
        });
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
    });
});
