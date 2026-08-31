import { describe, expect, it } from 'vitest';

import { type ToolSchema } from '../../../../models/ToolDefinitions';
import { buildWireToolNameCodec } from '../buildWireToolNameCodec';

function schema(name: string): ToolSchema {
    return {
        type: 'function',
        function: {
            name,
            description: name,
            parameters: { type: 'object', properties: {}, required: [] },
        },
    };
}

const dottedNames = [
    'project.query',
    'project.resolve',
    'agent.capabilities',
    'agent.catalog.discover',
    'command.batch.propose',
    'command.history',
    'render.request',
    'analysis.request',
] as const;

describe('buildWireToolNameCodec', () => {
    it('round-trips every dotted name back to the internal identity', () => {
        const codec = buildWireToolNameCodec(dottedNames.map(schema));
        for (const name of dottedNames) {
            expect(codec.decode(codec.encode(name))).toBe(name);
        }
    });

    it('falls back to the raw wire name when it is not in the sent schemas', () => {
        const codec = buildWireToolNameCodec([schema('project.query')]);
        expect(codec.decode('hallucinated_tool')).toBe('hallucinated_tool');
    });

    it('throws when two internal names collide onto one wire name', () => {
        expect(() => buildWireToolNameCodec([schema('a.b'), schema('a_b')])).toThrow(
            "Tool names 'a.b' and 'a_b' collide onto wire name 'a_b'"
        );
    });
});
