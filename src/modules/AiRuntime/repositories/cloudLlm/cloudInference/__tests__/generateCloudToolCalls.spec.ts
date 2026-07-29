import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ToolSchema } from '../../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../../transformers/toolCallParser';
import { clearCloudApiKey } from '../../clearCloudApiKey';
import { type OpenAiCompatibleCloudRuntime } from '../../cloudSession';
import { generateCloudToolCalls } from '../generateCloudToolCalls';

type CloudCreateInput = {
    model: string;
    system: string;
    tools: Array<{ name: string; description: string; input_schema: unknown }>;
    messages: Array<{ content: string }>;
};

type CloudCreateOutput = {
    content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; name: unknown; input: unknown }>;
    stop_reason: string | null;
};

type CompatibleToolInput = {
    runtime: OpenAiCompatibleCloudRuntime;
    systemPrompt: string;
    userMessage: string;
    toolSchemas: readonly ToolSchema[];
    signal?: AbortSignal;
};

const addTrackTools: ToolSchema[] = [
    {
        type: 'function',
        function: {
            name: 'addTrack',
            description: 'Add a track',
            parameters: {
                type: 'object',
                properties: { name: { type: 'string' }, kind: { type: 'string' } },
                required: ['name', 'kind'],
            },
        },
    },
];

const mocks = vi.hoisted(() => ({
    getCloudClient: vi.fn(),
    getCloudProviderRuntime: vi.fn(),
    generateOpenAiCompatibleToolCalls: vi.fn<(input: CompatibleToolInput) => Promise<ToolCallResult[]>>(),
    create: vi.fn<(input: CloudCreateInput, options?: { signal?: AbortSignal }) => Promise<CloudCreateOutput>>(),
    info: vi.fn(),
}));

vi.mock('../../getCloudClient', () => ({
    getCloudClient: mocks.getCloudClient,
}));

vi.mock('../../getCloudProviderRuntime', () => ({
    getCloudProviderRuntime: mocks.getCloudProviderRuntime,
}));

vi.mock('../generateOpenAiCompatibleToolCalls', () => ({
    generateOpenAiCompatibleToolCalls: mocks.generateOpenAiCompatibleToolCalls,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info },
}));

