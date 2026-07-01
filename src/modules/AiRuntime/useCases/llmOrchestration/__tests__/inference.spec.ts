import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateToolCalls } from '../inference';

const { mockLogger, mocks } = vi.hoisted(() => ({
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
        parseToolCallXml: vi.fn(),
        generateCloudToolCalls: vi.fn(),
        generateWebLlmToolCalls: vi.fn(),
        initWebLlmEngine: vi.fn(),
        isWebLlmLoaded: vi.fn(),
        llmStatusSet: vi.fn(),
    },
}));

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
    llmStatusStore: { set: mocks.llmStatusSet },
}));

vi.mock('../../../transformers/toolCallParser', () => ({
    parseToolCallXml: mocks.parseToolCallXml,
}));

describe('generateToolCalls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.backendChain.value = [];
        mocks.nativeEngineReady.value = false;
        mocks.generateNativeToolCalls.mockReset();
        mocks.generateNativeCompletion.mockReset();
        mocks.parseToolCallXml.mockReset();
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
        expect(mocks.parseToolCallXml).not.toHaveBeenCalled();
        expect(result).toEqual([{ name: 'mute_track', arguments: { track_id: 'track-1', muted: true } }]);
    });

    it('should fall back to native text completion when structured native calls are unavailable', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockResolvedValue(null);
        mocks.generateNativeCompletion.mockResolvedValue('<tool name="mute_track" />');
        mocks.parseToolCallXml.mockReturnValue([{ name: 'mute_track', arguments: {} }]);

        const result = await generateToolCalls('sys', 'mute drums');

        expect(mocks.generateNativeToolCalls).toHaveBeenCalledTimes(1);
        expect(mocks.generateNativeCompletion).toHaveBeenCalledWith('sys', 'mute drums');
        expect(mocks.parseToolCallXml).toHaveBeenCalledWith('<tool name="mute_track" />');
        expect(result).toEqual([{ name: 'mute_track', arguments: {} }]);
    });

    it('should fall back to native text completion when structured native calls fail', async () => {
        mocks.backendChain.value = ['native'];
        mocks.nativeEngineReady.value = true;
        mocks.generateNativeToolCalls.mockRejectedValue(new Error('structured unavailable'));
        mocks.generateNativeCompletion.mockResolvedValue('<tool name="mute_track" />');
        mocks.parseToolCallXml.mockReturnValue([{ name: 'mute_track', arguments: {} }]);

        const result = await generateToolCalls('sys', 'mute drums');

        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[AI Engine] Structured tool calling failed, falling back to text: structured unavailable'
        );
        expect(mocks.generateNativeCompletion).toHaveBeenCalledWith('sys', 'mute drums');
        expect(result).toEqual([{ name: 'mute_track', arguments: {} }]);
    });
});
