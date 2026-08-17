import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolSchema } from '../../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../../transformers/toolCallParser';
import { type AnthropicCloudRuntime, type OpenAiCompatibleCloudRuntime } from '../../cloudSession';
import { generateCloudToolCalls } from '../generateCloudToolCalls';

const tools: ToolSchema[] = [
    {
        type: 'function',
        function: {
            name: 'addTrack',
            description: 'Add a track',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
];

const mocks = vi.hoisted(() => ({
    getRuntime: vi.fn<() => AnthropicCloudRuntime | OpenAiCompatibleCloudRuntime | null>(),
    generateAnthropic: vi.fn<() => Promise<ToolCallResult[]>>(),
    generateOpenAi: vi.fn<() => Promise<ToolCallResult[]>>(),
    info: vi.fn(),
}));

vi.mock('../../getCloudProviderRuntime', () => ({ getCloudProviderRuntime: mocks.getRuntime }));
vi.mock('../generateAnthropicToolCalls', () => ({ generateAnthropicToolCalls: mocks.generateAnthropic }));
vi.mock('../generateOpenAiCompatibleToolCalls', () => ({
    generateOpenAiCompatibleToolCalls: mocks.generateOpenAi,
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { info: mocks.info } }));

describe('generateCloudToolCalls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getRuntime.mockReturnValue({
            provider: 'anthropic',
            model: 'claude-test',
            session_id: 'provider-session-00000000000000000000000000000000',
        });
        mocks.generateAnthropic.mockResolvedValue([{ name: 'addTrack', arguments: { name: 'Vocals' } }]);
    });

    it('rejects an unconfigured cloud runtime', async () => {
        mocks.getRuntime.mockReturnValue(null);
        await expect(generateCloudToolCalls('state', 'message')).rejects.toThrow('Hosted AI is not configured');
    });

    it('dispatches Anthropic planning through the native provider path', async () => {
        const result = await generateCloudToolCalls('state', 'message', tools);

        expect(mocks.generateAnthropic).toHaveBeenCalledWith(
            expect.objectContaining({
                systemPrompt: expect.stringContaining('state'),
                userMessage: 'message',
                toolSchemas: tools,
                signal: expect.any(AbortSignal),
            })
        );
        expect(result).toEqual([{ name: 'addTrack', arguments: { name: 'Vocals' } }]);
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('addTrack'));
    });

    it('dispatches OpenAI-compatible planning through its adapter', async () => {
        const runtime: OpenAiCompatibleCloudRuntime = {
            provider: 'openai',
            model: 'gpt-test',
            base_url: 'https://api.openai.com/v1',
            session_id: 'provider-session-00000000000000000000000000000000',
        };
        mocks.getRuntime.mockReturnValue(runtime);
        mocks.generateOpenAi.mockResolvedValue([{ name: 'addTrack', arguments: {} }]);

        await expect(generateCloudToolCalls('state', 'message', tools)).resolves.toEqual([
            { name: 'addTrack', arguments: {} },
        ]);
        expect(mocks.generateOpenAi).toHaveBeenCalledWith(
            expect.objectContaining({ runtime, userMessage: 'message', toolSchemas: tools })
        );
        expect(mocks.generateAnthropic).not.toHaveBeenCalled();
    });
});
