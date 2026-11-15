import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction } from '../../models/RuntimeAction';
import { getMovedClipAutomationLaneIds } from '../llmMovedClipAutomationLaneIds';

const context = {
    automationLanes: [
        { id: 'lane-a', clipId: 'clip-a' },
        { id: 'lane-b', clipId: 'clip-b' },
        { id: 'lane-c', clipId: 'clip-c' },
    ],
    tracks: [],
} as unknown as ProjectContext;

function parseAction(json: string): RuntimeAction {
    return JSON.parse(json) as RuntimeAction;
}

describe('getMovedClipAutomationLaneIds', () => {
    it('reads the lanes of the one moved clip', () => {
        const action = parseAction('{"type":"moveClip","payload":{"clipId":"clip-b"}}');
        expect(getMovedClipAutomationLaneIds(action, context)).toEqual(['lane-b']);
    });

    it('reads the lanes of every moved clip in a batch move, in move order', () => {
        const action = parseAction(
            '{"type":"moveClips","payload":{"moves":[{"clipId":"clip-c"},{"clipId":"clip-a"}]}}'
        );
        expect(getMovedClipAutomationLaneIds(action, context)).toEqual(['lane-c', 'lane-a']);
    });

    it('answers no lanes for an unlisted action type', () => {
        expect(getMovedClipAutomationLaneIds({ type: 'toggleSidebar' }, context)).toEqual([]);
    });

    it('answers no lanes for an inherited object member parsed from JSON', () => {
        expect(getMovedClipAutomationLaneIds(parseAction('{"type":"constructor","payload":{}}'), context)).toEqual([]);
    });
});
