import { describe, it, expect, vi, beforeEach } from 'vitest';

import { sendChatMessage } from '../sendChatMessage';

import { type ChatState } from '../../models/Chat';
import { type IntentResult } from '../../models/IntentResult';
import { type ProjectContext } from '../getProjectContext';

const mocks = vi.hoisted(() => ({
    chatStoreValue: { value: null as ChatState | null },
    executeAppAction: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
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

vi.mock('../../repositories/nativeEngine/lifecycle', () => ({
    isNativeEngineReady: vi.fn(() => true),
}));

vi.mock('#/modules/Command/useCases', () => ({
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
});
