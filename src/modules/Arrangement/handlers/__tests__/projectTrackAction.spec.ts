import { describe, expect, it } from 'vitest';

import { CLIP_MAX_GAIN, dbToGain, gainToDb } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

import { type Clip, createTrack, type Track } from '../../models/Track';
import { projectTrackAction, trackProjectionByActionType } from '../projectTrackAction';

const base: Track = {
    ...createTrack({ id: 't', kind: 'midi', name: 'T' }),
    sends: [{ busId: 'bus', level: 0.5, preFader: false }],
};

function clipAt(id: string, gain: number): Clip {
    return {
        id,
        trackId: 't',
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain,
        color: '#000000',
        locked: false,
        muted: false,
    };
}

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
                'lockClip',
                'muteClip',
                'nudgeClip',
                'removeClip',
                'renameClip',
                'setClipColor',
                'setClipFade',
                'slipClipContent',
                'trimClipEnd',
                'trimClipStart',
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
                'hideTrack',
                'foldTrack',
                'setTrackHeight',
                'zoomTracksVertical',
                'restoreTrackHeights',
                'freezeTrack',
                'unfreezeTrack',
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

    it('projects a freeze and an unfreeze onto the track', () => {
        const frozen = project([{ type: 'freezeTrack', payload: { trackId: 't' } }]);
        expect(frozen.frozen).toBe(true);
        const unfrozen = project([
            { type: 'freezeTrack', payload: { trackId: 't' } },
            { type: 'unfreezeTrack', payload: { trackId: 't' } },
        ]);
        expect(unfrozen.frozen).toBe(false);
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

    it('clamps a projected clip gain to the ceiling and the floor the writer holds', () => {
        const withClip: Track = { ...base, clips: [clipAt('clip-a', 0.5)] };
        const over = structuredClone(withClip);
        projectTrackAction(over, { type: 'setClipGain', payload: { clipId: 'clip-a', gain: 5 } });
        expect(over.clips[0]?.gain).toBe(CLIP_MAX_GAIN);
        const under = structuredClone(withClip);
        projectTrackAction(under, { type: 'setClipGain', payload: { clipId: 'clip-a', gain: -1 } });
        expect(under.clips[0]?.gain).toBe(0);
    });

    it('leaves the track alone when setClipGain names a clip the track does not hold', () => {
        const withClip: Track = { ...base, clips: [clipAt('clip-a', 0.5)] };
        const projected = structuredClone(withClip);
        projectTrackAction(projected, { type: 'setClipGain', payload: { clipId: 'elsewhere', gain: 1.5 } });
        expect(projected).toEqual(withClip);
    });

    it('measures a relative setSend from the send level the track holds', () => {
        const projected = project([{ type: 'setSend', payload: { trackId: 't', busId: 'bus', deltaDb: -6 } }]);
        expect(projected.sends[0]?.level).toBeCloseTo(dbToGain(gainToDb(0.5) - 6), 6);
    });

    it('measures a relative addSend from unity and defaults preFader to post-fader', () => {
        const projected = project([{ type: 'addSend', payload: { trackId: 't', busId: 'b2', deltaDb: -6 } }]);
        expect(projected.sends).toHaveLength(2);
        expect(projected.sends[1]?.busId).toBe('b2');
        expect(projected.sends[1]?.level).toBeCloseTo(dbToGain(-6), 6);
        expect(projected.sends[1]?.preFader).toBe(false);
    });

    it('leaves the sends alone when setSend names a bus the track has no send to', () => {
        const projected = project([{ type: 'setSend', payload: { trackId: 't', busId: 'absent', level: 0.9 } }]);
        expect(projected.sends).toEqual(base.sends);
    });

    it('sets a track gain and leaves an unrelated action alone', () => {
        expect(
            project([{ type: 'setTrackGain', payload: { trackId: 't', gain: 0.4, expectedGain: 0.8 } }]).gain
        ).toBeCloseTo(0.4);
        const untouched = project([{ type: 'selectTrack', payload: { trackId: 't' } }]);
        expect(untouched).toEqual(project([]));
    });

    describe('removeClip', () => {
        const withClips: Track = {
            ...base,
            clips: [
                { ...clipAt('a', 0.8), startBeat: 0, endBeat: 4 },
                { ...clipAt('b', 0.8), startBeat: 4, endBeat: 8 },
                { ...clipAt('c', 0.8), startBeat: 2, endBeat: 3 },
            ],
        };

        function projectRemoval(payload: { clipId: string; ripple?: boolean }): Track {
            const track = structuredClone(withClips);
            projectTrackAction(track, { type: 'removeClip', payload });
            return track;
        }

        function placements(track: Track): [string, number, number][] {
            return track.clips.map((clip) => [clip.id, clip.startBeat, clip.endBeat]);
        }

        it('closes the gap a ripple removal leaves for the clips that start after it', () => {
            expect(placements(projectRemoval({ clipId: 'a', ripple: true }))).toEqual([
                ['b', 0, 4],
                ['c', 2, 3],
            ]);
        });

        it('drops the clip and leaves the others where they are without ripple', () => {
            expect(placements(projectRemoval({ clipId: 'a', ripple: false }))).toEqual([
                ['b', 4, 8],
                ['c', 2, 3],
            ]);
        });

        it('leaves the track alone when it does not hold the clip', () => {
            expect(projectRemoval({ clipId: 'absent', ripple: true })).toEqual(withClips);
        });
    });
});
