import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createAppActionCommittedError } from '#/modules/Command/useCases';

import { AiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { type ChatMessage, type ChatState } from '../../models/Chat';
import { type IntentResult } from '../../models/IntentResult';
import { aiBackendPreferenceStore } from '../../stores/aiBackendPreferenceStore';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { type ProjectContext } from '../getProjectContext';
import { sendChatMessage } from '../sendChatMessage';

type MockBackend = 'native' | 'cloud' | 'webllm' | 'none';
type MockWebLlmEngine = {
    interruptGenerate: () => void;
    chat: { completions: { create: (payload: Record<string, unknown>) => Promise<unknown> } };
};

const mocks = vi.hoisted(() => {
    const backend: { value: MockBackend } = { value: 'native' };
    const webLlmEngine: { value: MockWebLlmEngine | null } = { value: null };
    return {
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
        appendChatMessage: vi.fn<(message: ChatMessage) => void>(),
        updateChatMessage: vi.fn<(messageId: string, updates: Partial<ChatMessage>) => void>(),
        setActiveAborter: vi.fn<(aborter: AbortController | null) => void>(),
        nativeEngineReady: { value: true },
        backend,
        cloudAvailable: { value: false },
        webLlmEngine,
        webLlmCreate: vi.fn<(payload: Record<string, unknown>) => Promise<unknown>>(),
        webLlmInterrupt: vi.fn(),
        streamCloudChatCompletion:
            vi.fn<
                (
                    messages: Array<{ role: string; content: string }>,
                    onToken: (text: string) => void,
                    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
                ) => Promise<{ status: 'complete' } | { status: 'incomplete'; reason: string }>
            >(),
    };
});

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: vi.fn(() => mocks.backend.value),
}));

vi.mock('../../repositories/nativeEngine/isNativeEngineReady', () => ({
    isNativeEngineReady: vi.fn(() => mocks.nativeEngineReady.value),
}));

vi.mock('../../repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: vi.fn(() => mocks.cloudAvailable.value),
}));

