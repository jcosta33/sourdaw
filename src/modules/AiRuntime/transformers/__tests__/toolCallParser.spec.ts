import { describe, it, expect } from 'vitest';

import { parseToolCallXml } from '../toolCallParser';

describe('toolCallParser', () => {
    it('parses valid JSON array directly', () => {
        const input = `[{"name": "addTrack", "arguments": {"name": "Vocals", "kind": "audio"}}]`;
        const result = parseToolCallXml(input);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            name: 'addTrack',
            arguments: { name: 'Vocals', kind: 'audio' },
        });
    });

    it('parses wrapped JSON mode {"actions": [...]}', () => {
        const input = `{"actions": [{"name": "muteTrack", "arguments": {"trackId": "t1"}}]}`;
        const result = parseToolCallXml(input);

        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe('muteTrack');
    });

    it('parses wrapped JSON mode {"tool_calls": [...]}', () => {
        const input = `{"tool_calls": [{"name": "soloTrack", "arguments": {"trackId": "t2"}}]}`;
        const result = parseToolCallXml(input);

        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe('soloTrack');
    });

    it('parses single tool call object', () => {
        const input = `{"name": "addDevice", "arguments": {"deviceType": "EQ"}}`;
        const result = parseToolCallXml(input);

        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe('addDevice');
    });

    it('parses JSON buried in markdown fences', () => {
        const input = `
Some text here
\`\`\`json
[{"name": "test", "arguments": {}}]
\`\`\`
Some text after
`;
        const result = parseToolCallXml(input);
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe('test');
    });

    it('falls back to XML tag parsing', () => {
        const input = `
<tool_call>
{"name": "addTrack", "arguments": {"name": "T1"}}
</tool_call>
Some thought
<tool_call>
{"name": "addTrack", "arguments": {"name": "T2"}}
</tool_call>
`;
        const result = parseToolCallXml(input);
        expect(result).toHaveLength(2);
        expect(result[0]!.arguments).toEqual({ name: 'T1' });
        expect(result[1]!.arguments).toEqual({ name: 'T2' });
    });

    it('falls back to Llama function XML tags', () => {
        const input = `
<function>{"name": "addTrack", "parameters": {"name": "T1"}}</function>
`;
        const result = parseToolCallXml(input);
        expect(result).toHaveLength(1);
        expect(result[0]!.arguments).toEqual({ name: 'T1' });
    });

    it('returns empty array for completely invalid input', () => {
        const input = `Just a normal conversation with no JSON or XML`;
        const result = parseToolCallXml(input);
        expect(result).toEqual([]);
    });
});
