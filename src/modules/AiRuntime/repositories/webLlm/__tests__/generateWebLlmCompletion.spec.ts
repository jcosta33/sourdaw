import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateWebLlmCompletion } from '../generateWebLlmCompletion';
import { generateWebLlmToolCalls } from '../toolCalling';

const mocks = vi.hoisted(() => ({
    createCompletion: vi.fn<(payload: Record<string, unknown>) => Promise<unknown>>(),
    interruptGenerate: vi.fn(),
    initWebLlmEngine: vi.fn(),
    info: vi.fn(),
}));

vi.mock('../initWebLlmEngine', () => ({
    initWebLlmEngine: mocks.initWebLlmEngine,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function ignoreRejection(_reason: unknown): void {}

type Outcome<T> = { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown };

describe('generateWebLlmCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.initWebLlmEngine.mockResolvedValue({
            interruptGenerate: mocks.interruptGenerate,
            chat: { completions: { create: mocks.createCompletion } },
        });
        mocks.createCompletion.mockResolvedValue({
            choices: [{ finish_reason: 'stop', message: { content: '<think>reasoning</think>Final answer' } }],
        });
    });

    it('returns only a normally completed answer', async () => {
        await expect(generateWebLlmCompletion('system', 'user')).resolves.toBe('Final answer');
    });

    it('returns a normally completed strict tool-planning answer', async () => {
        await expect(generateWebLlmCompletion('system', 'user', { requireComplete: true })).resolves.toBe(
            'Final answer'
        );
    });

    it('rejects a token-limited response before structured consumers can parse it', async () => {
        mocks.createCompletion.mockResolvedValue({
            choices: [{ finish_reason: 'length', message: { content: '[{"name":"muteTrack"}]' } }],
        });

        await expect(generateWebLlmCompletion('system', 'user')).rejects.toThrow(
            'WebLLM returned an incomplete completion'
        );
    });

    it.each([
        {
            label: 'length finish',
            response: {
                choices: [{ finish_reason: 'length', message: { content: '[{"name":"muteTrack"}]' } }],
            },
        },
        { label: 'missing choice', response: { choices: [] } },
        { label: 'missing finish', response: { choices: [{ message: { content: '[]' } }] } },
        { label: 'missing message', response: { choices: [{ finish_reason: 'stop' }] } },
        { label: 'non-string content', response: { choices: [{ finish_reason: 'stop', message: { content: null } }] } },
    ])('terminally rejects strict tool planning with $label', async ({ response }) => {
        mocks.createCompletion.mockResolvedValue(response);

        await expect(generateWebLlmCompletion('system', 'user', { requireComplete: true })).rejects.toMatchObject({
            name: 'ToolPlanningRejectedError',
        });
    });

    it('sends the bounded reply and the empty thinking block to the engine when tool planning asks', async () => {
        await generateWebLlmCompletion('system', 'user', {
            requireComplete: true,
            maxTokens: 3_072,
            enableThinking: false,
        });

        expect(mocks.createCompletion).toHaveBeenCalledWith(
            expect.objectContaining({ max_tokens: 3_072, extra_body: { enable_thinking: false } })
        );
    });

    it('leaves thinking to the model when the caller does not turn it off', async () => {
        await generateWebLlmCompletion('system', 'user');

        expect(mocks.createCompletion.mock.calls[0]?.[0]).not.toHaveProperty('extra_body');
    });

    it('constrains decoding through response_format only when the caller gives a schema', async () => {
        const schema = JSON.stringify({ type: 'array' });

        await generateWebLlmCompletion('system', 'user', { responseFormatSchema: schema });
        await generateWebLlmCompletion('system', 'user');

        expect(mocks.createCompletion.mock.calls[0]?.[0]).toMatchObject({
            response_format: { type: 'json_object', schema },
        });
        expect(mocks.createCompletion.mock.calls[1]?.[0]).not.toHaveProperty('response_format');
    });

    it('logs the prompt tokens the engine reports beside the estimate', async () => {
        mocks.createCompletion.mockResolvedValue({
            choices: [{ finish_reason: 'stop', message: { content: '[]' } }],
            usage: { prompt_tokens: 9_000, completion_tokens: 12 },
        });

        await generateWebLlmCompletion('system', 'user', { requireComplete: true, estimatedPromptTokens: 9_400 });

        expect(mocks.info).toHaveBeenCalledWith('[WebLLM] prompt tokens reported=9000 estimated=9400 margin=400');
    });

    it('preserves WebLLM runtime errors during strict tool planning', async () => {
        const error = new TypeError('WebGPU device lost');
        mocks.createCompletion.mockRejectedValue(error);

        await expect(generateWebLlmCompletion('system', 'user', { requireComplete: true })).rejects.toBe(error);
    });

    it('interrupts active inference when the caller aborts', async () => {
        let rejectCompletion: (reason: unknown) => void = ignoreRejection;
        mocks.createCompletion.mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    rejectCompletion = reject;
                })
        );
        mocks.interruptGenerate.mockImplementation(() => {
            rejectCompletion(new DOMException('Aborted', 'AbortError'));
        });
        const controller = new AbortController();
        const pending = generateWebLlmCompletion('system', 'user', {
            signal: controller.signal,
            requireComplete: true,
        });
        await vi.waitFor(() => expect(mocks.createCompletion).toHaveBeenCalledTimes(1));

        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.interruptGenerate).toHaveBeenCalledTimes(1);
    });

    it('does not interrupt active inference when a queued caller aborts', async () => {
        const activeCompletion = Promise.withResolvers<unknown>();
        const queuedCompletion = Promise.withResolvers<unknown>();
        let rejectActive: (reason: unknown) => void = ignoreRejection;
        let completionCount = 0;
        mocks.createCompletion.mockImplementation(() => {
            completionCount += 1;
            if (completionCount === 1) {
                return new Promise((_resolve, reject) => {
                    rejectActive = reject;
                    activeCompletion.promise.then(_resolve, reject);
                });
            }
            return queuedCompletion.promise;
        });
        mocks.interruptGenerate.mockImplementation(() => {
            rejectActive(new DOMException('Aborted', 'AbortError'));
        });

        const active = generateWebLlmCompletion('system', 'active');
        const queuedController = new AbortController();
        const queuedAddEventListener = vi.spyOn(queuedController.signal, 'addEventListener');
        const queued = generateWebLlmCompletion('system', 'queued', { signal: queuedController.signal });
        const activeOutcome: Promise<Outcome<string>> = active.then(
            (value): Outcome<string> => ({ status: 'fulfilled', value }),
            (error: unknown): Outcome<string> => ({ status: 'rejected', reason: error })
        );
        const queuedOutcome: Promise<Outcome<string>> = queued.then(
            (value): Outcome<string> => ({ status: 'fulfilled', value }),
            (error: unknown): Outcome<string> => ({ status: 'rejected', reason: error })
        );

        try {
            await vi.waitFor(() => expect(mocks.createCompletion).toHaveBeenCalled());
            await vi.waitFor(() =>
                expect(
                    queuedAddEventListener.mock.calls.some(
                        ([type, listener]) => type === 'abort' && typeof listener === 'function'
                    )
                ).toBe(true)
            );

            queuedController.abort();
            activeCompletion.resolve({
                choices: [{ finish_reason: 'stop', message: { content: '<think>work</think>active answer' } }],
            });
            queuedCompletion.resolve({
                choices: [{ finish_reason: 'stop', message: { content: 'queued answer' } }],
            });

            await expect(activeOutcome).resolves.toEqual({ status: 'fulfilled', value: 'active answer' });
            await expect(queuedOutcome).resolves.toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } });
            expect(mocks.interruptGenerate).not.toHaveBeenCalled();
        } finally {
            activeCompletion.resolve({
                choices: [{ finish_reason: 'stop', message: { content: 'active answer' } }],
            });
            queuedCompletion.resolve({
                choices: [{ finish_reason: 'stop', message: { content: 'queued answer' } }],
            });
            await Promise.all([activeOutcome, queuedOutcome]);
            queuedAddEventListener.mockRestore();
        }
    });

    describe('local tool planning', () => {
        const tools = [
            {
                type: 'function' as const,
                function: {
                    name: 'setTrackGain',
                    description: 'Sets a gain.',
                    parameters: { type: 'object', properties: { gainDb: { type: 'number' } }, required: ['gainDb'] },
                },
            },
            { type: 'function' as const, function: { name: 'muteTrack', description: 'Mutes.', parameters: {} } },
        ];

        function sentPayload(): Record<string, unknown> {
            const payload = mocks.createCompletion.mock.calls[0]?.[0];
            if (payload === undefined) {
                throw new Error('No completion was requested');
            }
            return payload;
        }

        function schemaToolNames(payload: Record<string, unknown>): string[] {
            const format = payload.response_format as { type: string; schema: string };
            const parsed = JSON.parse(format.schema) as {
                items: { anyOf: { properties: { name: { const: string } } }[] };
            };
            return parsed.items.anyOf.map((branch) => branch.properties.name.const);
        }

        function promptToolNames(payload: Record<string, unknown>): string[] {
            const [system] = payload.messages as { content: string }[];
            const section = system?.content.split('Available tools:\n')[1]?.split('\n\n')[0] ?? '';
            return Array.from(section.matchAll(/^- ([^\s:]+)/gm), (match) => match[1] ?? '');
        }

        // Red when the schema is built from anything but the list the prompt serializes.
        it('constrains the reply to exactly the tools its system prompt offers, without thinking', async () => {
            mocks.createCompletion.mockResolvedValue({
                choices: [{ finish_reason: 'stop', message: { content: '[]' } }],
            });

            await generateWebLlmToolCalls('plan', 'user', tools);

            const payload = sentPayload();
            expect(payload.response_format).toMatchObject({ type: 'json_object' });
            expect(new Set(schemaToolNames(payload))).toEqual(new Set(tools.map((tool) => tool.function.name)));
            expect(new Set(promptToolNames(payload))).toEqual(new Set(schemaToolNames(payload)));
            expect(payload.extra_body).toEqual({ enable_thinking: false });
        });

        it('answers a malformed constrained reply with the rejected outcome', async () => {
            mocks.createCompletion.mockResolvedValue({
                choices: [
                    { finish_reason: 'stop', message: { content: '[{"id":"a","name":"muteTrack","arguments":{' } },
                ],
            });

            await expect(generateWebLlmToolCalls('plan', 'user', tools)).resolves.toEqual({
                status: 'rejected',
                reason: 'Model returned a malformed tool-call batch.',
            });
        });

        it('rejects a reply cut off at the token limit as a planning rejection', async () => {
            mocks.createCompletion.mockResolvedValue({
                choices: [{ finish_reason: 'length', message: { content: '[{"id":"a"' } }],
            });

            await expect(generateWebLlmToolCalls('plan', 'user', tools)).rejects.toMatchObject({
                name: 'ToolPlanningRejectedError',
            });
        });

        it('rejects with an abort when the caller aborts mid-generation', async () => {
            let rejectCompletion: (reason: unknown) => void = ignoreRejection;
            mocks.createCompletion.mockImplementation(
                () =>
                    new Promise((_resolve, reject) => {
                        rejectCompletion = reject;
                    })
            );
            mocks.interruptGenerate.mockImplementation(() => {
                rejectCompletion(new DOMException('Aborted', 'AbortError'));
            });
            const controller = new AbortController();
            const pending = generateWebLlmToolCalls('plan', 'user', tools, controller.signal);
            await vi.waitFor(() => expect(mocks.createCompletion).toHaveBeenCalledTimes(1));

            controller.abort();

            await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        });
    });
});
