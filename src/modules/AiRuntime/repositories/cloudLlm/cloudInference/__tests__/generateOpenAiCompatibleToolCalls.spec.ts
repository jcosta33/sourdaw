import { afterEach, describe, expect, it, vi } from 'vitest';

import { type OpenAiCompatibleCloudRuntime } from '../../cloudSession';
import { generateOpenAiCompatibleToolCalls } from '../generateOpenAiCompatibleToolCalls';

const runtime: OpenAiCompatibleCloudRuntime = {
    provider: 'openai',
    api_key: 'sk-secret',
    model: 'gpt-5.2',
    base_url: 'https://api.openai.com/v1',
};

const tools = [
    {
        type: 'function' as const,
        function: {
            name: 'muteTrack',
            description: 'Mute a track',
            parameters: {
                type: 'object' as const,
                properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } },
                required: ['trackId', 'muted'],
                additionalProperties: false,
            },
        },
    },
];

function generateToolCalls() {
    return generateOpenAiCompatibleToolCalls({
        runtime,
        systemPrompt: 'system',
        userMessage: 'mute drums',
        toolSchemas: tools,
    });
}

function respondWith(payload: unknown): void {
    vi.stubGlobal(
        'fetch',
        vi
            .fn<typeof fetch>()
            .mockResolvedValue(
                new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
            )
    );
}

function validToolChoice() {
    return {
        finish_reason: 'tool_calls',
        message: {
            tool_calls: [
                {
                    function: {
                        name: 'muteTrack',
                        arguments: '{"trackId":"track-1","muted":true}',
                    },
                },
            ],
        },
    };
}

