import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendChatMessage } from '../sendChatMessage';

const mocks = vi.hoisted(() => ({
    aiBackendPreference: { value: 'auto' },
    chatState: { value: { chatMode: 'chat', isGenerating: false, messages: [] } },
    getLlmEngine: vi.fn(),
    isCloudAvailable: vi.fn(),
    resolveBackend: vi.fn(),
}));

vi.mock('../../repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

vi.mock('../../repositories/webLlm/getLlmEngine', () => ({
    getLlmEngine: mocks.getLlmEngine,
}));

vi.mock('../../stores/aiBackendPreferenceStore', () => ({
    aiBackendPreferenceStore: mocks.aiBackendPreference,
}));

vi.mock('../../stores/chatStore', () => ({
    appendChatMessage: vi.fn(),
    chatStore: mocks.chatState,
    setActiveAborter: vi.fn(),
    setChatGenerating: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: mocks.resolveBackend,
}));

describe('sendChatMessage retained-provider selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.aiBackendPreference.value = 'auto';
        mocks.chatState.value = { chatMode: 'chat', isGenerating: false, messages: [] };
        mocks.isCloudAvailable.mockReturnValue(false);
        mocks.getLlmEngine.mockReturnValue(null);
    });

    it('fails closed when the explicitly selected hosted provider is not configured', async () => {
        mocks.aiBackendPreference.value = 'cloud';
        mocks.resolveBackend.mockReturnValue('cloud');

        await expect(sendChatMessage('summarize this', { mode: 'explain' })).rejects.toThrow(
            'Hosted AI is not configured.'
        );
    });

    it('fails closed when browser WebLLM is selected without an initialized engine', async () => {
        mocks.aiBackendPreference.value = 'webllm';
        mocks.resolveBackend.mockReturnValue('webllm');

        await expect(sendChatMessage('summarize this', { mode: 'explain' })).rejects.toThrow(
            'AI Engine is not initialized or not supported on this device.'
        );
    });
});
