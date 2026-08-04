import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type RuntimeAction } from '../../models/RuntimeAction';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { confirmPendingChatActions } from '../confirmPendingChatActions';

type ExecuteAppActionBatch = (typeof import('#/modules/Command/useCases'))['executeAppActionBatch'];
type AppAction = Parameters<ExecuteAppActionBatch>[0][number];

const chatGenerationState = vi.hoisted(() => ({ value: false }));

const mocks = vi.hoisted(() => ({
    projectRevision: { value: 'revision-1' },
    executeAppAction: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    executeAppActionBatch: vi.fn<ExecuteAppActionBatch>(),
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
    captureProjectRevision: () => mocks.projectRevision.value,
}));

vi.mock('#/modules/Command/useCases', async (import_original) => ({
    ...(await import_original<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: mocks.executeAppAction,
    executeAppActionBatch: mocks.executeAppActionBatch,
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

const pendingAction: RuntimeAction = { type: 'removeTrack', payload: { trackId: 'track-1' } };
const secondPendingAction: RuntimeAction = { type: 'removeClip', payload: { clipId: 'clip-1' } };
const runtimeOnlyAction: RuntimeAction = { type: 'setPlayback', payload: { playing: true } };

function proposePendingAppAction(id: string): void {
    proposePendingActionConfirmation({
        id,
        prompt: 'delete drums',
        assistantMessageId: 'assistant-1',
        actions: [pendingAction],
        actionLabels: ['Remove track'],
        executionMode: 'atomic',
        projectRevision: 'revision-1',
    });
}

describe('pending chat action confirmation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
        mocks.describeAction.mockReturnValue('Remove track');
        mocks.generateGroupId.mockReturnValue({ groupId: 'group-1', groupLabel: 'delete drums' });
        mocks.projectRevision.value = 'revision-1';
        chatGenerationState.value = false;
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
            { actionType: 'removeTrack', label: 'Remove track', executionKind: 'project' },
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

    it('lets Stop cancel an accepted app-action confirmation before commit', async () => {
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
        proposePendingAppAction('confirm-stop');

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-stop' });

        expect(result).toEqual({ status: 'cancelled' });
        expect(getPendingActionConfirmation('confirm-stop')?.status).toBe('cancelled');
        expect(mocks.setChatGenerating.mock.calls).toEqual([[true], [false]]);
        expect(mocks.setActiveAborter.mock.calls[0]?.[0]).toBeInstanceOf(AbortController);
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'cancelled',
                error: undefined,
                content: 'Command cancelled before it committed. No project changes were applied.',
            })
        );
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

    it('should cancel proposed actions without executing them', () => {
        proposePendingActionConfirmation({
            id: 'confirm-1',
            prompt: 'delete drums',
            assistantMessageId: 'assistant-1',
            actions: [pendingAction],
            actionLabels: ['Remove track'],
            projectRevision: 'revision-1',
        });

        const result = cancelPendingChatActions({ confirmationId: 'confirm-1' });

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
            projectRevision: 'revision-1',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirm-1' });

        expect(result).toEqual({ status: 'executed' });
        expect(getPendingActionConfirmation('confirm-1')?.status).toBe('executed');
        expect(getPendingActionConfirmation('confirm-1')?.executedActions).toEqual([
            { actionType: 'removeTrack', label: 'Remove track', executionKind: 'project' },
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
            { actionType: 'setPlayback', label: 'Start playback', executionKind: 'runtime' },
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
                content:
                    'The confirmed runtime command executed, but reporting it failed: AI history unavailable. Do not retry these actions.',
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
            { actionType: 'removeTrack', label: 'Remove track', executionKind: 'project' },
            { actionType: 'removeClip', label: 'Remove clip', executionKind: 'project' },
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
