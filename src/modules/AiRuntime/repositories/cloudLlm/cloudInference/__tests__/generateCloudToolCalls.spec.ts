import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ToolSchema } from '../../../../models/ToolDefinitions';
import { generateCloudToolCalls } from '../generateCloudToolCalls';

type CloudCreateInput = {
    model: string;
    system: string;
    tools: Array<{ name: string; description: string; input_schema: unknown }>;
    messages: Array<{ content: string }>;
};

type CloudCreateOutput = {
    content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; name: string; input: Record<string, unknown> }>;
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
    create: vi.fn<(input: CloudCreateInput, options?: { signal?: AbortSignal }) => Promise<CloudCreateOutput>>(),
    info: vi.fn(),
}));

vi.mock('../../getCloudClient', () => ({
    getCloudClient: mocks.getCloudClient,
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
        });
        mocks.getCloudClient.mockReturnValue({
            messages: { create: mocks.create },
        });
    });

    it('throws if cloud client is not configured', async () => {
        mocks.getCloudClient.mockReturnValue(null);
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

        expect(mocks.create).toHaveBeenCalledWith(expect.any(Object), { signal: controller.signal });
    });

    it('extracts and maps tool_use blocks into ToolCallResult', async () => {
        const results = await generateCloudToolCalls('state', 'msg');

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            name: 'addTrack',
            arguments: { name: 'Vocals', kind: 'audio' },
        });
    });

    it('handles empty tool blocks safely', async () => {
        mocks.create.mockResolvedValue({
            content: [{ type: 'text', text: 'I cannot do that.' }],
        });

        const results = await generateCloudToolCalls('state', 'msg');
        expect(results).toHaveLength(0);
    });

    it('logs the returned tool calls', async () => {
        await generateCloudToolCalls('state', 'msg');
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('addTrack'));
    });
});
