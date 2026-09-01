import { describe, it, expect } from 'vitest';

import { parseToolPlanningOutcome } from '../toolCallParser';

const MALFORMED_OUTCOME = { status: 'rejected', reason: 'Model returned a malformed tool-call batch.' };
const EMPTY_REASON = 'Model returned an empty tool-planning response.';
const NON_TOOL_REASON = 'Model returned a non-tool response instead of a complete tool-call batch.';
const LIST_TRACKS_CALL = { name: 'listTracks', arguments: {} };
const ANNOTATION_CALL = { name: 'annotate', arguments: { text: '{"name":1,"name":2}' } };

describe('toolCallParser', () => {
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