describe('generateCloudToolCalls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.create.mockResolvedValue({
            content: [
                { type: 'text', text: 'Sure, here are the edits.' },
                { type: 'tool_use', name: 'addTrack', input: { name: 'Vocals', kind: 'audio' } },
            ],
            stop_reason: 'tool_use',
        });
        mocks.getCloudClient.mockReturnValue({
            messages: { create: mocks.create },
        });
        mocks.getCloudProviderRuntime.mockReturnValue({
            provider: 'anthropic',
            api_key: 'test-key',
            model: 'test-model',
            client: {},
        });
    });

    it('throws if cloud client is not configured', async () => {
        mocks.getCloudClient.mockReturnValue(null);
        mocks.getCloudProviderRuntime.mockReturnValue(null);
        await expect(generateCloudToolCalls('state', 'msg')).rejects.toThrow('Cloud AI not configured');
    });

    it('calls the cloud client with mapped tools and correct system prompt', async () => {
        await generateCloudToolCalls('mock-state', 'add a track', addTrackTools);

        expect(mocks.create).toHaveBeenCalledTimes(1);
        const firstCall = mocks.create.mock.calls[0];
        if (!firstCall) {
            throw new Error('Expected the cloud client create call to have been recorded');
        }
        const args = firstCall[0];

        expect(args.model).toBeDefined();
        expect(args.system).toContain('professional music production AI');
        expect(args.system).toContain('mock-state');
        expect(args.tools).toHaveLength(1);
        const firstTool = args.tools[0];
        if (!firstTool) {
            throw new Error('Expected one cloud tool');
        }
        expect(firstTool.name).toBe('addTrack');

        expect(args.messages).toHaveLength(1);
        const firstMessage = args.messages[0];
        if (!firstMessage) {
            throw new Error('Expected one cloud message');
        }
        expect(firstMessage.content).toBe('add a track');
    });

    it('maps only the explicitly provided tool schemas', async () => {
        const tools: ToolSchema[] = [
            {
                type: 'function',
                function: {
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: {
                        type: 'object',
                        properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } },
                        required: ['trackId', 'muted'],
                    },
                },
            },
        ];

        await generateCloudToolCalls('state', 'msg', tools);

        const firstCall = mocks.create.mock.calls[0];
        if (!firstCall) {
            throw new Error('Expected the cloud client create call to have been recorded');
        }
        expect(firstCall[0].tools).toEqual([
            {
                name: 'muteTrack',
                description: 'Mute a track',
                input_schema: tools[0]?.function.parameters,
            },
        ]);
    });

    it('passes cancellation to the cloud SDK request', async () => {
        const controller = new AbortController();

        await generateCloudToolCalls('system', 'message', addTrackTools, controller.signal);

        const requestSignal = mocks.create.mock.calls[0]?.[1]?.signal;
        expect(requestSignal).toBeInstanceOf(AbortSignal);
        expect(requestSignal).not.toBe(controller.signal);
    });

    it('dispatches OpenAI-compatible providers through the fetch adapter', async () => {
        const runtime = {
            provider: 'openai' as const,
            api_key: 'test-key',
            model: 'gpt-5.2',
            base_url: 'https://api.openai.com/v1',
        };
        const controller = new AbortController();
        mocks.getCloudProviderRuntime.mockReturnValue(runtime);
        mocks.generateOpenAiCompatibleToolCalls.mockResolvedValue([
            { name: 'addTrack', arguments: { name: 'Vocals', kind: 'audio' } },
        ]);

        const result = await generateCloudToolCalls('system', 'message', addTrackTools, controller.signal);

        const adapterInput = mocks.generateOpenAiCompatibleToolCalls.mock.calls[0]?.[0];
        expect(adapterInput?.runtime).toBe(runtime);
        expect(adapterInput?.systemPrompt).toBe('system');
        expect(adapterInput?.userMessage).toBe('message');
        expect(adapterInput?.toolSchemas).toBe(addTrackTools);
        expect(adapterInput?.signal).toBeInstanceOf(AbortSignal);
        expect(result).toEqual([{ name: 'addTrack', arguments: { name: 'Vocals', kind: 'audio' } }]);
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('aborts and rejects in-flight planning when hosted credentials are revoked', async () => {
        let requestSignal: AbortSignal | undefined;
        mocks.create.mockImplementation(
            (_input, options) =>
                new Promise((_resolve, reject) => {
                    requestSignal = options?.signal;
                    requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                        once: true,
                    });
                })
        );

        const pending = generateCloudToolCalls('system', 'message', addTrackTools);
        await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
        clearCloudApiKey();

        await expect(pending).rejects.toMatchObject({ name: 'AiRuntimeConfigurationChangedError' });
        expect(requestSignal?.aborted).toBe(true);
    });

    it('extracts and maps tool_use blocks into ToolCallResult', async () => {
        const results = await generateCloudToolCalls('state', 'msg');

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            name: 'addTrack',
            arguments: { name: 'Vocals', kind: 'audio' },
        });
    });

    it('rejects a text refusal instead of treating it as an explicit empty tool batch', async () => {
        mocks.create.mockResolvedValue({
            content: [{ type: 'text', text: 'I cannot do that.' }],
            stop_reason: 'end_turn',
        });

        await expect(generateCloudToolCalls('state', 'msg')).rejects.toThrow(
            'Hosted AI returned a non-tool response instead of a tool-call batch'
        );
    });

    it('preserves an explicit empty structured tool batch', async () => {
        mocks.create.mockResolvedValue({ content: [], stop_reason: 'end_turn' });

        await expect(generateCloudToolCalls('state', 'msg')).resolves.toEqual([]);
    });

    it('rejects tool blocks from a token-limited response', async () => {
        mocks.create.mockResolvedValue({
            content: [{ type: 'tool_use', name: 'addTrack', input: { name: 'Vocals', kind: 'audio' } }],
            stop_reason: 'max_tokens',
        });

        await expect(generateCloudToolCalls('state', 'msg')).rejects.toThrow(
            'Hosted AI returned an incomplete tool-call batch'
        );
    });

    it.each([
        { label: 'empty name', name: '', input: { name: 'Vocals', kind: 'audio' } },
        { label: 'null input', name: 'addTrack', input: null },
        { label: 'array input', name: 'addTrack', input: [] },
    ])('terminally rejects an Anthropic tool_use block with $label', async ({ name, input }) => {
        mocks.create.mockResolvedValue({
            content: [{ type: 'tool_use', name, input }],
            stop_reason: 'tool_use',
        });

        await expect(generateCloudToolCalls('state', 'msg')).rejects.toMatchObject({
            name: 'ToolPlanningRejectedError',
        });
    });

    it('rejects a token-limited response before the first tool call completes', async () => {
        mocks.create.mockResolvedValue({
            content: [{ type: 'text', text: '' }],
            stop_reason: 'max_tokens',
        });

        await expect(generateCloudToolCalls('state', 'msg')).rejects.toThrow(
            'Hosted AI returned an incomplete tool-call batch'
        );
    });

    it('logs the returned tool calls', async () => {
        await generateCloudToolCalls('state', 'msg');
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('addTrack'));
    });
});
