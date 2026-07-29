import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AiRuntimeConfigurationChangedError } from '../../../errors/AiRuntimeConfigurationChangedError';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { generateToolCalls as generateCompatibleToolCalls } from '../generateToolCalls';
import { generateToolPlanningOutcome as generateToolCalls } from '../inference';

const { mockLogger, mocks } = vi.hoisted(() => {
    const backendPreference: { value: 'auto' | 'native' | 'webllm' | 'cloud' } = { value: 'auto' };

    return {
        mockLogger: {
            warn: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        },
        mocks: {
            backendChain: { value: Array<string>() },
            nativeEngineReady: { value: false },
            generateNativeToolCalls: vi.fn(),
            generateNativeCompletion: vi.fn(),
            parseToolPlanningOutcome: vi.fn(),
            generateCloudToolCalls: vi.fn(),
            getCloudProviderInfo: vi.fn(),
            generateWebLlmToolCalls: vi.fn(),
            initWebLlmEngine: vi.fn(),
            isWebLlmLoaded: vi.fn(),
            llmStatusSet: vi.fn(),
            llmStatusValue: {
                value: { state: 'ready' as const, backend: 'webllm' as const, modelId: 'test-model' },
            },
            backendPreference,
        },
    };
});

vi.mock('../backendResolution/getBackendChain', () => ({
    getBackendChain: () => mocks.backendChain.value,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mockLogger,
}));

vi.mock('../../../repositories/nativeEngine/isNativeEngineReady', () => ({
    isNativeEngineReady: () => mocks.nativeEngineReady.value,
}));

vi.mock('../../../repositories/nativeEngine/nativeToolCalling', () => ({
    generateNativeToolCalls: mocks.generateNativeToolCalls,
}));

vi.mock('../../../repositories/nativeEngine/completions', () => ({
    generateNativeCompletion: mocks.generateNativeCompletion,
}));

vi.mock('../../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: mocks.generateCloudToolCalls,
}));

vi.mock('../../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: mocks.getCloudProviderInfo,
}));

vi.mock('../../../repositories/webLlm/initWebLlmEngine', () => ({
    initWebLlmEngine: mocks.initWebLlmEngine,
}));

vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: mocks.isWebLlmLoaded,
}));

vi.mock('../../../repositories/webLlm/toolCalling', () => ({
    generateWebLlmToolCalls: mocks.generateWebLlmToolCalls,
}));

vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: {
        get value() {
            return mocks.llmStatusValue.value;
        },
        set: mocks.llmStatusSet,
    },
}));

vi.mock('../../../stores/aiBackendPreferenceStore', () => ({
    aiBackendPreferenceStore: mocks.backendPreference,
}));

vi.mock('../../../transformers/toolCallParser', () => ({
    parseToolPlanningOutcome: mocks.parseToolPlanningOutcome,
}));

function completePlan<TToolCall>(toolCalls: TToolCall[]) {
    return { status: 'complete' as const, toolCalls };
}

