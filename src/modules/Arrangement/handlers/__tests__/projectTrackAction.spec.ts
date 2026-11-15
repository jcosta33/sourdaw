import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { createTrack, type Track } from '../../models/Track';
import { projectTrackAction, trackProjectionByActionType } from '../projectTrackAction';

const base: Track = {
    ...createTrack({ id: 't', kind: 'midi', name: 'T' }),
    sends: [{ busId: 'bus', level: 0.5, preFader: false }],
};

function project(actions: readonly AppAction[]): Track {
    const track = structuredClone(base);
    for (const action of actions) {
        projectTrackAction(track, action);
    }
    return track;
}

describe('projectTrackAction', () => {
    it('marks the projected track for exactly these actions', () => {
        const keep = trackProjectionByActionType.selectTrack;
        const markingEntries = Object.entries(trackProjectionByActionType).filter(([, entry]) => entry !== keep);
        const marking = markingEntries.map(([type]) => type).sort();
        expect(marking).toEqual(
            [
                'discardDuplicatedClip',
                'setTrackGain',
                'renameTrack',
                'setTrackColor',
                'setTrackPan',
                'setAutomationMode',
                'muteTrack',
                'soloTrack',
                'setTrackOutput',
                'addSend',
                'setSend',
                'setClipGain',
                'removeSend',
            ].sort()
        );
    });

    it('projects each plain track field from its action', () => {
        const track = project([
            { type: 'renameTrack', payload: { trackId: 't', name: 'Lead' } },
            { type: 'setTrackColor', payload: { trackId: 't', color: '#123456' } },
            { type: 'setTrackPan', payload: { trackId: 't', pan: -0.25, expectedPan: 0 } },
            { type: 'setAutomationMode', payload: { trackId: 't', mode: 'write' } },
            { type: 'muteTrack', payload: { trackId: 't', muted: true, expectedMuted: false } },
            { type: 'soloTrack', payload: { trackId: 't', soloed: true } },
            { type: 'setTrackOutput', payload: { trackId: 't', outputId: 'out' } },
        ]);
        expect(track).toMatchObject({
            name: 'Lead',
            color: '#123456',
            pan: -0.25,
            automationMode: 'write',
            muted: true,
            soloed: true,
            outputId: 'out',
        });
    });

    it('adds, adjusts and removes a send', () => {
        const added = project([
            { type: 'addSend', payload: { trackId: 't', busId: 'b2', level: 0.3, preFader: true } },
        ]);
        expect(added.sends).toEqual([
            { busId: 'bus', level: 0.5, preFader: false },
            { busId: 'b2', level: 0.3, preFader: true },
        ]);
        const adjusted = project([{ type: 'setSend', payload: { trackId: 't', busId: 'bus', level: 0.9 } }]);
        expect(adjusted.sends[0]?.level).toBe(0.9);
        const removed = project([{ type: 'removeSend', payload: { trackId: 't', busId: 'bus' } }]);
        expect(removed.sends).toEqual([]);
    });

    it('sets a track gain and leaves an unrelated action alone', () => {
        expect(
            project([{ type: 'setTrackGain', payload: { trackId: 't', gain: 0.4, expectedGain: 0.8 } }]).gain
        ).toBeCloseTo(0.4);
        const untouched = project([{ type: 'selectTrack', payload: { trackId: 't' } }]);
        expect(untouched).toEqual(project([]));
    });
});
