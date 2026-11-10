import { describe, expect, it } from 'vitest';

import { createLoopbackAnswerToolCalls, startLoopbackOpenAiProvider } from '../loopbackOpenAiProvider';

async function post(baseUrl: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/chat/completions`, { method: 'POST', body: JSON.stringify(body) });
}

describe('loopback OpenAI provider', () => {
    it('keeps the default text stream', async () => {
        const provider = await startLoopbackOpenAiProvider({ reply: 'Hello' });
        try {
            const response = await post(provider.baseUrl, { stream: true });
            expect(response.headers.get('content-type')).toBe('text/event-stream');
            const body = await response.text();
            expect(body).toContain('Hello');
            expect(body).toContain('data: [DONE]');
        } finally {
            await provider.close();
        }
    });

    it.each(['selectAnswerInterpretation', 'selectCreativeInterpretation'] as const)(
        'returns explicitly scripted non-streaming tool calls in order through %s',
        async (intakeName) => {
            const provider = await startLoopbackOpenAiProvider({
                toolCalls: createLoopbackAnswerToolCalls(),
            });
            try {
                const answer = {
                    kind: 'project-facts',
                    topicIds: [],
                    scopeCandidateIds: [],
                    rangeCandidateId: null,
                    uncertainty: 'none',
                };
                let intakeArguments: Record<string, unknown> = { catalogId: 'dynamic-answer-catalog', ...answer };
                if (intakeName === 'selectCreativeInterpretation') {
                    intakeArguments = {
                        catalogId: 'dynamic-answer-catalog',
                        modeId: 'read-only',
                        targetCandidateIds: [],
                        editDimensionCandidateIds: [],
                        constraintCandidateIds: [],
                        creationSlotIds: [],
                        uncertainty: 'none',
                        answer,
                    };
                }
                for (const [id, name, args] of [
                    ['loopback-intake', intakeName, intakeArguments],
                    ['loopback-query', 'project_query', { type: 'project-summary' }],
                    [
                        'loopback-answer',
                        'answer_respond',
                        {
                            intakeCallId: 'loopback-intake',
                            statements: [
                                { kind: 'project-fact', fact: 'summary' },
                                { kind: 'query-page', callId: 'loopback-query' },
                            ],
                        },
                    ],
                ] as const) {
                    const response = await post(provider.baseUrl, {
                        stream: false,
                        tools: [
                            {
                                type: 'function',
                                function: {
                                    name: intakeName,
                                    parameters: { properties: { catalogId: { const: 'dynamic-answer-catalog' } } },
                                },
                            },
                        ],
                    });
                    expect(response.headers.get('content-type')).toBe('application/json');
                    expect(await response.json()).toMatchObject({
                        choices: [
                            {
                                finish_reason: 'tool_calls',
                                message: {
                                    tool_calls: [
                                        { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
                                    ],
                                },
                            },
                        ],
                    });
                }
                expect((await post(provider.baseUrl, { stream: false })).status).toBe(500);
            } finally {
                await provider.close();
            }
        }
    );
});
