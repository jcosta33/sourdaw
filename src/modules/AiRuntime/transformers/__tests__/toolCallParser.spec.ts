import { describe, it, expect } from 'vitest';

import { parseToolCallXml, parseToolPlanningOutcome } from '../toolCallParser';

const MALFORMED_OUTCOME = { status: 'rejected', reason: 'Model returned a malformed tool-call batch.' };
const EMPTY_REASON = 'Model returned an empty tool-planning response.';
const NON_TOOL_REASON = 'Model returned a non-tool response instead of a complete tool-call batch.';
const LIST_TRACKS_CALL = { name: 'listTracks', arguments: {} };
const ANNOTATION_CALL = { name: 'annotate', arguments: { text: '{"name":1,"name":2}' } };

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
        '{"actions":[],"actions":[{"name":"muteTrack"}]}',
        '{"name":"muteTrack","name":"soloTrack"}',
        '{"name":"muteTrack","arguments":{},"arguments":{"trackId":"t1"}}',
        '{"name":"muteTrack","parameters":{},"parameters":{"trackId":"t1"}}',
        '{"name":"muteTrack","arguments":{"trackId":"t1","trackId":"t2"}}',
        '{"name":"muteTrack","arguments":{"routing":[{"gain":1,"gain":2}]}}',
        '{"name":"muteTrack","arguments":{"na\\u006de":1,"name":2}}',
        '```json\n{"name":"muteTrack","name":"soloTrack"}\n```',
        '<tool_call>{"name":"muteTrack","arguments":{},"arguments":{"trackId":"t1"}}</tool_call>',
        '{"name":"muteTrack"}\n{"name":"soloTrack","arguments":{"trackId":"t1","trackId":"t2"}}',
        '[{"name":"muteTrack","arguments":[]}]',
        '{"actions":[{"name":"muteTrack","arguments":"{}"}]}',
        '<tool_call>{"name":"muteTrack","arguments":7}</tool_call>',
        '<function>{"name":"muteTrack","parameters":[]}</function>',
        '{"name":"muteTrack","arguments":null}',
        '<function>{"name":"muteTrack","parameters":null}</function>',
        '[{"name":"muteTrack","arguments":{',
        '<tool_call>{"name":"muteTrack"}',
    ])('rejects malformed or ambiguous tool-call content: %s', (content) => {
        expect(parseToolPlanningOutcome(content)).toEqual(MALFORMED_OUTCOME);
    });

    it.each([
        { content: '{"name":"listTracks"}', toolCalls: [LIST_TRACKS_CALL] },
        { content: '```json\n{"name":"listTracks"}\n```', toolCalls: [LIST_TRACKS_CALL] },
        { content: '<tool_call>{"name":"listTracks"}</tool_call>', toolCalls: [LIST_TRACKS_CALL] },
        { content: '{"name":"listTracks"}\n{"name":"listTracks"}', toolCalls: [LIST_TRACKS_CALL, LIST_TRACKS_CALL] },
        {
            content: '{"name":"annotate","arguments":{"text":"{\\"name\\":1,\\"name\\":2}"}}',
            toolCalls: [ANNOTATION_CALL],
        },
        { content: '[]', toolCalls: [] },
        { content: '{"actions":[]}', toolCalls: [] },
        { content: '```json\n{"tool_calls":[]}\n```', toolCalls: [] },
    ])('accepts one fully consumed $content representation', ({ content, toolCalls }) => {
        expect(parseToolPlanningOutcome(content)).toEqual({ status: 'complete', toolCalls, proposal: null });
    });

    it.each([
        { content: '', expectedReason: EMPTY_REASON },
        { content: 'I cannot change the project.', expectedReason: NON_TOOL_REASON },
    ])('rejects ambiguous planning text: $expectedReason', ({ content, expectedReason }) => {
        expect(parseToolPlanningOutcome(content)).toEqual({ status: 'rejected', reason: expectedReason });
    });
});
