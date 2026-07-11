import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ChatState } from '../../models/Chat';
import { type IntentResult } from '../../models/IntentResult';
import { type ProjectContext } from '../getProjectContext';
import { sendChatMessage } from '../sendChatMessage';

const mocks = vi.hoisted(() => ({
    chatStoreValue: { value: null as ChatState | null },
    executeAppAction: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isAppActionCommittedError: vi.fn<(error: unknown) => boolean>(() => false),
    describeAction: vi.fn(() => 'Remove track'),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'delete drums' })),
    parsePromptToActions: vi.fn<() => Promise<IntentResult>>(),
    getProjectContext: vi.fn<() => ProjectContext>(),
    notifyAiChange: vi.fn(),
    pushAiActionGroup: vi.fn(),
    setChatGenerating: vi.fn(),
    appendChatMessage: vi.fn(),
    updateChatMessage: vi.fn(),
    setActiveAborter: vi.fn(),
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: vi.fn(() => 'native'),
}));

vi.mock('../../repositories/nativeEngine/isNativeEngineReady', () => ({
    isNativeEngineReady: vi.fn(() => true),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    isAppActionCommittedError: mocks.isAppActionCommittedError,
    describeAction: mocks.describeAction,
    generateGroupId: mocks.generateGroupId,
}));

vi.mock('../parsePromptToActions', () => ({
    parsePromptToActions: mocks.parsePromptToActions,
}));

vi.mock('../getProjectContext', () => ({
    getProjectContext: mocks.getProjectContext,
}));

vi.mock('../notifyAiChange', () => ({
    notifyAiChange: mocks.notifyAiChange,
}));

vi.mock('../../stores/chatStore', () => ({
    chatStore: {
        get value() {
            return mocks.chatStoreValue.value;
        },
    },
    setChatGenerating: mocks.setChatGenerating,
    appendChatMessage: mocks.appendChatMessage,
    updateChatMessage: mocks.updateChatMessage,
    setActiveAborter: mocks.setActiveAborter,
}));

vi.mock('../../stores/aiActionHistoryStore', () => ({
    pushAiActionGroup: mocks.pushAiActionGroup,
}));

describe('sendChatMessage injectables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.chatStoreValue.value = null;
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.isAppActionCommittedError.mockReturnValue(false);
        mocks.describeAction.mockReturnValue('Remove track');
        mocks.generateGroupId.mockReturnValue({ groupId: 'group-1', groupLabel: 'delete drums' });
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [],
            rawText: '',
            requiresConfirmation: false,
        });
        mocks.getProjectContext.mockReturnValue({
            tempo: 120,
            timeSignature: [4, 4],
            tracks: [],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            activeView: 'arrange',
            playheadPosition: 0,
        });
    });

    it('returns early when chat store is empty', async () => {
        const { setChatGenerating } = await import('../../stores/chatStore');

        await sendChatMessage('hello');

        expect(setChatGenerating).not.toHaveBeenCalled();
    });

    it('should not execute prompt actions that require confirmation', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [{ type: 'removeTrack', payload: { trackId: 'track-1' } }],
            rawText: 'delete drums',
            requiresConfirmation: true,
        });

        await sendChatMessage('delete drums');

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                isStreaming: false,
                content: expect.stringContaining('requires confirmation'),
                pendingActionConfirmationId: expect.stringMatching(/^prompt-confirmation-/),
                pendingActionConfirmationStatus: 'proposed',
            })
        );
    });

    it('should update the existing executing row when a prompt action is not dispatched', async () => {
        const missing_handler = new Error('No handler registered for action: removeTrack');
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [{ type: 'removeTrack', payload: { trackId: 'track-1' } }],
            rawText: 'delete drums',
            requiresConfirmation: false,
        });
        mocks.executeAppAction.mockRejectedValueOnce(missing_handler);

        await sendChatMessage('delete drums');

        expect(mocks.appendChatMessage).toHaveBeenCalledTimes(2);
        const assistant_message = mocks.appendChatMessage.mock.calls[1]?.[0];
        expect(assistant_message?.role).toBe('assistant');
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            assistant_message?.id,
            expect.objectContaining({
                isStreaming: false,
                content: 'Failed to execute prompt command.',
                error: missing_handler.message,
            })
        );
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
    });

    it('should record a committed prompt action as executed and warn against retrying', async () => {
        const committed_failure = new Error('Action committed but history failed');
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [{ type: 'removeTrack', payload: { trackId: 'track-1' } }],
            rawText: 'delete drums',
            requiresConfirmation: false,
        });
        mocks.executeAppAction.mockRejectedValueOnce(committed_failure);
        mocks.isAppActionCommittedError.mockImplementation((error) => error === committed_failure);

        await sendChatMessage('delete drums');

        expect(mocks.appendChatMessage).toHaveBeenCalledTimes(2);
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [{ kind: 'appAction', actionType: 'removeTrack', label: 'Remove track' }],
            })
        );
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Executed: delete drums', ['removeTrack']);
        const assistant_message = mocks.appendChatMessage.mock.calls[1]?.[0];
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            assistant_message?.id,
            expect.objectContaining({
                isStreaming: false,
                content: expect.stringMatching(/applied.*history.*do not retry/is),
            })
        );
    });

    it('should persist and report the executed subset when a later prompt action fails', async () => {
        const later_failure = new Error('second action was not dispatched');
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [
                { type: 'removeTrack', payload: { trackId: 'track-1' } },
                { type: 'removeClip', payload: { clipId: 'clip-1' } },
            ],
            rawText: 'delete drums and clip',
            requiresConfirmation: false,
        });
        mocks.executeAppAction.mockResolvedValueOnce(undefined).mockRejectedValueOnce(later_failure);

        await sendChatMessage('delete drums and clip');

        expect(mocks.appendChatMessage).toHaveBeenCalledTimes(2);
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [{ kind: 'appAction', actionType: 'removeTrack', label: 'Remove track' }],
            })
        );
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Executed: delete drums and clip', ['removeTrack']);
        const assistant_message = mocks.appendChatMessage.mock.calls[1]?.[0];
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            assistant_message?.id,
            expect.objectContaining({
                error: later_failure.message,
                content: expect.stringMatching(/partially.*do not retry the whole command/is),
            })
        );
    });
});
