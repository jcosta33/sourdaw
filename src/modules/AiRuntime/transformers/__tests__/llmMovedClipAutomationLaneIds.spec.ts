import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextAutomationLane } from '../../models/ProjectContext';
import { type RuntimeAction } from '../../models/RuntimeAction';
import {
    getMovedClipAutomationLaneIds,
    movedClipAutomationLaneIdsByActionType,
    noMovedAutomationLanes,
} from '../llmMovedClipAutomationLaneIds';

function lane(id: string, clipId: string): ProjectContextAutomationLane {
    return { id, trackId: 'track-1', clipId, parameterId: 'gain', name: id, enabled: true, minValue: 0, maxValue: 1 };
}

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 4,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 4,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 1,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
    automationLanes: [lane('lane-a', 'clip-a'), lane('lane-b', 'clip-b'), lane('lane-c', 'clip-c')],
};

function parseAction(json: string): RuntimeAction {
    const action: RuntimeAction = JSON.parse(json);
    return action;
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

    it('lists exactly the action types whose entry reads a payload', () => {
        const listed = Object.entries(movedClipAutomationLaneIdsByActionType).filter(
            ([, reader]) => reader !== noMovedAutomationLanes
        );
        const types = listed.map(([type]) => type).sort();

        expect(types).toEqual(['moveClip', 'moveClips']);
    });
});
