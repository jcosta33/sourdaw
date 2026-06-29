import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toMcpTools, getMcpTools } from '../helpers';

vi.mock('#/modules/AiRuntime/models/ToolDefinitions', () => ({
    DAW_TOOL_SCHEMAS: [
        {
            type: 'function',
            function: {
                name: 'addTrack',
                description: 'Creates a track',
                parameters: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        kind: { type: 'string', enum: ['audio', 'midi'] },
                    },
                    required: ['name'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'play',
                description: 'Starts playback',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
        },
    ],
}));

describe('mcpToolAdapter helpers', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('toMcpTools converts DAW_TOOL_SCHEMAS to MCP format', () => {
        const mcpTools = toMcpTools();

        expect(mcpTools).toHaveLength(2);

        expect(mcpTools[0]).toEqual({
            name: 'addTrack',
            description: 'Creates a track',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    kind: { type: 'string', enum: ['audio', 'midi'] },
                },
                required: ['name'],
            },
        });

        // If required is empty, it should be undefined in MCP
        expect(mcpTools[1]).toEqual({
            name: 'play',
            description: 'Starts playback',
            inputSchema: {
                type: 'object',
                properties: {},
                required: undefined,
            },
        });
    });

    it('getMcpTools caches the result', () => {
        const firstCall = getMcpTools();
        const secondCall = getMcpTools();

        expect(firstCall).toBe(secondCall); // Exact same reference
    });
});