vi.mock('../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion', () => ({
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

vi.mock('../../repositories/webLlm/getLlmEngine', () => ({
    getLlmEngine: () => mocks.webLlmEngine.value,
}));

vi.mock('../../repositories/webLlm/getActiveModelId', () => ({
    getActiveModelId: () => 'webllm-model',
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
        mocks.backend.value = 'native';
        mocks.cloudAvailable.value = false;
        mocks.webLlmEngine.value = null;
        aiBackendPreferenceStore.set('auto');
        llmStatusStore.set({ state: 'idle' });
        mocks.streamCloudChatCompletion.mockResolvedValue({ status: 'complete' });
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
        const confirmationUpdate = mocks.updateChatMessage.mock.calls[0]?.[1];
        expect(confirmationUpdate?.isStreaming).toBe(false);
        expect(confirmationUpdate?.content).toContain('requires confirmation');
        expect(confirmationUpdate?.pendingActionConfirmationId).toMatch(/^prompt-confirmation-/);
        expect(confirmationUpdate?.pendingActionConfirmationStatus).toBe('proposed');
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

    it('passes the active Stop signal to hosted chat before the first token', async () => {
        mocks.backend.value = 'cloud';
        mocks.cloudAvailable.value = true;
        llmStatusStore.set({ state: 'ready', backend: 'cloud', modelId: 'hosted-model' });
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        let requestSignal: AbortSignal | undefined;
        mocks.streamCloudChatCompletion.mockImplementation(
            (_messages, _onToken, options) =>
                new Promise((_resolve, reject) => {
                    requestSignal = options?.signal;
                    requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                        once: true,
                    });
                })
        );

        const pending = sendChatMessage('How should I mix this?');
        await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
        const activeAborter = mocks.setActiveAborter.mock.calls.find((call) => call[0] instanceof AbortController)?.[0];
        if (!activeAborter) {
            throw new Error('Expected chat mode to expose an active aborter');
        }
        expect(requestSignal).toBe(activeAborter.signal);
        mocks.cloudAvailable.value = false;
        activeAborter.abort(new DOMException('AbortedByUser', 'AbortError'));
        await pending;

        expect(requestSignal?.aborted).toBe(true);
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('marks a token-limited hosted response visibly incomplete', async () => {
        mocks.backend.value = 'cloud';
        mocks.cloudAvailable.value = true;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        mocks.streamCloudChatCompletion.mockImplementation(async (_messages, onToken) => {
            await Promise.resolve();
            onToken('Partial answer');
            return { status: 'incomplete', reason: 'token limit' };
        });

        await sendChatMessage('How should I mix this?');

        const completionUpdate = mocks.updateChatMessage.mock.calls.find(
            (call) => call[1].error === 'Hosted AI response incomplete (token limit)'
        );
        expect(completionUpdate?.[1].isStreaming).toBe(false);
        expect(completionUpdate?.[1].content).toContain('Response incomplete');
    });

    it('interrupts active WebLLM generation when Stop is requested', async () => {
        mocks.backend.value = 'webllm';
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        let rejectGeneration: (reason: unknown) => void = vi.fn();
        mocks.webLlmCreate.mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    rejectGeneration = reject;
                })
        );
        mocks.webLlmInterrupt.mockImplementation(() => {
            rejectGeneration(new DOMException('Aborted', 'AbortError'));
        });
        mocks.webLlmEngine.value = {
            interruptGenerate: mocks.webLlmInterrupt,
            chat: { completions: { create: mocks.webLlmCreate } },
        };

        const pending = sendChatMessage('How should I mix this?');
        await vi.waitFor(() => expect(mocks.webLlmCreate).toHaveBeenCalledTimes(1));
        const activeAborter = mocks.setActiveAborter.mock.calls.find((call) => call[0] instanceof AbortController)?.[0];
        if (!activeAborter) {
            throw new Error('Expected chat mode to expose an active aborter');
        }
        activeAborter.abort(new DOMException('AbortedByUser', 'AbortError'));
        await pending;

        expect(mocks.webLlmInterrupt).toHaveBeenCalledTimes(1);
    });

    it('marks a token-limited WebLLM stream visibly incomplete', async () => {
        mocks.backend.value = 'webllm';
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        mocks.webLlmCreate.mockResolvedValue({
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield { choices: [{ delta: { content: 'Partial answer' }, finish_reason: null }] };
                yield { choices: [{ delta: {}, finish_reason: 'length' }] };
            },
        });
        mocks.webLlmEngine.value = {
            interruptGenerate: mocks.webLlmInterrupt,
            chat: { completions: { create: mocks.webLlmCreate } },
        };

        await sendChatMessage('How should I mix this?');

        const completionUpdate = mocks.updateChatMessage.mock.calls.find(
            (call) => call[1].error === 'WebLLM response incomplete (length)'
        );
        expect(completionUpdate?.[1].content).toContain('Partial answer');
        expect(completionUpdate?.[1].content).toContain('Response incomplete');
    });

    it('preserves partial hosted output when the network stream fails', async () => {
        mocks.backend.value = 'cloud';
        mocks.cloudAvailable.value = true;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        mocks.streamCloudChatCompletion.mockImplementation(async (_messages, onToken) => {
            await Promise.resolve();
            onToken('Partial answer');
            throw new Error('network disconnected');
        });

        await sendChatMessage('How should I mix this?');

        const failureUpdate = mocks.updateChatMessage.mock.calls.find(
            (call) => call[1].error === 'network disconnected'
        );
        expect(failureUpdate?.[1].content).toContain('Partial answer');
        expect(failureUpdate?.[1].content).toContain('Response incomplete');
    });

    it('treats hosted reconfiguration as terminal cancellation', async () => {
        mocks.backend.value = 'cloud';
        mocks.cloudAvailable.value = true;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        mocks.streamCloudChatCompletion.mockRejectedValue(new AiRuntimeConfigurationChangedError());

        await sendChatMessage('How should I mix this?');

        expect(mocks.updateChatMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                isStreaming: false,
                error: 'Hosted AI configuration changed; this response was cancelled.',
            })
        );
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('does not restore a stale backend after selection changes during generation', async () => {
        mocks.backend.value = 'cloud';
        mocks.cloudAvailable.value = true;
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        };
        llmStatusStore.set({ state: 'ready', backend: 'cloud', modelId: 'hosted-model' });
        let requestSignal: AbortSignal | undefined;
        mocks.streamCloudChatCompletion.mockImplementation(
            (_messages, _onToken, options) =>
                new Promise((_resolve, reject) => {
                    requestSignal = options?.signal;
                    requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                        once: true,
                    });
                })
        );

        const pending = sendChatMessage('How should I mix this?');
        await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
        aiBackendPreferenceStore.set('native');
        const activeAborter = mocks.setActiveAborter.mock.calls.find((call) => call[0] instanceof AbortController)?.[0];
        if (!activeAborter) {
            throw new Error('Expected chat mode to expose an active aborter');
        }
        activeAborter.abort();
        await pending;

        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('reports prompt cancellation when the AI configuration changes', async () => {
        mocks.chatStoreValue.value = {
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        };
        mocks.parsePromptToActions.mockRejectedValue(new AiRuntimeConfigurationChangedError());

        await sendChatMessage('mute the vocals');

        expect(mocks.appendChatMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
                role: 'assistant',
                content: 'Prompt cancelled because the AI configuration changed.',
                error: 'AI configuration changed while the request was running',
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
        const committedUpdate = mocks.updateChatMessage.mock.lastCall;
        expect(committedUpdate?.[0]).toBe(assistant_message?.id);
        expect(committedUpdate?.[1].isStreaming).toBe(false);
        expect(committedUpdate?.[1].content).toMatch(/applied.*history.*do not retry/is);
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
        const partialUpdate = mocks.updateChatMessage.mock.lastCall;
        expect(partialUpdate?.[0]).toBe(assistant_message?.id);
        expect(partialUpdate?.[1].error).toBe(later_failure.message);
        expect(partialUpdate?.[1].content).toMatch(/partially.*do not retry the whole command/is);
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
        const combinedFailureUpdate = mocks.updateChatMessage.mock.lastCall;
        expect(combinedFailureUpdate?.[0]).toBe(assistant_message?.id);
        expect(combinedFailureUpdate?.[1].error).toBe(later_failure.message);
        expect(combinedFailureUpdate?.[1].content).toMatch(
            /partially.*later action failed.*history.*do not retry the whole command/is
        );
    });
});
