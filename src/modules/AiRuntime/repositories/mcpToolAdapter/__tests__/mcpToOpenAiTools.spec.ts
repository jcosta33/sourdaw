import { describe, it, expect, vi } from 'vitest';

import { mcpToOpenAiTools } from '../mcpToOpenAiTools';

vi.mock('../helpers', () => ({
    getMcpTools: vi.fn(() => [
        {
            name: 'addTrack',
            description: 'Creates a track',
            inputSchema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
            },
        },
    ]),
}));

describe('mcpToOpenAiTools', () => {
    it('converts MCP tools to OpenAI tool format', () => {
        const tools = mcpToOpenAiTools();

        expect(tools).toHaveLength(1);
        expect(tools[0]).toEqual({
            type: 'function',
            function: {
                name: 'addTrack',
                description: 'Creates a track',
                parameters: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    required: ['name'],
                },
            },
        });
    });
});
