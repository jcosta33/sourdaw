import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { projectSourceTracksThroughAction } from '../projectSourceTracksThroughAction';

const kept = TrackDummy.create({ id: 'kept', kind: 'midi' });
const restored = TrackDummy.create({
    id: 'restored',
    kind: 'midi',
    clips: [ClipDummy.create({ id: 'restored-clip', trackId: 'restored', type: 'midi' })],
});

function restoreTrack(trackId: string): AppAction {
    return {
        type: 'restoreTrack',
        payload: {
            trackId,
            trackSnapshot: restored,
            trackName: restored.name,
            trackKind: restored.kind,
            trackGain: restored.gain,
            trackParentId: null,
            trackIndex: 0,
            wasSelected: false,
            routingPatches: [],
            automationLaneSnapshots: [],
            clipSatellites: [],
            midiNotesByClipId: {},
            midiCcByClipId: {},
            midiPitchBendByClipId: {},
            takeLaneSnapshots: [],
            sidechainRouteSnapshots: [],
            ownedModulatorSnapshots: [],
            incomingModulationMappingSnapshots: [],
        },
    };
}

describe('projectSourceTracksThroughAction', () => {
    it('drops the removed track from the projected list', () => {
        const action = { type: 'removeTrack', payload: { trackId: 'kept' } } satisfies AppAction;

        expect(projectSourceTracksThroughAction(action, [kept, restored])).toEqual([restored]);
    });

    it('appends the snapshot a restored track carries', () => {
        const projected = projectSourceTracksThroughAction(restoreTrack('restored'), [kept]);

        expect(projected?.map((track) => track.id)).toEqual(['kept', 'restored']);
        expect(projected?.[1]?.clips.map((clip) => clip.id)).toEqual(['restored-clip']);
    });

    it('refuses a restore whose snapshot is not the named track', () => {
        expect(projectSourceTracksThroughAction(restoreTrack('other'), [kept])).toBeNull();
    });

    it('refuses a restore whose snapshot is not an object with clips', () => {
        const action = restoreTrack('restored');
        if (action.type !== 'restoreTrack') {
            throw new Error('Expected a restoreTrack fixture');
        }
        action.payload.trackSnapshot = JSON.parse('null');
        expect(projectSourceTracksThroughAction(action, [kept])).toBeNull();

        action.payload.trackSnapshot = JSON.parse('{"id":"restored"}');
        expect(projectSourceTracksThroughAction(action, [kept])).toBeNull();
    });

    it('refuses a restore whose snapshot holds a clip the track sanitizer drops', () => {
        const action = restoreTrack('restored');
        if (action.type !== 'restoreTrack') {
            throw new Error('Expected a restoreTrack fixture');
        }
        const withMalformedClip = { ...restored, clips: [...restored.clips, JSON.parse('null')] };
        action.payload.trackSnapshot = withMalformedClip;

        expect(projectSourceTracksThroughAction(action, [kept])).toBeNull();
    });

    it('keeps the tracks for an action name that is only inherited, read from untrusted JSON', () => {
        const parsed: AppAction = JSON.parse('{"type":"constructor","payload":{}}');

        expect(projectSourceTracksThroughAction(parsed, [kept, restored])).toEqual([kept, restored]);
    });

    it('refuses a restore over a live track with the same id', () => {
        expect(projectSourceTracksThroughAction(restoreTrack('restored'), [restored])).toBeNull();
    });

    it('leaves the tracks of an action outside the track lifecycle as they are', () => {
        const action = { type: 'renameTrack', payload: { trackId: 'kept', name: 'Other' } } satisfies AppAction;

        expect(projectSourceTracksThroughAction(action, [kept, restored])).toEqual([kept, restored]);
    });
});
