import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createAppActionCommittedError } from '#/modules/Command/useCases';

import { type ChatState } from '../../models/Chat';
import { type IntentResult } from '../../models/IntentResult';
import { type ProjectContext } from '../getProjectContext';
import { sendChatMessage } from '../sendChatMessage';

const mocks = vi.hoisted(() => ({
    chatStoreValue: { value: null as ChatState | null },
    executeAppAction: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    describeAction: vi.fn(() => 'Remove track'),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'delete drums' })),
    parsePromptToActions:
        vi.fn<(prompt: string, context: ProjectContext, signal?: AbortSignal) => Promise<IntentResult>>(),
    getProjectContext: vi.fn<() => ProjectContext>(),
    notifyAiChange: vi.fn(),
    pushAiActionGroup: vi.fn(),
    setChatGenerating: vi.fn(),
    appendChatMessage: vi.fn(),
    updateChatMessage: vi.fn(),
    setActiveAborter: vi.fn<(aborter: AbortController | null) => void>(),
    nativeEngineReady: { value: true },
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: vi.fn(() => 'native'),
}));

vi.mock('../../repositories/nativeEngine/isNativeEngineReady', () => ({
    isNativeEngineReady: vi.fn(() => mocks.nativeEngineReady.value),
}));

vi.mock('#/modules/Command/useCases', async (import_original) => ({
    ...(await import_original<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: mocks.executeAppAction,
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
        mocks.nativeEngineReady.value = true;
        mocks.executeAppAction.mockResolvedValue(undefined);
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

    it('lets prompt mode use provider fallback when the preferred native engine is not ready', async () => {
        mocks.nativeEngineReady.value = false;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };

        await sendChatMessage('mute the vocals');

        expect(mocks.parsePromptToActions).toHaveBeenCalledWith(
            'mute the vocals',
            expect.any(Object),
            expect.any(AbortSignal)
        );
    });

    it('executes a validated provider action through executeAppAction', async () => {
        const action = { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } } as const;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
        });

        await sendChatMessage('mute the vocals');

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            action,
            expect.objectContaining({
                source: 'prompt',
            })
        );
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Executed: mute the vocals', ['muteTrack']);
    });

    it('does not report a false command error when provider planning is stopped', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockImplementation(
            (_prompt, _context, signal) =>
                new Promise((resolve) => {
                    signal?.addEventListener(
                        'abort',
                        () => {
                            resolve({ actions: [], rawText: '', requiresConfirmation: false });
                        },
                        { once: true }
                    );
                })
        );

        const pending = sendChatMessage('mute the vocals');
        const activeAborter = mocks.setActiveAborter.mock.calls[0]?.[0];
        if (!activeAborter) {
            throw new Error('Expected prompt mode to expose an active aborter');
        }
        activeAborter.abort();
        await pending;

        expect(mocks.appendChatMessage).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
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
        const committed_failure = createAppActionCommittedError({
            actionType: 'removeTrack',
            cause: new Error('Action committed but history failed'),
        });
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

    it('should report both earlier committed history failure and later dispatch failure', async () => {
        const committed_failure = createAppActionCommittedError({
            actionType: 'removeTrack',
            cause: new Error('first action history failed'),
        });
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
        mocks.executeAppAction.mockRejectedValueOnce(committed_failure).mockRejectedValueOnce(later_failure);

        await sendChatMessage('delete drums and clip');

        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [{ kind: 'appAction', actionType: 'removeTrack', label: 'Remove track' }],
            })
        );
        const assistant_message = mocks.appendChatMessage.mock.calls[1]?.[0];
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            assistant_message?.id,
            expect.objectContaining({
                error: later_failure.message,
                content: expect.stringMatching(
                    /partially.*later action failed.*history.*do not retry the whole command/is
                ),
            })
        );
    });
});