describe('generateOpenAiCompatibleToolCalls', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends the provided schemas and parses OpenAI-compatible tool calls', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            finish_reason: 'tool_calls',
                            message: {
                                content: 'I changed the track.',
                                tool_calls: [
                                    {
                                        function: {
                                            name: 'muteTrack',
                                            arguments: '{"trackId":"track-1","muted":true}',
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const result = await generateOpenAiCompatibleToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'mute drums',
            toolSchemas: tools,
        });

        expect(result).toEqual([{ name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }]);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.openai.com/v1/chat/completions',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    Authorization: 'Bearer sk-secret',
                    'Content-Type': 'application/json',
                },
            })
        );
        const request = fetchMock.mock.calls[0]?.[1];
        if (!request || typeof request.body !== 'string') {
            throw new Error('Expected a JSON request body');
        }
        const body = JSON.parse(request.body) as Record<string, unknown>;
        expect(body.tools).toEqual(tools);
        expect(body.tool_choice).toBe('auto');
        expect(body.n).toBe(1);
    });

    it.each([
        { label: 'no choices', choices: [] },
        {
            label: 'a refused second choice',
            choices: [validToolChoice(), { finish_reason: 'stop', message: { refusal: 'cannot comply' } }],
        },
        { label: 'two valid choices', choices: [validToolChoice(), validToolChoice()] },
    ])('rejects $label instead of selecting the first choice', async ({ choices }) => {
        respondWith({ choices });

        await expect(generateToolCalls()).rejects.toMatchObject({
            name: 'HostedToolCallingProtocolError',
            message: 'Hosted AI returned an invalid response choice count',
        });
    });

    it('rejects the entire declared batch when any tool call is malformed', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                finish_reason: 'tool_calls',
                                message: {
                                    tool_calls: [
                                        {
                                            function: {
                                                name: 'muteTrack',
                                                arguments: '{"trackId":"track-1","muted":true}',
                                            },
                                        },
                                        { function: { name: 'muteTrack', arguments: 'not-json' } },
                                    ],
                                },
                            },
                        ],
                    }),
                    { status: 200 }
                )
            )
        );

        await expect(
            generateOpenAiCompatibleToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'mute drums',
                toolSchemas: tools,
            })
        ).rejects.toThrow('Hosted AI returned an invalid tool-call batch');
    });

    it('reports status without echoing credentials or provider response bodies', async () => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('key=sk-secret', { status: 401 })));

        await expect(
            generateOpenAiCompatibleToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'mute drums',
                toolSchemas: tools,
            })
        ).rejects.toThrow('Hosted AI tool request failed with status 401');
    });

    it('rejects tool calls from a token-limited response', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                finish_reason: 'length',
                                message: {
                                    tool_calls: [
                                        {
                                            function: {
                                                name: 'muteTrack',
                                                arguments: '{"trackId":"track-1","muted":true}',
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    }),
                    { status: 200 }
                )
            )
        );

        await expect(
            generateOpenAiCompatibleToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'mute drums',
                toolSchemas: tools,
            })
        ).rejects.toThrow('Hosted AI returned an incomplete tool-call batch');
    });

    it('rejects tool calls paired with a non-tool finish reason', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                finish_reason: 'stop',
                                message: {
                                    tool_calls: [
                                        {
                                            function: {
                                                name: 'muteTrack',
                                                arguments: '{"trackId":"track-1","muted":true}',
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    }),
                    { status: 200 }
                )
            )
        );

        await expect(
            generateOpenAiCompatibleToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'mute drums',
                toolSchemas: tools,
            })
        ).rejects.toThrow('Hosted AI returned an inconsistent tool-call batch');
    });

    it('rejects a token-limited response before the first tool call completes', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        choices: [{ finish_reason: 'length', message: { content: '' } }],
                    }),
                    { status: 200 }
                )
            )
        );

        await expect(
            generateOpenAiCompatibleToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'mute drums',
                toolSchemas: tools,
            })
        ).rejects.toThrow('Hosted AI returned an incomplete tool-call batch');
    });

    it('rejects provider refusals and malformed success envelopes', async () => {
        const fetchMock = vi.fn<typeof fetch>();
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    choices: [{ finish_reason: 'stop', message: { refusal: 'cannot comply' } }],
                }),
                { status: 200 }
            )
        );

        await expect(
            generateOpenAiCompatibleToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'mute drums',
                toolSchemas: tools,
            })
        ).rejects.toThrow('Hosted AI refused tool planning');

        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
        await expect(generateToolCalls()).rejects.toMatchObject({ name: 'HostedToolCallingProtocolError' });
    });

    it.each([
        { label: 'number', content: 42 },
        { label: 'object', content: { text: '' } },
        { label: 'unsupported array', content: [{ type: 'image_url', image_url: { url: 'https://invalid' } }] },
    ])('rejects protocol-invalid $label assistant content', async ({ content }) => {
        respondWith({ choices: [{ finish_reason: 'stop', message: { content, tool_calls: [] } }] });

        await expect(generateToolCalls()).rejects.toThrow('Hosted AI returned an invalid tool-planning response');
    });

    it.each([
        { label: 'absent', content: undefined },
        { label: 'null', content: null },
        { label: 'empty string', content: '' },
        { label: 'empty array', content: [] },
        { label: 'empty text array', content: [{ type: 'text', text: '' }] },
    ])('preserves protocol-valid $label assistant content as an empty batch', async ({ content }) => {
        respondWith({ choices: [{ finish_reason: 'stop', message: { content, tool_calls: [] } }] });

        await expect(generateToolCalls()).resolves.toEqual([]);
    });

    it('rejects non-empty content without tool calls', async () => {
        respondWith({
            choices: [
                {
                    finish_reason: 'stop',
                    message: {
                        content: [{ type: 'text', text: 'I changed the track.' }],
                        tool_calls: [],
                    },
                },
            ],
        });

        await expect(generateToolCalls()).rejects.toThrow(
            'Hosted AI returned a non-tool response instead of a tool-call batch'
        );
    });

    it('terminally rejects malformed JSON syntax', async () => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('{', { status: 200 })));

        await expect(generateToolCalls()).rejects.toMatchObject({ name: 'ToolPlanningRejectedError' });
    });

    it.each([
        { label: 'body stream failure', error: new TypeError('Body stream failed') },
        { label: 'abort', error: new DOMException('Aborted', 'AbortError') },
    ])('preserves a response $label for fallback handling', async ({ error }) => {
        const response = new Response('{}', { status: 200 });
        const reader = response.body?.getReader();
        if (!reader || !response.body) {
            throw new Error('Expected a readable response body');
        }
        vi.spyOn(reader, 'read').mockRejectedValue(error);
        vi.spyOn(response.body, 'getReader').mockReturnValue(reader);
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response));

        await expect(generateToolCalls()).rejects.toBe(error);
    });

    it('omits authorization for an auth-free compatible endpoint', async () => {
        const authFreeRuntime: OpenAiCompatibleCloudRuntime = {
            provider: 'openai-compatible',
            api_key: '',
            model: 'local-model',
            base_url: 'http://localhost:1234/v1',
        };
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { tool_calls: [] } }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        await generateOpenAiCompatibleToolCalls({
            runtime: authFreeRuntime,
            systemPrompt: 'system',
            userMessage: 'mute drums',
            toolSchemas: tools,
        });

        expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
            'Content-Type': 'application/json',
        });
    });
});
