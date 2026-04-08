import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { sendChatMessage } from './sendChatMessage';

describe('sendChatMessage injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns early when chat store is empty', async () => {
        const resolveBackend = vi.fn(() => 'native' as const);
        const isNativeEngineReady = vi.fn(() => true);
        const setChatGenerating = vi.fn();
        const chatStore = { value: null as null };

        injectDependencies(sendChatMessage, {
            createAiRuntimeError: (msg: string) => new Error(msg),
            isAppError: () => false,
            getLlmEngine: vi.fn(),
            streamNativeCompletion: vi.fn(),
            isNativeEngineReady,
            isCloudAvailable: vi.fn(),
            streamCloudChatCompletion: vi.fn(),
            resolveBackend,
            chatStore,
            appendChatMessage: vi.fn(),
            updateChatMessage: vi.fn(),
            setChatGenerating,
            getProjectContext: vi.fn(),
            parsePromptToActions: vi.fn(),
            executeAppAction: vi.fn(),
            generateGroupId: vi.fn(),
            describeAction: vi.fn(),
            pushAiActionGroup: vi.fn(),
            notifyAiChange: vi.fn(),
            setActiveAborter: vi.fn(),
        });

        await sendChatMessage('hello');

        expect(setChatGenerating).not.toHaveBeenCalled();
    });
});
