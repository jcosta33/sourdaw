import { describe, expect, it } from 'vitest';

import { startLoopbackOpenAiProvider } from '../loopbackOpenAiProvider';

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

    it('returns explicitly scripted non-streaming tool calls in order', async () => {
        const provider = await startLoopbackOpenAiProvider({
            toolCalls: [
                { id: 'query', name: 'project_query', arguments: { type: 'project-summary' } },
                { id: 'answer', name: 'answer_respond', arguments: { text: 'Done', evidenceCallIds: ['query'] } },
            ],
        });
        try {
            for (const [id, name, args] of [
                ['query', 'project_query', { type: 'project-summary' }],
                ['answer', 'answer_respond', { text: 'Done', evidenceCallIds: ['query'] }],
            ] as const) {
                const response = await post(provider.baseUrl, { stream: false });
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
    });
});
