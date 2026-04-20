import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateCloudToolCalls } from '../generateCloudToolCalls';

const mocks = vi.hoisted(() => ({
    getCloudClient: vi.fn(),
    mcpToOpenAiTools: vi.fn(),
    create: vi.fn(),
    info: vi.fn(),
}));

vi.mock('../../keyManagement', () => ({
    getCloudClient: mocks.getCloudClient,
}));

vi.mock('../../../mcpToolAdapter/mcpToOpenAiTools', () => ({
    mcpToOpenAiTools: mocks.mcpToOpenAiTools,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info },
}));

describe('generateCloudToolCalls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mcpToOpenAiTools.mockReturnValue([
            { function: { name: 'addTrack', description: 'Add a track', parameters: { type: 'object' } } },
        ]);
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
        await generateCloudToolCalls('mock-state', 'add a track');

        expect(mocks.create).toHaveBeenCalledTimes(1);
        const args = mocks.create.mock.calls[0][0];

        expect(args.model).toBeDefined();
        expect(args.system).toContain('professional music production AI');
        expect(args.tools).toHaveLength(1);
        expect(args.tools[0].name).toBe('addTrack');

        expect(args.messages).toHaveLength(1);
        expect(args.messages[0].content).toContain('mock-state');
        expect(args.messages[0].content).toContain('User request: add a track');
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