describe('generateToolPlanningOutcome', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.backendChain.value = [];
        mocks.nativeEngineReady.value = false;
        mocks.generateNativeToolCalls.mockReset();
        mocks.generateNativeCompletion.mockReset();
        mocks.parseToolPlanningOutcome.mockReset();
        mocks.getCloudProviderInfo.mockReturnValue(null);
        mocks.llmStatusValue.value = { state: 'ready', backend: 'webllm', modelId: 'test-model' };
        mocks.backendPreference.value = 'auto';
    });

    it('should throw when no backend chain is available', async () => {
        await expect(generateToolCalls('sys', 'hello')).rejects.toThrow(/No AI backend available/);
    });

    it('should use repository-owned native structured tool calls before text fallback', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue([
            { name: 'mute_track', arguments: { track_id: 'track-1', muted: true } },
        ]);

        const result = await generateToolCalls('sys', 'mute drums');

        expect(mocks.generateNativeToolCalls).toHaveBeenCalledWith(
            expect.objectContaining({
                systemPrompt: 'sys',
                userMessage: 'mute drums',
                temperature: 0.1,
            })
        );
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
        expect(mocks.parseToolPlanningOutcome).not.toHaveBeenCalled();
        expect(result).toEqual(completePlan([{ name: 'mute_track', arguments: { track_id: 'track-1', muted: true } }]));
    });

    it('preserves a terminal native structured no-op without retrying through text', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue([]);

        const result = await generateToolCalls('sys', 'leave the mix unchanged');

        expect(result).toEqual(completePlan([]));
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
        expect(mocks.parseToolPlanningOutcome).not.toHaveBeenCalled();
    });

    it('passes an explicit executable tool subset to every provider backend', async () => {
        const tools: ToolSchema[] = [
            {
                type: 'function',
                function: {
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: {
                        type: 'object',
                        properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } },
                        required: ['trackId', 'muted'],
                    },
                },
            },
        ];

        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue([]);

        await generateToolCalls('sys', 'mute drums', tools);

        expect(mocks.generateCloudToolCalls).toHaveBeenCalledWith('sys', 'mute drums', tools);
    });

    it('stops provider fallback when tool planning is aborted mid-flight', async () => {
        mocks.backendChain.value = ['cloud', 'native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateCloudToolCalls.mockReturnValue(new Promise(() => {}));
        const controller = new AbortController();

        const pending = generateToolCalls('sys', 'mute drums', undefined, controller.signal);
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.generateNativeToolCalls).not.toHaveBeenCalled();
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({
            state: 'ready',
            backend: 'webllm',
            modelId: 'test-model',
        });
    });

    it('treats hosted session revocation as terminal without trying another backend', async () => {
        mocks.backendChain.value = ['cloud', 'native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateCloudToolCalls.mockRejectedValue(new AiRuntimeConfigurationChangedError());

        await expect(generateToolCalls('sys', 'mute drums')).rejects.toMatchObject({
            name: 'AiRuntimeConfigurationChangedError',
        });

        expect(mocks.generateNativeToolCalls).not.toHaveBeenCalled();
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({ state: 'idle' });
    });

    it('does not restore a stale backend after preference-switch cancellation', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockReturnValue(new Promise(() => {}));
        const controller = new AbortController();

        const pending = generateToolCalls('sys', 'mute drums', undefined, controller.signal);
        mocks.backendPreference.value = 'native';
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({ state: 'idle' });
    });

    it('passes an explicit executable tool subset to WebLLM without widening it', async () => {
        const tools: ToolSchema[] = [
            {
                type: 'function',
                function: {
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: {
                        type: 'object',
                        properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } },
                        required: ['trackId', 'muted'],
                    },
                },
            },
        ];

        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([]));

        const controller = new AbortController();
        await generateToolCalls('sys', 'mute drums', tools, controller.signal);

        expect(mocks.generateWebLlmToolCalls).toHaveBeenCalledWith('sys', 'mute drums', tools, controller.signal);
    });

    it('passes cancellation into WebLLM initialization', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(false);
        mocks.initWebLlmEngine.mockResolvedValue({});
        mocks.generateWebLlmToolCalls.mockResolvedValue(completePlan([]));
        const controller = new AbortController();

        await generateToolCalls('sys', 'mute drums', [], controller.signal);

        expect(mocks.initWebLlmEngine).toHaveBeenCalledWith(undefined, { signal: controller.signal });
    });
    it('preserves the direct-consumer array contract and fails fast on rejection', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.generateWebLlmToolCalls.mockResolvedValue(
            completePlan([{ name: 'muteTrack', arguments: { trackId: 'track-1' } }])
        );

        await expect(generateCompatibleToolCalls('sys', 'mute drums')).resolves.toEqual([
            { name: 'muteTrack', arguments: { trackId: 'track-1' } },
        ]);
        mocks.generateWebLlmToolCalls.mockResolvedValue({ status: 'rejected', reason: 'Refused tool planning' });

        await expect(generateCompatibleToolCalls('sys', 'mute drums')).rejects.toThrow('Refused tool planning');
    });

    it('passes an explicit executable tool subset to native structured calling', async () => {
        const tools: ToolSchema[] = [
            {
                type: 'function',
                function: {
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: {
                        type: 'object',
                        properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } },
                        required: ['trackId', 'muted'],
                    },
                },
            },
        ];

        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue([
            { name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } },
        ]);

        await generateToolCalls('sys', 'mute drums', tools);

        expect(mocks.generateNativeToolCalls).toHaveBeenCalledWith({
            systemPrompt: 'sys',
            userMessage: 'mute drums',
            tools: [
                {
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: tools[0]?.function.parameters,
                },
            ],
            temperature: 0.1,
        });
    });

    it('should fall back to native text completion when structured native calls are unavailable', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue(null);
        mocks.generateNativeCompletion.mockResolvedValue('<tool name="mute_track" />');
        mocks.parseToolPlanningOutcome.mockReturnValue(completePlan([{ name: 'mute_track', arguments: {} }]));

        const result = await generateToolCalls('sys', 'mute drums');

        expect(mocks.generateNativeToolCalls).toHaveBeenCalledTimes(1);
        expect(mocks.generateNativeCompletion).toHaveBeenCalledWith(
            expect.stringContaining('Available tools:'),
            'mute drums'
        );
        expect(mocks.generateNativeCompletion).toHaveBeenCalledWith(expect.stringContaining('muteTrack'), 'mute drums');
        expect(mocks.parseToolPlanningOutcome).toHaveBeenCalledWith('<tool name="mute_track" />');
        expect(result).toEqual(completePlan([{ name: 'mute_track', arguments: {} }]));
    });

    it.each([
        { response: 'I cannot change the project.', reason: 'non-tool' },
        { response: '[{"name":"mute_track","arguments":{', reason: 'malformed' },
    ])('returns a rejected outcome for a native text $reason response', async ({ response }) => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue(null);
        mocks.generateNativeCompletion.mockResolvedValue(response);
        mocks.parseToolPlanningOutcome.mockReturnValue({
            status: 'rejected',
            reason: 'Model returned a non-tool response instead of a complete tool-call batch.',
        });

        const result = await generateToolCalls('sys', 'mute drums');

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Model returned a non-tool response instead of a complete tool-call batch.',
        });
    });

    it('should fall back to native text completion when structured native calls fail', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockRejectedValue(new Error('structured unavailable'));
        mocks.generateNativeCompletion.mockResolvedValue('<tool name="mute_track" />');
        mocks.parseToolPlanningOutcome.mockReturnValue(completePlan([{ name: 'mute_track', arguments: {} }]));

        const result = await generateToolCalls('sys', 'mute drums');

        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[AI Engine] Structured tool calling failed, falling back to text: structured unavailable'
        );
        expect(mocks.generateNativeCompletion).toHaveBeenCalledWith(
            expect.stringContaining('Available tools:'),
            'mute drums'
        );
        expect(result).toEqual(completePlan([{ name: 'mute_track', arguments: {} }]));
    });
});
