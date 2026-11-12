import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { projectRelinkAudioSourceTracks } from '../projectRelinkAudioSourceTracks';

const clip = ClipDummy.create({ id: 'clip', trackId: 'track', audioBufferId: 'missing' });
const track = TrackDummy.create({ id: 'track', clips: [clip] });
const restore: Extract<AppAction, { type: 'restoreClip' }> = {
    type: 'restoreClip',
    payload: {
        clipId: 'clip',
        trackId: 'track',
        clipSnapshot: clip,
        clipIndex: 0,
        ripplePlan: null,
        retiredTakeLanes: [],
        midiNotesSnapshot: null,
        midiCcSnapshot: null,
        midiPitchBendSnapshot: null,
    },
};
function relink(before: string, after: string | undefined): AppAction {
    const next: { audioBufferId?: string } = {};
    if (after !== undefined) {
        next.audioBufferId = after;
    }
    return {
        type: 'relinkClipAudioSources',
        payload: {
            targets: [
                {
                    trackId: track.id,
                    trackKind: track.kind,
                    activeAlternativeId: track.activeAlternativeId,
                    alternativeId: null,
                    clipId: clip.id,
                    before: { audioBufferId: before },
                    after: next,
                },
            ],
        },
    };
}

describe('relink source and owner prefix projection', () => {
    it('restores a complete source before a later source write without mutating the starting projection', () => {
        const initial = { ...track, clips: [] };
        const actions = [restore, relink('missing', 'replacement')];
        expect(projectRelinkAudioSourceTracks([initial], actions)?.[0]?.clips[0]).toEqual({
            ...clip,
            audioBufferId: 'replacement',
        });
        expect(initial.clips).toEqual([]);
        expect(restore.payload.clipSnapshot).toBe(clip);
        expect(clip.audioBufferId).toBe('missing');
    });

    it('preserves omitted source pointers across repeated endpoints', () => {
        const result = projectRelinkAudioSourceTracks(
            [track],
            [relink('missing', 'middle'), relink('middle', undefined)]
        );
        expect(result?.[0]?.clips[0]).not.toHaveProperty('audioBufferId');
        expect(track.clips[0]?.audioBufferId).toBe('missing');
    });

    it('excludes the stored active alternative snapshot while projecting inactive aliases', () => {
        const initial = {
            ...track,
            activeAlternativeId: 'active',
            alternatives: [
                { id: 'active', name: 'Active', clips: [{ ...clip, locked: true }] },
                { id: 'inactive', name: 'Inactive', clips: [{ ...clip, id: 'inactive-clip' }] },
            ],
        };
        const action = relink('missing', 'replacement');
        if (action.type !== 'relinkClipAudioSources') {
            throw new Error('Expected the relink fixture');
        }
        const target = action.payload.targets[0]!;
        const result = projectRelinkAudioSourceTracks(
            [initial],
            [
                {
                    ...action,
                    payload: {
                        targets: [
                            { ...target, activeAlternativeId: 'active' },
                            {
                                ...target,
                                activeAlternativeId: 'active',
                                alternativeId: 'inactive',
                                clipId: 'inactive-clip',
                            },
                        ],
                    },
                },
            ]
        );
        expect(result?.[0]?.clips[0]?.audioBufferId).toBe('replacement');
        expect(result?.[0]?.alternatives[1]?.clips[0]?.audioBufferId).toBe('replacement');
        expect(result?.[0]?.alternatives[0]).toBe(initial.alternatives[0]);
        expect(initial.alternatives[1]?.clips[0]?.audioBufferId).toBe('missing');
    });

    it('does not project a restoration over another current clip owner', () => {
        const foreign = TrackDummy.create({ id: 'other', clips: [{ ...clip, trackId: 'other' }] });
        expect(projectRelinkAudioSourceTracks([{ ...track, clips: [] }, foreign], [restore])).toBeNull();
    });
});
