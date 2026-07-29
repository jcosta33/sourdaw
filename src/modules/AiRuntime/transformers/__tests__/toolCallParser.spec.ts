import { describe, it, expect } from 'vitest';

import { parseToolCallXml, parseToolPlanningOutcome } from '../toolCallParser';

const MALFORMED_OUTCOME = { status: 'rejected', reason: 'Model returned a malformed tool-call batch.' };
const EMPTY_REASON = 'Model returned an empty tool-planning response.';
const NON_TOOL_REASON = 'Model returned a non-tool response instead of a complete tool-call batch.';

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

    it('preserves malformed JSON array slots for all-or-nothing bridge rejection', () => {
        const input = `[{"name":"muteTrack","arguments":{"trackId":"t1"}},{"arguments":{}},null]`;

        const result = parseToolCallXml(input);

        expect(result).toEqual([
            { name: 'muteTrack', arguments: { trackId: 't1' } },
            { name: '<invalid>', arguments: {} },
            { name: '<invalid>', arguments: {} },
        ]);
    });

    it('preserves the raw JSON array length so malformed calls count toward the batch cap', () => {
        const input = JSON.stringify(Array.from({ length: 25 }, () => null));

        const result = parseToolCallXml(input);

        expect(result).toHaveLength(25);
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

    it('preserves malformed XML tool-call slots for bridge rejection', () => {
        const input = `
<tool_call>{"name":"muteTrack","arguments":{"trackId":"t1"}}</tool_call>
<tool_call>{"arguments":{}}</tool_call>
`;

        const result = parseToolCallXml(input);

        expect(result).toEqual([
            { name: 'muteTrack', arguments: { trackId: 't1' } },
            { name: '<invalid>', arguments: {} },
        ]);
    });

    it('preserves an unclosed trailing XML call instead of executing a valid prefix', () => {
        const input = `<tool_call>{"name":"muteTrack","arguments":{"trackId":"t1"}}</tool_call>
<tool_call>{"name":"soloTrack","arguments":{`;

        const result = parseToolCallXml(input);

        expect(result).toEqual([
            { name: 'muteTrack', arguments: { trackId: 't1' } },
            { name: '<invalid>', arguments: {} },
        ]);
    });

    it('preserves malformed JSONL candidate slots for bridge rejection', () => {
        const input = `{"name":"muteTrack","arguments":{"trackId":"t1"}}
{"arguments":{}}
{malformed}`;

        const result = parseToolCallXml(input);

        expect(result).toEqual([
            { name: 'muteTrack', arguments: { trackId: 't1' } },
            { name: '<invalid>', arguments: {} },
            { name: '<invalid>', arguments: {} },
        ]);
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

    it.each([
        '```json\n[{"name":"muteTrack","arguments":{"trackId":"t1"}}]\n```\n<tool_call>{"name":"soloTrack","arguments":{',
        '```json\n[{"name":"muteTrack","arguments":{"trackId":"t1"}}]\n```\n<tool_call>{"name":"soloTrack","arguments":{"trackId":"t2"}}</tool_call>',
        '{"actions":[],"tool_calls":[{"name":"muteTrack","arguments":{"trackId":"t1"}}]}',
        '{"actions":[],"tool_calls":[]}',
        '{"actions":[],"tool_calls":"truncated"}',
        '```json\n[]\n```\n<tool_call>{"name":"muteTrack","arguments":{',
        '[]\n{"name":"muteTrack","arguments":{"trackId":"t1"}}',
        'Planning follows:\n[{"name":"muteTrack","arguments":{"trackId":"t1"}}]',
        '<tool_call>{"name":"muteTrack","arguments":{"trackId":"t1"}}</tool_call>\nDone.',
        '<tool_call>{"name":"muteTrack"}</tool_call>\nthinking\n<function>{"name":"soloTrack"}</function>',
        '{"name":"muteTrack"}\nthinking\n{"name":"soloTrack"}',
        '{"name":"muteTrack","arguments":{},"parameters":{}}',
        '<tool_call>{"name":"muteTrack","arguments":{},"parameters":{}}</tool_call>',
        '{"name":"muteTrack","arguments":{},"extra":true}',
        '<tool_call>{"name":"muteTrack","extra":true}</tool_call>',
        '{"name":"muteTrack"}\n{"name":"soloTrack","extra":true}',
        '{"actions":[{"name":"muteTrack"}],"metadata":{}}',
        '```json\n{"tool_calls":[{"name":"muteTrack"}],"metadata":{}}\n```',
    ])('rejects unconsumed or conflicting tool-call content: %s', (content) => {
        expect(parseToolPlanningOutcome(content)).toEqual(MALFORMED_OUTCOME);
    });

    it.each([
        '[{"name":"muteTrack","arguments":[]}]',
        '{"actions":[{"name":"muteTrack","arguments":"{}"}]}',
        '<tool_call>{"name":"muteTrack","arguments":7}</tool_call>',
        '<function>{"name":"muteTrack","parameters":[]}</function>',
        '{"name":"muteTrack","arguments":null}',
        '<function>{"name":"muteTrack","parameters":null}</function>',
    ])('rejects non-object tool arguments: %s', (content) => {
        expect(parseToolPlanningOutcome(content)).toEqual(MALFORMED_OUTCOME);
    });

    it.each([
        { content: '{"name":"listTracks"}', count: 1 },
        { content: '```json\n{"name":"listTracks"}\n```', count: 1 },
        { content: '<tool_call>{"name":"listTracks"}</tool_call>', count: 1 },
        { content: '{"name":"listTracks"}\n{"name":"listTracks"}', count: 2 },
    ])('accepts one fully consumed $content representation', ({ content, count }) => {
        expect(parseToolPlanningOutcome(content)).toEqual({
            status: 'complete',
            toolCalls: Array.from({ length: count }, () => ({ name: 'listTracks', arguments: {} })),
        });
    });

    it.each([
        { content: '', expectedReason: EMPTY_REASON },
        { content: 'I cannot change the project.', expectedReason: NON_TOOL_REASON },
        { content: '[{"name":"muteTrack","arguments":{', expectedReason: MALFORMED_OUTCOME.reason },
        { content: '<tool_call>{"name":"muteTrack"}', expectedReason: MALFORMED_OUTCOME.reason },
    ])('rejects ambiguous planning text: $expectedReason', ({ content, expectedReason }) => {
        expect(parseToolPlanningOutcome(content)).toEqual({ status: 'rejected', reason: expectedReason });
    });

    it.each(['[]', '{"actions":[]}', '```json\n{"tool_calls":[]}\n```'])(
        'accepts an explicitly valid empty tool-call batch: %s',
        (content) => {
            expect(parseToolPlanningOutcome(content)).toEqual({ status: 'complete', toolCalls: [] });
        }
    );
});
