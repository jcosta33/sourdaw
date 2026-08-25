import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';

import {
    clearPendingActionConfirmations,
    commitPendingActionResourceLease,
    getPendingActionConfirmation,
    proposePendingActionConfirmation as storePendingActionConfirmation,
    settlePendingActionResourceLease,
} from '../../stores/pendingActionConfirmationStore';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { confirmPendingChatActions } from '../confirmPendingChatActions';

type ExecuteAppActionBatch = (typeof import('#/modules/Command/useCases'))['executeAppActionBatch'];
type AppAction = Parameters<ExecuteAppActionBatch>[0][number];

const chatGenerationState = vi.hoisted(() => ({ value: false }));
const projectMutationAuthorization = vi.hoisted(() => {
    const isAuthorized = vi.fn<() => boolean>(() => true);
    return {
        capture: vi.fn<() => () => boolean>(() => isAuthorized),
        isAuthorized,
    };
});

const mocks = vi.hoisted(() => ({
    projectRevision: { value: 'revision-1' },
    executeAppAction: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    executeAppActionBatch: vi.fn<ExecuteAppActionBatch>(),
    executeVersionedCommandBatchEnvelope: vi.fn(),
    describeAction: vi.fn((_action: AppAction) => 'Remove track'),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'delete drums' })),
    pushAiActionGroup: vi.fn(),
    updateChatMessage: vi.fn(),
    setActiveAborter: vi.fn<(aborter: AbortController | null) => void>(),
    setChatGenerating: vi.fn((isGenerating: boolean) => {
        chatGenerationState.value = isGenerating;
    }),
    notifyAiChange: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectMutationAuthorization: projectMutationAuthorization.capture,
    captureProjectRevision: () => mocks.projectRevision.value,
}));

vi.mock('#/modules/Command/useCases', async (import_original) => ({
    ...(await import_original<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: mocks.executeAppAction,
    executeAppActionBatch: mocks.executeAppActionBatch,
    executeVersionedCommandBatchEnvelope: mocks.executeVersionedCommandBatchEnvelope,
    describeAction: mocks.describeAction,
    generateGroupId: mocks.generateGroupId,
}));

vi.mock('../../stores/chatStore', () => ({
    chatStore: {
        get value() {
            return { isGenerating: chatGenerationState.value };
        },
    },
    setActiveAborter: mocks.setActiveAborter,
    setChatGenerating: mocks.setChatGenerating,
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../../stores/aiActionHistoryStore', () => ({
    pushAiActionGroup: mocks.pushAiActionGroup,
}));

vi.mock('../notifyAiChange', () => ({
    notifyAiChange: mocks.notifyAiChange,
}));

const pendingAction: AppAction = { type: 'removeTrack', payload: { trackId: 'track-1' } };
const secondPendingAction: AppAction = { type: 'removeClip', payload: { clipId: 'clip-1' } };
const runtimeOnlyAction: AppAction = { type: 'setPlayback', payload: { playing: true } };
const approvedActionsByBatch = new Map<string, AppAction[]>();

function proposePendingActionConfirmation(
    input: Parameters<typeof storePendingActionConfirmation>[0]
): ReturnType<typeof storePendingActionConfirmation> {
    const commands = input.actions.map((action, index) =>
        serializeVersionedCommandEnvelope(
            migrateLegacyAppActionToVersionedCommandEnvelope({
                action,
                expectedEffect: input.actionLabels[index] ?? action.type,
                normalizedProjectRevision: input.projectRevision,
                options: {
                    groupId: input.groupId ?? input.id,
                    groupLabel: input.groupLabel ?? input.prompt,
                    source: 'prompt',
                },
            })
        )
    );
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: input.id,
        batchId: input.groupId ?? input.id,
        projectId: input.projectRevision,
        baseRevision: input.projectRevision,
        intent: input.prompt,
        commands,
        dynamicEffects: {
            affectedTrackIds: [],
            affectedClipIds: [],
            affectedTargetIds: [],
            automationPoints: 0,
            deletedObjects: 0,
        },
    });
    approvedActionsByBatch.set(commandBatch.serialized, input.actions);
    return storePendingActionConfirmation({
        ...input,
        commandBatch,
        agentApproval: compileAgentRiskApproval({ commandBatch }),
    });
}

