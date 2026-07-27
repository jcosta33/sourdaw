import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeDsoEdit } from '../executeDsoEdit';

const mocks = vi.hoisted(() => {
    const rejectGeneration: { value: (reason: unknown) => void } = { value: vi.fn() };

    return {
        rejectGeneration,
        webLlmCreate: vi.fn<(payload: Record<string, unknown>) => Promise<unknown>>(),
        webLlmInterrupt: vi.fn(),
        commitDsoEditPlan: vi.fn(),
        proposePendingDsoConfirmation: vi.fn(),
        updateChatMessage: vi.fn(),
        setChatGenerating: vi.fn(),
        llmStatusStore: {
            value: { state: 'ready' as const, backend: 'webllm' as const, modelId: 'test-model' },
            set: vi.fn(),
        },
        aiBackendPreferenceStore: { value: 'auto' as const },
    };
});

vi.mock('../../llmOrchestration/backendResolution/isDsoBackendAvailable', () => ({
    isDsoBackendAvailable: () => true,
}));

vi.mock('../../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'webllm' as const,
}));

vi.mock('../../../repositories/webLlm/getLlmEngine', () => ({
    getLlmEngine: () => ({
        interruptGenerate: mocks.webLlmInterrupt,
        chat: { completions: { create: mocks.webLlmCreate } },
    }),
}));

vi.mock('../../../repositories/webLlm/getActiveModelId', () => ({
    getActiveModelId: () => 'test-model',
}));

vi.mock('../../../repositories/nativeEngine/isNativeEngineReady', () => ({
    isNativeEngineReady: () => false,
}));

vi.mock('../../../repositories/nativeEngine/schemaConstrainedGeneration', () => ({
    generateSchemaConstrainedNativeCompletion: vi.fn(),
}));

vi.mock('../../../repositories/nativeEngine/streaming', () => ({
    streamNativeCompletion: vi.fn(),
}));

vi.mock('../serializeLogicalState', () => ({
    serializeLogicalState: () => ({}),
}));

vi.mock('../buildProjectSummary', () => ({
    buildProjectSummary: () => '',
}));

vi.mock('../dsoPrompt', () => ({
    buildDsoPrompt: () => ({ system: 'system', user: 'user' }),
}));

vi.mock('../commitDsoEditPlan', () => ({
    commitDsoEditPlan: mocks.commitDsoEditPlan,
}));

vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    proposePendingDsoConfirmation: mocks.proposePendingDsoConfirmation,
}));

vi.mock('../../../stores/chatStore', () => ({
    appendChatMessage: vi.fn(),
    updateChatMessage: mocks.updateChatMessage,
    setChatGenerating: mocks.setChatGenerating,
}));

vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: mocks.llmStatusStore,
}));

vi.mock('../../../stores/aiBackendPreferenceStore', () => ({
    aiBackendPreferenceStore: mocks.aiBackendPreferenceStore,
}));

describe('executeDsoEdit WebLLM cancellation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.rejectGeneration.value = vi.fn();
        mocks.webLlmCreate.mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    mocks.rejectGeneration.value = reject;
                })
        );
        mocks.webLlmInterrupt.mockImplementation(() => {
            mocks.rejectGeneration.value(new DOMException('Aborted', 'AbortError'));
        });
    });

    it('interrupts generation and never proposes or commits after cancellation', async () => {
        const controller = new AbortController();
        const pending = executeDsoEdit('mute drums', controller.signal);
        await vi.waitFor(() => expect(mocks.webLlmCreate).toHaveBeenCalledTimes(1));

        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.webLlmInterrupt).toHaveBeenCalledTimes(1);
        expect(mocks.proposePendingDsoConfirmation).not.toHaveBeenCalled();
        expect(mocks.commitDsoEditPlan).not.toHaveBeenCalled();
        expect(mocks.updateChatMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                content: 'Edit cancelled.',
                isStreaming: false,
                error: 'Edit cancelled',
            })
        );
        expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        expect(mocks.llmStatusStore.set).toHaveBeenLastCalledWith(mocks.llmStatusStore.value);
    });
});
