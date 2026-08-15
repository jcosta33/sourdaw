import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateNativeCompletion } from '../generateNativeCompletion';
import { generateWebLlmCompletion } from '../generateWebLlmCompletion';
import { streamCloudChatCompletion } from '../streamCloudChatCompletion';

const mocks = vi.hoisted(() => ({
    compileRequest: vi.fn(),
    createModelProviderProtocol: vi.fn(),
    finish: vi.fn(),
    runNativeModelProviderRequest: vi.fn(),
    generateWebLlmCompletion: vi.fn(),
    push: vi.fn(),
    rawCloudCompletion: vi.fn(),
    start: vi.fn(),
    streamHostedModelText: vi.fn(),
}));

vi.mock('../../modelProviderProtocol', () => ({
    createModelProviderProtocol: mocks.createModelProviderProtocol,
}));

vi.mock('../../../repositories/nativeModelProviderAdapter', () => ({
    runNativeModelProviderRequest: mocks.runNativeModelProviderRequest,
}));

vi.mock('../../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: mocks.generateWebLlmCompletion,
}));

vi.mock('../../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion', () => ({
    streamCloudChatCompletion: mocks.rawCloudCompletion,
}));

vi.mock('../../streamHostedModelText', () => ({
    streamHostedModelText: mocks.streamHostedModelText,
}));

describe('model text query protocol boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.compileRequest.mockImplementation((input) => ({
            status: 'ready',
            request: { ...input, schemaVersion: 1 },
        }));
        mocks.finish.mockReturnValue({
            status: 'complete',
            output: { text: 'normalized text' },
            failure: null,
        });
        mocks.start.mockReturnValue({ push: mocks.push, finish: mocks.finish });
        mocks.createModelProviderProtocol.mockReturnValue({
            compileRequest: mocks.compileRequest,
            start: mocks.start,
        });
        mocks.runNativeModelProviderRequest.mockImplementation(async ({ onEvent }) => {
            onEvent({ type: 'text', mode: 'cumulative-snapshot', text: 'native text' });
            return { status: 'available', finish: { reason: 'stop' } };
        });
        mocks.generateWebLlmCompletion.mockResolvedValue('webllm text');
        mocks.rawCloudCompletion.mockResolvedValue({ status: 'complete' });
        mocks.streamHostedModelText.mockResolvedValue({ status: 'complete', failure: null });
    });

    it('settles native and WebLLM text through neutral provider sessions', async () => {
        await expect(generateNativeCompletion('system', 'user')).resolves.toBe('normalized text');
        await expect(generateWebLlmCompletion('system', 'user')).resolves.toBe('normalized text');

        expect(mocks.createModelProviderProtocol).toHaveBeenNthCalledWith(1, {
            provider: 'native',
            model: 'native',
        });
        expect(mocks.createModelProviderProtocol).toHaveBeenNthCalledWith(2, {
            provider: 'webllm',
            model: expect.any(String),
        });
        expect(mocks.start).toHaveBeenCalledTimes(2);
        expect(mocks.finish).toHaveBeenCalledTimes(2);
    });

    it('throws the normalized local provider failure instead of the adapter error', async () => {
        mocks.runNativeModelProviderRequest.mockRejectedValue(new Error('private native diagnostic'));
        mocks.finish.mockReturnValue({
            status: 'failed',
            output: { text: '' },
            partialOutputDisposition: 'discard',
            failure: {
                code: 'local-provider-failed',
                correlationId: 'model-text-correlation',
                retryable: true,
                safeMessage: 'The local model provider request failed.',
                partialOutputDisposition: 'discard',
            },
        });

        await expect(generateNativeCompletion('system', 'user')).rejects.toMatchObject({
            _tag: 'ModelProviderFailure',
            message: 'The local model provider request failed.',
            code: 'local-provider-failed',
            correlationId: 'model-text-correlation',
            retryable: true,
            partialOutputDisposition: 'discard',
        });
    });

    it('preserves native lifecycle unavailability without rewriting it as inference failure', async () => {
        mocks.runNativeModelProviderRequest.mockResolvedValue({
            status: 'unavailable',
            failure: {
                code: 'native-provider-unavailable',
                correlationId: 'model-text-correlation',
                retryable: true,
                safeMessage: 'The native model provider is not running.',
                partialOutputDisposition: 'none',
            },
        });

        await expect(generateNativeCompletion('system', 'user')).rejects.toMatchObject({
            _tag: 'ModelProviderFailure',
            message: 'The native model provider is not running.',
            code: 'native-provider-unavailable',
            correlationId: 'model-text-correlation',
            retryable: true,
            partialOutputDisposition: 'none',
        });
        expect(mocks.finish).not.toHaveBeenCalled();
    });

    it('routes the legacy hosted query through the neutral hosted use case', async () => {
        await expect(
            streamCloudChatCompletion([{ role: 'user', content: 'hello' }], vi.fn(), { maxTokens: 100 })
        ).resolves.toEqual({ status: 'complete' });

        expect(mocks.streamHostedModelText).toHaveBeenCalledTimes(1);
        expect(mocks.rawCloudCompletion).not.toHaveBeenCalled();
    });
});
