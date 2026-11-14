import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { addActionSourceOwners } from '../addActionSourceOwners';
import { type OwnerFields } from '../addSourceOwner';
import { hasUnprojectedAudioSourceWrite } from '../hasUnprojectedAudioSourceWrite';
import { projectClipReplayPrefix } from '../projectClipReplayPrefix';
import { readTempoScalarTransition } from '../readTempoScalarTransition';

// An action none of the lookups lists: each one must give it its stated default.
const unlisted: AppAction = { type: 'togglePlayback' };
const audioClip = ClipDummy.create({ id: 'audio', trackId: 'track', startBeat: 0, endBeat: 4, type: 'audio' });
const initial = {
    tracks: [TrackDummy.create({ id: 'track', clips: [audioClip] })],
    takeLanes: [],
    automationLanes: [],
    clock: { tempo: 120, changes: [] },
};

describe('batch projection lookups for an unlisted action', () => {
    it('reads no tempo scalar transition', () => {
        expect(readTempoScalarTransition(unlisted)).toBeUndefined();
    });

    it('reads the reverse transition of a tempo edit and refuses one without a change id', () => {
        const edit = (tempoChangeId?: string): AppAction => ({
            type: 'setTempo',
            payload: { bpm: 140, expectedBpm: 120, tempoChangeId },
        });

        expect(readTempoScalarTransition(edit('change'))).toEqual({
            tempoChangeId: 'change',
            expectedBpm: 140,
            bpm: 120,
        });
        expect(readTempoScalarTransition(edit())).toBeNull();
    });

    it('adds no source owners', () => {
        const owners = new Map<string, OwnerFields>();
        const state = projectClipReplayPrefix([], initial)!;

        addActionSourceOwners(owners, unlisted, state, state);

        expect(owners.size).toBe(0);
    });

    it('reports no unprojected audio source write, where a clip trim on the same audio clip reports one', () => {
        const state = projectClipReplayPrefix([], initial)!;
        const trim: AppAction = { type: 'trimClipStart', payload: { clipId: 'audio', newStartBeat: 1 } };

        expect(hasUnprojectedAudioSourceWrite(unlisted, state)).toBe(false);
        expect(hasUnprojectedAudioSourceWrite(trim, state)).toBe(true);
    });

    it('leaves the projected clips as they were', () => {
        const state = projectClipReplayPrefix([unlisted], initial);

        expect(state?.clips.map((owner) => owner.clip.id)).toEqual(['audio']);
    });
});
