import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { type CloudChatCompletionOutcome } from '../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';
import { aiBackendPreferenceStore } from '../../stores/aiBackendPreferenceStore';
import { explainMixHealthReport } from '../explainMixHealthReport';

type HostedTransportOptions = { maxTokens?: number; signal?: AbortSignal };

const mocks = vi.hoisted(() => ({
    streamCloudChatCompletion:
        vi.fn<
            (
                messages: Array<{ role: string; content: string }>,
                onToken: (text: string) => void,
                options?: HostedTransportOptions
            ) => Promise<CloudChatCompletionOutcome>
        >(),
    generateWebLlmCompletion:
        vi.fn<
            (
                systemPrompt: string,
                userMessage: string,
                options?: { maxTokens?: number; signal?: AbortSignal }
            ) => Promise<string>
        >(),
    getLlmEngine: vi.fn<() => object | null>(() => null),
    isCloudAvailable: vi.fn(() => true),
    isWebGpuAvailable: vi.fn(() => false),
}));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({
    MODEL_RELEASE_ADMISSION: { webLlm: true },
}));

vi.mock('#/modules/BrowserAi/stores', () => ({
    isWebGpuAvailable: mocks.isWebGpuAvailable,
}));

vi.mock('../../repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () => ({ provider: 'anthropic' as const, model: 'hosted-model' }),
}));

vi.mock('../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion', () => ({
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

vi.mock('../../repositories/webLlm/getLlmEngine', () => ({
    getLlmEngine: mocks.getLlmEngine,
}));

vi.mock('../aiRuntimeQueries/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: mocks.generateWebLlmCompletion,
}));

const COMPLETE: CloudChatCompletionOutcome = { status: 'complete', finishReason: 'stop', providerRequestId: null };

const REPORT = 'Technical report body.';

describe('explainMixHealthReport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.streamCloudChatCompletion.mockResolvedValue(COMPLETE);
        mocks.getLlmEngine.mockReturnValue(null);
        mocks.isCloudAvailable.mockReturnValue(true);
        mocks.isWebGpuAvailable.mockReturnValue(false);
    });

    afterEach(() => {
        aiBackendPreferenceStore.set('auto');
    });

    it('streams the beginner explanation of the report from the selected hosted provider', async () => {
        aiBackendPreferenceStore.set('cloud');
        mocks.streamCloudChatCompletion.mockImplementation((_messages, emitToken) => {
            emitToken('Simple explanation.');
            return Promise.resolve(COMPLETE);
        });
        const controller = new AbortController();
        const onToken = vi.fn();

        await explainMixHealthReport({ report: REPORT, onToken, signal: controller.signal });

        const [messages, , options] = mocks.streamCloudChatCompletion.mock.calls[0] ?? [];
        expect(messages?.[0]).toEqual({ role: 'system', content: 'You are a patient music teacher for beginners.' });
        expect(messages?.[1]?.content).toContain(REPORT);
        expect(options?.maxTokens).toBe(2_048);
        expect(options?.signal).toBe(controller.signal);
        expect(onToken.mock.calls).toEqual([['Simple explanation.']]);
    });

    it('rejects an incomplete hosted explanation after forwarding its partial output', async () => {
        aiBackendPreferenceStore.set('cloud');
        mocks.streamCloudChatCompletion.mockImplementation((_messages, emitToken) => {
            emitToken('Partial explanation.');
            return Promise.resolve({
                status: 'incomplete',
                reason: 'max_tokens',
                finishReason: 'length',
                safeMessage: 'The hosted model stopped at its output limit.',
                providerRequestId: null,
            });
        });
        const onToken = vi.fn();

        await expect(explainMixHealthReport({ report: REPORT, onToken })).rejects.toThrow('output limit');
        expect(onToken).toHaveBeenCalledWith('Partial explanation.');
    });

    it('fails closed with guidance and sends nothing remotely under Automatic without a local model', async () => {
        aiBackendPreferenceStore.set('auto');

        await expect(explainMixHealthReport({ report: REPORT, onToken: vi.fn() })).rejects.toThrow(
            'Mix Health needs an AI model. Load the local WebLLM model in Settings > AI, or select the hosted provider there to send this analysis remotely.'
        );
        expect(mocks.streamCloudChatCompletion).not.toHaveBeenCalled();
        expect(mocks.generateWebLlmCompletion).not.toHaveBeenCalled();
    });

    it('explains on the loaded local model under Automatic and sends nothing remotely', async () => {
        aiBackendPreferenceStore.set('auto');
        mocks.isWebGpuAvailable.mockReturnValue(true);
        mocks.getLlmEngine.mockReturnValue({});
        mocks.generateWebLlmCompletion.mockResolvedValue('Local explanation.');
        const onToken = vi.fn();

        await explainMixHealthReport({ report: REPORT, onToken });

        expect(mocks.streamCloudChatCompletion).not.toHaveBeenCalled();
        const [systemPrompt, userMessage, options] = mocks.generateWebLlmCompletion.mock.calls[0] ?? [];
        expect(systemPrompt).toBe('You are a patient music teacher for beginners.');
        expect(userMessage).toContain(REPORT);
        expect(options?.maxTokens).toBe(2_048);
        expect(onToken.mock.calls).toEqual([['Local explanation.']]);
    });
});