function proposePendingAppAction(
    id: string,
    resourceLease?: Parameters<typeof storePendingActionConfirmation>[0]['resourceLease']
): void {
    proposePendingActionConfirmation({
        id,
        prompt: 'delete drums',
        assistantMessageId: 'assistant-1',
        actions: [pendingAction],
        actionLabels: ['Remove track'],
        executionMode: 'atomic',
        projectRevision: 'revision-1',
        resourceLease,
    });
}

describe('pending chat action confirmation', () => {
    beforeEach(() => {
        commandBatchPreflightPort.setProvider(({ targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'revision-1',
            projectInvariantsValid: true,
            targetFingerprints: Object.fromEntries(targetIds.map((targetId) => [targetId, `fp:${targetId}`])),
        }));
        vi.clearAllMocks();
        approvedActionsByBatch.clear();
        clearHandlerRegistry();
        registerHandlerMap({
            removeTrack: {
                execute: () => undefined,
                describe: () => ({ label: 'Remove track' }),
                undoable: false,
                validate: () => true,
            },
            removeClip: {
                execute: () => undefined,
                describe: () => ({ label: 'Remove clip' }),
                undoable: false,
                validate: () => true,
            },
            setPlayback: {
                execute: () => undefined,
                describe: () => ({ label: 'Set playback' }),
                undoable: false,
                validate: () => true,
            },
        });
        clearPendingActionConfirmations();
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.executeAppActionBatch.mockImplementation((actions: Parameters<ExecuteAppActionBatch>[0]) =>
            Promise.resolve({
                status: 'committed',
                actions: actions.map((action) => ({
                    action,
                    label: mocks.describeAction(action),
                })),
            })
        );
        mocks.executeVersionedCommandBatchEnvelope.mockImplementation(
            ({ serialized, options }: { serialized: string; options?: Parameters<ExecuteAppActionBatch>[1] }) =>
                mocks.executeAppActionBatch(approvedActionsByBatch.get(serialized) ?? [], options)
        );
        mocks.describeAction.mockReturnValue('Remove track');
        mocks.generateGroupId.mockReturnValue({ groupId: 'group-1', groupLabel: 'delete drums' });
        mocks.projectRevision.value = 'revision-1';
        projectMutationAuthorization.isAuthorized.mockImplementation(
            () => mocks.projectRevision.value === 'revision-1'
        );
        chatGenerationState.value = false;
    });

    afterEach(() => {
        commandBatchPreflightPort.setProvider(null);
        clearHandlerRegistry();
        vi.restoreAllMocks();
    });

    it('should execute a proposed action group only after explicit confirmation', async () => {
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction],
            actionLabels: ['Remove track'],
            projectRevision: 'revision-1',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(projectMutationAuthorization.capture).toHaveBeenCalledOnce();
        expect(mocks.executeAppActionBatch.mock.calls[0]?.[0]).toEqual([pendingAction]);
        expect(mocks.executeAppActionBatch.mock.calls[0]?.[1]).toMatchObject({
            groupId: 'group-1',
            groupLabel: 'delete drums',
            source: 'prompt',
            requireCompensation: false,
        });
        expect(typeof mocks.executeAppActionBatch.mock.calls[0]?.[1]?.shouldExecute).toBe('function');
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith({
            id: 'group-1',
            prompt: 'delete drums',
            actions: [{ kind: 'appAction', actionType: 'removeTrack', label: 'Remove track' }],
            groupId: 'group-1',
            timestamp: expect.any(Number),
            reverted: false,
            executionKind: 'project',
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Confirmed: delete drums', ['removeTrack']);
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                content: expect.stringContaining('Executed'),
            })
        );
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('executed');
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([
            {
                actionType: 'removeTrack',
                label: 'Remove track',
                executionKind: 'project',
                affectedIds: ['track-1'],
                outcome: 'committed',
            },
        ]);
    });

    it('invalidates an app-action proposal when the project revision changed before confirmation', async () => {
        proposePendingAppAction('confirm-stale');
        mocks.projectRevision.value = 'revision-2';

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-stale' });

        expect(result).toEqual({
            status: 'invalidated',
            reason: 'The project changed after this proposal was created. Review and submit the command again.',
        });
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation('confirm-stale')?.status).toBe('invalidated');
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'invalidated',
                content: expect.stringContaining('project changed'),
            })
        );
    });

    it('invalidates an app-action proposal when its revision changes during batch admission', async () => {
        mocks.executeAppActionBatch.mockImplementationOnce((_actions, options) => {
            mocks.projectRevision.value = 'revision-2';
            if (!options?.shouldExecute?.()) {
                return Promise.resolve({
                    status: 'cancelled',
                    reason: 'Batch execution authority was revoked',
                    actions: [],
                });
            }
            return Promise.resolve({ status: 'no-op', actions: [] });
        });
        proposePendingAppAction('confirm-racing');

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-racing' });

        expect(result.status).toBe('invalidated');
        expect(getPendingActionConfirmation('confirm-racing')?.status).toBe('invalidated');
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
    });

    it('invalidates an app-action proposal when mutation authorization is revoked during batch admission', async () => {
        mocks.executeAppActionBatch.mockImplementationOnce((_actions, options) => {
            projectMutationAuthorization.isAuthorized.mockReturnValue(false);
            if (!options?.shouldExecute?.()) {
                return Promise.resolve({
                    status: 'cancelled',
                    reason: 'Batch execution authority was revoked',
                    actions: [],
                });
            }
            return Promise.resolve({ status: 'no-op', actions: [] });
        });
        proposePendingAppAction('confirm-authorization-revoked');

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-authorization-revoked' });

        expect(result.status).toBe('invalidated');
        expect(projectMutationAuthorization.isAuthorized).toHaveBeenCalled();
        expect(getPendingActionConfirmation('confirm-authorization-revoked')?.status).toBe('invalidated');
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
    });

    it('lets Stop cancel an accepted app-action confirmation before commit', async () => {
        const releaseError = new Error('durable release interrupted');
        let failRelease: (() => void) | undefined;
        const releasePending = new Promise<void>((_resolve, reject) => {
            failRelease = () => reject(releaseError);
        });
        const release = vi.fn(() => releasePending);
        const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        mocks.executeAppActionBatch.mockImplementationOnce((_actions, options) => {
            const activeAborter = mocks.setActiveAborter.mock.calls.find(
                (call) => call[0] instanceof AbortController
            )?.[0];
            if (!activeAborter) {
                throw new Error('Expected confirmed execution to expose Stop authority');
            }
            activeAborter.abort();
            expect(options?.shouldExecute?.()).toBe(false);
            return Promise.resolve({
                status: 'cancelled',
                reason: 'Batch execution authority was revoked',
                actions: [],
            });
        });
        proposePendingAppAction('confirm-stop', { bytes: 1, release });

        let confirmationSettled = false;
        const confirmation = confirmPendingChatActions({ confirmationId: 'confirm-stop' }).then((result) => {
            confirmationSettled = true;
            return result;
        });
        await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
        expect(confirmationSettled).toBe(false);
        failRelease?.();
        const result = await confirmation;

        expect(result).toEqual({ status: 'cancelled' });
        expect(getPendingActionConfirmation('confirm-stop')?.status).toBe('cancelled');
        expect(mocks.setChatGenerating.mock.calls).toEqual([[true], [false]]);
        expect(mocks.setActiveAborter.mock.calls[0]?.[0]).toBeInstanceOf(AbortController);
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Confirmed AI action resource cleanup failed; the durable lease remains retryable',
                cause: releaseError,
            })
        );
        release.mockResolvedValueOnce(undefined);
        await settlePendingActionResourceLease({ confirmationId: 'confirm-stop', disposition: 'discard' });
        expect(release).toHaveBeenCalledTimes(2);
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'cancelled',
                error: undefined,
                content: 'Command cancelled before it committed. No project changes were applied.',
            })
        );
    });

    it('keeps committed resources retained when cancellation races a failed promotion commit', async () => {
        let rejectPromotionCommit: ((error: Error) => void) | undefined;
        const deferredPromotionCommit = new Promise<void>((_resolve, reject) => {
            rejectPromotionCommit = reject;
        });
        const commit = vi
            .fn<() => Promise<void>>()
            .mockImplementationOnce(() => deferredPromotionCommit)
            .mockResolvedValueOnce(undefined);
        const retain = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        proposePendingAppAction('confirm-committed-race', { bytes: 1, commit, retain, release });

        const confirmation = confirmPendingChatActions({ confirmationId: 'confirm-committed-race' });
        await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());

        await expect(
            settlePendingActionResourceLease({ confirmationId: 'confirm-committed-race', disposition: 'discard' })
        ).resolves.toBeUndefined();
        expect(release).not.toHaveBeenCalled();

        rejectPromotionCommit?.(new Error('promotion commit interrupted'));
        await expect(confirmation).resolves.toEqual({ status: 'executed' });
        expect(retain).not.toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Committed resource recovery could not be made executable',
            })
        );

        await expect(commitPendingActionResourceLease('confirm-committed-race')).resolves.toBeUndefined();
        await expect(
            settlePendingActionResourceLease({ confirmationId: 'confirm-committed-race', disposition: 'retain' })
        ).resolves.toBeUndefined();
        expect(commit).toHaveBeenCalledTimes(2);
        expect(retain).toHaveBeenCalledOnce();
        expect(release).not.toHaveBeenCalled();
    });

    it('keeps a second app-action confirmation proposed while another AI execution owns Stop', async () => {
        const firstBatchControl: { release: () => void } = {
            release: () => {
                throw new Error('Expected the first confirmed batch to be pending');
            },
        };
        mocks.executeAppActionBatch.mockImplementationOnce(
            (actions) =>
                new Promise((resolve) => {
                    firstBatchControl.release = () => {
                        resolve({
                            status: 'committed',
                            actions: actions.map((action) => ({ action, label: mocks.describeAction(action) })),
                        });
                    };
                })
        );
        proposePendingActionConfirmation({
            id: 'confirm-first',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-first',
            actions: [pendingAction],
            actionLabels: ['Remove track'],
            projectRevision: 'revision-1',
        });
        proposePendingActionConfirmation({
            id: 'confirm-second',
            prompt: 'delete chorus',
            assistantMessageId: 'assistant-second',
            actions: [secondPendingAction],
            actionLabels: ['Remove clip'],
            projectRevision: 'revision-1',
        });

        const firstConfirmation = confirmPendingChatActions({ confirmationId: 'confirm-first' });
        await vi.waitFor(() => expect(mocks.setActiveAborter).toHaveBeenCalledTimes(1));
        const firstAborter = mocks.setActiveAborter.mock.calls[0]?.[0];
        const secondResult = await confirmPendingChatActions({ confirmationId: 'confirm-second' });

        expect(firstAborter).toBeInstanceOf(AbortController);
        expect(secondResult).toEqual({ status: 'busy' });
        expect(getPendingActionConfirmation('confirm-second')?.status).toBe('proposed');
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-second',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'proposed',
                content: expect.stringMatching(/still running.*remains pending/is),
            })
        );
        expect(mocks.executeAppActionBatch).toHaveBeenCalledTimes(1);
        expect(mocks.setActiveAborter).toHaveBeenCalledTimes(1);
        firstBatchControl.release();
        await expect(firstConfirmation).resolves.toEqual({ status: 'executed' });
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(chatGenerationState.value).toBe(false);
    });

    it('should cancel proposed actions without executing them', async () => {
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction],
            actionLabels: ['Remove track'],
            projectRevision: 'revision-1',
        });

        const result = await cancelPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'cancelled' });
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).toHaveBeenCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'cancelled',
                content: expect.stringContaining('Cancelled'),
            })
        );
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('cancelled');
    });

    it('should report a missing handler as not executed without dropping the proposal record', async () => {
        const missing_handler = new Error('No handler registered for action: removeClip');
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'rejected',
            reason: missing_handler.message,
            actions: [],
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction, secondPendingAction],
            actionLabels: ['Remove track', 'Remove clip'],
            executionMode: 'atomic',
            projectRevision: 'revision-1',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'failed', reason: missing_handler.message });
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                error: missing_handler.message,
                pendingActionConfirmationStatus: 'failed',
                content: expect.stringMatching(/failed.*atomically/is),
            })
        );
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('failed');
        expect(getPendingActionConfirmation('confirm-1')?.error).toBe(missing_handler.message);
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([]);
    });

    it('should preserve an ambiguous confirmed batch without claiming any action executed', async () => {
        const reason = 'Automerge storage transaction committed before a later document failed';
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'ambiguous',
            reason,
            actions: [],
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction, secondPendingAction],
            actionLabels: ['Remove track', 'Remove clip'],
            executionMode: 'atomic',
            projectRevision: 'revision-1',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'failed', reason });
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([]);
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                error: reason,
                pendingActionConfirmationStatus: 'failed',
                content: expect.stringMatching(/uncertain partial commit.*do not retry/is),
            })
        );
    });

    it('should record a committed confirmation action as executed and warn against retrying', async () => {
        const warning = 'transport synchronization unavailable';
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'committed-with-warning',
            actions: [{ action: pendingAction, label: 'Remove track' }],
            warning,
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction],
            actionLabels: ['Remove track'],
            protectedUnchanged: [{ id: 'track-parallel', name: 'Parallel Compression' }],
            projectRevision: 'revision-1',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('executed');
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([
            {
                actionType: 'removeTrack',
                label: 'Remove track',
                executionKind: 'project',
                affectedIds: ['track-1'],
                outcome: 'committed-with-warning',
            },
        ]);
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [{ kind: 'appAction', actionType: 'removeTrack', label: 'Remove track' }],
                executionKind: 'project',
            })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                content: expect.stringMatching(/applied.*committed with a follow-up warning.*do not retry/is),
            })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({ content: expect.stringContaining('Affected IDs: track-1') })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({ content: expect.stringContaining('Outcome: committed-with-warning') })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                content: expect.stringContaining('Protected unchanged: "Parallel Compression" (track-parallel)'),
            })
        );
    });

    it('does not claim a protected target stayed unchanged when the committed effect reports its ID', async () => {
        const protectedAction: AppAction = {
            type: 'removeTrack',
            payload: { trackId: 'track-parallel' },
        };
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'committed',
            actions: [{ action: protectedAction, label: 'Remove Parallel Compression' }],
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction],
            actionLabels: ['Remove track'],
            protectedUnchanged: [{ id: 'track-parallel', name: 'Parallel Compression' }],
            projectRevision: 'revision-1',
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirm-1' })).resolves.toEqual({
            status: 'executed',
        });

        const terminalUpdate: unknown = mocks.updateChatMessage.mock.lastCall?.[1];
        if (!terminalUpdate || typeof terminalUpdate !== 'object' || !('content' in terminalUpdate)) {
            throw new Error('Expected a terminal chat update');
        }
        const terminalContent = terminalUpdate.content;
        expect(terminalContent).toContain('Affected IDs: track-parallel');
        expect(terminalContent).not.toContain('Protected unchanged:');
    });

    it('should record a confirmed runtime command as executed rather than failed', async () => {
        const warning = 'setPlayback follow-up effect failed: transport unavailable';
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'executed-with-warning',
            actions: [{ action: runtimeOnlyAction, label: 'Start playback' }],
            warning,
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'start playback',
            assistantMessageId: 'assistant-1',
            actions: [runtimeOnlyAction],
            actionLabels: ['Start playback'],
            executionMode: 'atomic',
            projectRevision: 'revision-1',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('executed');
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([
            {
                actionType: 'setPlayback',
                label: 'Start playback',
                executionKind: 'runtime',
                affectedIds: [],
                outcome: 'executed-with-warning',
            },
        ]);
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [{ kind: 'appAction', actionType: 'setPlayback', label: 'Start playback' }],
                executionKind: 'runtime',
            })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                error: warning,
                pendingActionConfirmationStatus: 'executed',
                content: expect.stringMatching(/runtime command executed.*do not retry/is),
            })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({ content: expect.stringContaining('Affected IDs: none') })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({ content: expect.stringContaining('Outcome: executed-with-warning') })
        );
    });

    it('keeps a confirmed action executed when AI history reporting throws after commit', async () => {
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'committed',
            actions: [{ action: pendingAction, label: 'Remove track' }],
        });
        mocks.pushAiActionGroup.mockImplementationOnce(() => {
            throw new Error('AI history unavailable');
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction],
            actionLabels: ['Remove track'],
            projectRevision: 'revision-1',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('executed');
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                error: 'AI history unavailable',
                content: expect.stringMatching(/project change committed.*do not retry/is),
            })
        );
    });

    it('keeps a confirmed runtime command executed when reporting throws without claiming a project commit', async () => {
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'executed',
            actions: [{ action: runtimeOnlyAction, label: 'Start playback' }],
        });
        mocks.pushAiActionGroup.mockImplementationOnce(() => {
            throw new Error('AI history unavailable');
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'start playback',
            assistantMessageId: 'assistant-1',
            actions: [runtimeOnlyAction],
            actionLabels: ['Start playback'],
            projectRevision: 'revision-1',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('executed');
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                error: 'AI history unavailable',
                content: expect.stringMatching(/runtime command executed.*do not retry.*outcome: executed/is),
            })
        );
    });

    it('should execute a multi-action confirmation through one atomic batch', async () => {
        mocks.executeAppActionBatch.mockResolvedValueOnce({
            status: 'committed',
            actions: [
                { action: pendingAction, label: 'Remove track' },
                { action: secondPendingAction, label: 'Remove clip' },
            ],
        });
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums and clip',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction, secondPendingAction],
            actionLabels: ['Remove track', 'Remove clip'],
            executionMode: 'atomic',
            projectRevision: 'revision-1',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([
            {
                actionType: 'removeTrack',
                label: 'Remove track',
                executionKind: 'project',
                affectedIds: ['track-1'],
                outcome: 'committed',
            },
            {
                actionType: 'removeClip',
                label: 'Remove clip',
                executionKind: 'project',
                affectedIds: ['clip-1'],
                outcome: 'committed',
            },
        ]);
        expect(mocks.executeAppActionBatch.mock.calls[0]?.[0]).toEqual([pendingAction, secondPendingAction]);
        expect(mocks.executeAppActionBatch.mock.calls[0]?.[1]).toMatchObject({
            groupId: 'group-1',
            groupLabel: 'delete drums',
            source: 'prompt',
            requireCompensation: true,
        });
        expect(typeof mocks.executeAppActionBatch.mock.calls[0]?.[1]?.shouldExecute).toBe('function');
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [
                    { kind: 'appAction', actionType: 'removeTrack', label: 'Remove track' },
                    { kind: 'appAction', actionType: 'removeClip', label: 'Remove clip' },
                ],
                executionKind: 'project',
            })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                content: expect.stringMatching(/executed.*remove track.*remove clip/is),
            })
        );
    });
});
