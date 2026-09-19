import { afterEach, describe, expect, it, vi } from 'vitest';

import { isHostedAiHttpStatusError } from '../../../../errors/HostedAiHttpStatusError';
import { ToolPlanningRejectedError } from '../../../../errors/ToolPlanningRejectedError';
import { type OpenAiCompatibleCloudRuntime } from '../../cloudSession';
import { generateOpenAiCompatibleToolCalls } from '../generateOpenAiCompatibleToolCalls';
import { AUTO_TOOL_CHOICE, type HostedToolChoiceDirective } from '../hostedToolPlan';

const runtime: OpenAiCompatibleCloudRuntime = {
    provider: 'openai-compatible',
    authentication: 'none',
    session_id: null,
    model: 'gpt-5.2',
    base_url: 'http://localhost:1234/v1',
    strict_tool_schemas: false,
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

function generateToolCalls(directive: HostedToolChoiceDirective = AUTO_TOOL_CHOICE) {
    return generateOpenAiCompatibleToolCalls({
        runtime,
        systemPrompt: 'system',
        userMessage: 'mute drums',
        toolSchemas: tools,
        maxOutputTokens: 8192,
        directive,
    });
}

async function requestBodyFor(
    targetRuntime: OpenAiCompatibleCloudRuntime,
    directive: HostedToolChoiceDirective = AUTO_TOOL_CHOICE
): Promise<Record<string, unknown>> {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { tool_calls: [] } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    await generateOpenAiCompatibleToolCalls({
        runtime: targetRuntime,
        systemPrompt: 'system',
        userMessage: 'mute drums',
        toolSchemas: tools,
        maxOutputTokens: 8192,
        directive,
    });
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request || typeof request.body !== 'string') {
        throw new Error('Expected a JSON request body');
    }
    return JSON.parse(request.body) as Record<string, unknown>;
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
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
        });

        expect(result.calls).toEqual([{ name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }]);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:1234/v1/chat/completions',
            expect.objectContaining({
                method: 'POST',
                headers: {
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
        expect(body).not.toHaveProperty('reasoning_effort');
    });

    it('narrows the wire tools to the required directive and never sends parallel_tool_calls', async () => {
        const twoTools = [
            tools[0]!,
            {
                type: 'function' as const,
                function: {
                    name: 'setTempo',
                    description: 'Set tempo',
                    parameters: {
                        type: 'object' as const,
                        properties: { bpm: { type: 'number' } },
                        required: ['bpm'],
                        additionalProperties: false,
                    },
                },
            },
        ];
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { tool_calls: [] } }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        await generateOpenAiCompatibleToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'mute drums',
            toolSchemas: twoTools,
            maxOutputTokens: 8192,
            directive: { mode: 'required', toolNames: ['muteTrack'] },
        });

        const request = fetchMock.mock.calls[0]?.[1];
        if (!request || typeof request.body !== 'string') {
            throw new Error('Expected a JSON request body');
        }
        const body = JSON.parse(request.body) as {
            tools: Array<{ function: { name: string } }>;
            tool_choice: unknown;
        };
        expect(body.tool_choice).toBe('required');
        expect(body.tools).toHaveLength(1);
        expect(body.tools[0]?.function.name).toBe('muteTrack');
        expect(body).not.toHaveProperty('parallel_tool_calls');
    });

    it('throws before any network call when a required directive names no tool', async () => {
        const fetchMock = vi.fn<typeof fetch>();
        vi.stubGlobal('fetch', fetchMock);

        await expect(generateToolCalls({ mode: 'required', toolNames: [] })).rejects.toThrow(
            'Hosted AI tool-choice directive named an empty tool set'
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('projects a strict, bound-free wire schema only when the runtime opts in', async () => {
        const strictRuntime: OpenAiCompatibleCloudRuntime = { ...runtime, strict_tool_schemas: true };
        const boundedTools = [
            {
                type: 'function' as const,
                function: {
                    name: 'setTempo',
                    description: 'Set tempo',
                    parameters: {
                        type: 'object' as const,
                        properties: { bpm: { type: 'number', minimum: 20, maximum: 300 } },
                        required: ['bpm'],
                        additionalProperties: false,
                    },
                },
            },
        ];
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ finish_reason: 'stop', message: { tool_calls: [] } }],
                    usage: { prompt_tokens: 11, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 } },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const result = await generateOpenAiCompatibleToolCalls({
            runtime: strictRuntime,
            systemPrompt: 'system',
            userMessage: 'faster',
            toolSchemas: boundedTools,
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
        });

        const request = fetchMock.mock.calls[0]?.[1];
        if (!request || typeof request.body !== 'string') {
            throw new Error('Expected a JSON request body');
        }
        const body = JSON.parse(request.body) as {
            tools: Array<{ function: { strict?: boolean; parameters: Record<string, unknown> } }>;
        };
        expect(body.tools[0]?.function.strict).toBe(true);
        expect(body.tools[0]?.function.parameters).not.toHaveProperty(['properties', 'bpm', 'minimum']);
        expect(result.strictToolSchemas).toBe(true);
        expect(result.usage).toEqual({
            inputTokens: 11,
            outputTokens: 3,
            cacheReadInputTokens: 2,
            cacheWriteInputTokens: null,
        });
    });

    it('sends an unprojected schema and no strict flag for a non-strict runtime', async () => {
        const boundedTools = [
            {
                type: 'function' as const,
                function: {
                    name: 'setTempo',
                    description: 'Set tempo',
                    parameters: {
                        type: 'object' as const,
                        properties: { bpm: { type: 'number', minimum: 20, maximum: 300 } },
                        required: ['bpm'],
                        additionalProperties: false,
                    },
                },
            },
        ];
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { tool_calls: [] } }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const result = await generateOpenAiCompatibleToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'faster',
            toolSchemas: boundedTools,
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
        });

        const request = fetchMock.mock.calls[0]?.[1];
        if (!request || typeof request.body !== 'string') {
            throw new Error('Expected a JSON request body');
        }
        const body = JSON.parse(request.body) as {
            tools: Array<{ function: { strict?: boolean; parameters: Record<string, unknown> } }>;
        };
        expect(body.tools[0]?.function.strict).toBeUndefined();
        expect(body.tools[0]).not.toHaveProperty('strict');
        expect(body.tools[0]?.function.parameters).toHaveProperty(['properties', 'bpm', 'minimum'], 20);
        expect(result.strictToolSchemas).toBe(false);
    });

    it('sends max_tokens for openai-compatible provider', async () => {
        const body = await requestBodyFor(runtime);
        expect(body.max_tokens).toBe(8192);
        expect(body).not.toHaveProperty('max_completion_tokens');
    });

    it('omits reasoning_effort for openai-compatible endpoints', async () => {
        const body = await requestBodyFor({
            ...runtime,
            model: 'gpt-5.6-luna',
        });
        expect(body).not.toHaveProperty('reasoning_effort');
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
                maxOutputTokens: 8192,
                directive: AUTO_TOOL_CHOICE,
            })
        ).rejects.toThrow('Hosted AI returned an invalid tool-call batch');
    });

    it('reports status without echoing credentials or provider response bodies', async () => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('key=sk-secret', { status: 401 })));

        const error = await generateOpenAiCompatibleToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'mute drums',
            toolSchemas: tools,
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
        }).catch((error: unknown) => error);

        expect(isHostedAiHttpStatusError(error)).toBe(true);
        if (!isHostedAiHttpStatusError(error)) {
            return;
        }
        expect(error.message).toBe('Hosted AI tool request failed with status 401');
        expect(error.status).toBe(401);
        expect(error.message).not.toContain('key=sk-secret');
        expect(error.message).not.toContain('sk-secret');
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
                maxOutputTokens: 8192,
                directive: AUTO_TOOL_CHOICE,
            })
        ).rejects.toThrow('Hosted AI tool plan was truncated at the token limit');
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
                maxOutputTokens: 8192,
                directive: AUTO_TOOL_CHOICE,
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
                maxOutputTokens: 8192,
                directive: AUTO_TOOL_CHOICE,
            })
        ).rejects.toThrow('Hosted AI tool plan was truncated at the token limit');
    });

    it('verifies finish_reason length throws ToolPlanningRejectedError with truncation message', async () => {
        respondWith({
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
        });

        await expect(generateToolCalls()).rejects.toThrow(
            new ToolPlanningRejectedError('Hosted AI tool plan was truncated at the token limit')
        );
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
                maxOutputTokens: 8192,
                directive: AUTO_TOOL_CHOICE,
            })
        ).rejects.toThrow('Hosted AI refused tool planning');

        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
        await expect(generateToolCalls()).rejects.toMatchObject({ name: 'HostedToolCallingProtocolError' });
    });

    it('attributes provider-reported usage to a refused turn', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        choices: [{ finish_reason: 'stop', message: { refusal: 'cannot comply' } }],
                        usage: { prompt_tokens: 18, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 } },
                    }),
                    { status: 200 }
                )
            )
        );

        const error = await generateToolCalls().catch((error: unknown) => error);

        expect(error).toMatchObject({
            name: 'ToolPlanningRejectedError',
            usage: { inputTokens: 18, outputTokens: 5, cacheReadInputTokens: 0, cacheWriteInputTokens: null },
        });
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

        await expect(generateToolCalls()).resolves.toMatchObject({ calls: [] });
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
            authentication: 'none',
            session_id: null,
            model: 'local-model',
            base_url: 'http://localhost:1234/v1',
            strict_tool_schemas: false,
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
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
        });

        expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
            'Content-Type': 'application/json',
        });
    });

    it('encodes dotted tool names on the wire and decodes them on the response', async () => {
        const dottedTools = [
            {
                type: 'function' as const,
                function: {
                    name: 'project.query',
                    description: 'Query the project',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: [],
                        additionalProperties: false,
                    },
                },
            },
        ];
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            finish_reason: 'tool_calls',
                            message: {
                                tool_calls: [
                                    {
                                        function: {
                                            name: 'project_query',
                                            arguments: '{}',
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
            userMessage: 'what tracks exist',
            toolSchemas: dottedTools,
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
        });

        const request = fetchMock.mock.calls[0]?.[1];
        if (!request || typeof request.body !== 'string') {
            throw new Error('Expected a JSON request body');
        }
        const body = JSON.parse(request.body) as {
            tools: Array<{ function: { name: string } }>;
        };
        expect(body.tools[0]?.function.name).toBe('project_query');
        for (const tool of body.tools) {
            expect(tool.function.name).not.toContain('.');
        }
        expect(result.calls).toEqual([{ name: 'project.query', arguments: {} }]);
    });
});
