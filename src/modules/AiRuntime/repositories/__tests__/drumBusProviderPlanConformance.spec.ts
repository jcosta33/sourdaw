import { afterEach, describe, expect, it, vi } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { generateOpenAiCompatibleToolCalls } from '../cloudLlm/cloudInference/generateOpenAiCompatibleToolCalls';
import { type OpenAiCompatibleCloudRuntime } from '../cloudLlm/cloudSession';
import { generateWebLlmCompletion } from '../webLlm/generateWebLlmCompletion';
import { generateWebLlmToolCalls } from '../webLlm/toolCalling';

const providerPlan = [
    { name: 'createBus', arguments: { name: 'Drum Bus', binding: 'drum-bus' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-kick', outputId: '$drum-bus' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-snare', outputId: '$drum-bus' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-hats', outputId: '$drum-bus' } },
] as const;

vi.mock('../webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: vi.fn(),
}));

describe('drum bus provider plan conformance', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('normalizes equivalent ordered WebLLM and hosted-provider fixtures', async () => {
        const normalizedPlan = providerPlan.map((call) => ({ name: call.name, arguments: { ...call.arguments } }));
        vi.mocked(generateWebLlmCompletion).mockResolvedValue(JSON.stringify(normalizedPlan));
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                finish_reason: 'tool_calls',
                                message: {
                                    tool_calls: normalizedPlan.map((call) => ({
                                        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                                    })),
                                },
                            },
                        ],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                )
            )
        );
        const tools = getExecutableAppActionToolSchemas().filter(
            (tool) => tool.function.name === 'createBus' || tool.function.name === 'setTrackOutput'
        );
        const hostedRuntime: OpenAiCompatibleCloudRuntime = {
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        };

        const webLlm = await generateWebLlmToolCalls('system', 'request', tools);
        const hosted = await generateOpenAiCompatibleToolCalls({
            runtime: hostedRuntime,
            systemPrompt: 'system',
            userMessage: 'request',
            toolSchemas: tools,
        });

        expect(webLlm).toEqual({ status: 'complete', toolCalls: normalizedPlan });
        expect(hosted).toEqual(normalizedPlan);
        expect(webLlm.status === 'complete' ? webLlm.toolCalls : []).toEqual(hosted);
    });
});
