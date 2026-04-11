import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendChatMessage } from '../sendChatMessage';

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: vi.fn(() => 'native'),
}));

vi.mock('../../repositories/nativeEngine/lifecycle', () => ({
    isNativeEngineReady: vi.fn(() => true),
}));

vi.mock('../../stores/chatStore', () => ({
    chatStore: { value: null },
    setChatGenerating: vi.fn(),
    appendChatMessage: vi.fn(),
    updateChatMessage: vi.fn(),
    setActiveAborter: vi.fn(),
}));

describe('sendChatMessage injectables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns early when chat store is empty', async () => {
        const { setChatGenerating } = await import('../../stores/chatStore');
        
        await sendChatMessage('hello');

        expect(setChatGenerating).not.toHaveBeenCalled();
    });
});

