import { describe, expect, it } from 'vitest';

import { type AppAction, type ClipAutomationLaneSnapshot, type ClipSplitActionSnapshot } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { projectClipReplayPrefix } from '../projectClipReplayPrefix';

const existingClip = ClipDummy.create({ id: 'existing', trackId: 'track', startBeat: 0, endBeat: 4 });
const automationLane: ClipAutomationLaneSnapshot = {
    id: 'gain-lane',
    trackId: 'track',
    clipId: 'existing',
    parameterId: 'gain',
    parameterName: 'Gain',
    points: [],
    objects: [],
    visible: true,
    enabled: true,
    collapsed: false,
    minValue: 0,
    maxValue: 1,
};
const initial = {
    tracks: [TrackDummy.create({ id: 'track', clips: [existingClip] })],
    takeLanes: [],
    automationLanes: [automationLane],
    clock: { tempo: 120, changes: [] },
};
const geometryOnlyRestore: AppAction = {
    type: 'restoreClip',
    payload: {
        clipId: 'restored',
        trackId: 'track',
        clipSnapshot: { id: 'restored', trackId: 'track', startBeat: 8, endBeat: 12 },
        clipIndex: 1,
        ripplePlan: null,
        midiNotesSnapshot: null,
        midiCcSnapshot: null,
        midiPitchBendSnapshot: null,
        retiredTakeLanes: [],
    },
};

describe('projectClipReplayPrefix source completeness', () => {
    it('restores Source owners and rich tracks at the incoming relative-order position after peer prepend', () => {
        const restored = ClipDummy.create({
            id: 'restored',
            trackId: 'track',
            audioOffsetSeconds: -0.25,
            audioUnwrappedOffsetSeconds: -0.25,
        });
        const action: AppAction = {
            type: 'restoreClip',
            payload: {
                ...geometryOnlyRestore.payload,
                clipSnapshot: restored,
                clipIndex: 2,
                clipOrder: ['a', 'left', 'restored', 'right', 'c'],
            },
        };
        const live = ['peer-x', 'peer-y', 'peer-z', 'a', 'c'].map((id) => ClipDummy.create({ id, trackId: 'track' }));
        const projected = projectClipReplayPrefix([action], {
            ...initial,
            tracks: [TrackDummy.create({ id: 'track', clips: live })],
        });
        const order = ['peer-x', 'peer-y', 'peer-z', 'a', 'restored', 'c'];
        expect(projected?.clips.map((owner) => owner.clip.id)).toEqual(order);
        expect(projected?.tracks?.[0]?.clips.map((clip) => clip.id)).toEqual(order);
        expect(projected?.tracks?.[0]?.clips[4]).toEqual(restored);
    });

    it('refuses the restored Source prefix when surviving captured peers reverse relative order', () => {
        const action: AppAction = {
            type: 'restoreClip',
            payload: {
                ...geometryOnlyRestore.payload,
                clipSnapshot: ClipDummy.create({ id: 'restored', trackId: 'track' }),
                clipIndex: 1,
                clipOrder: ['a', 'restored', 'c'],
            },
        };
        expect(
            projectClipReplayPrefix([action], {
                ...initial,
                tracks: [
                    TrackDummy.create({
                        id: 'track',
                        clips: ['c', 'a'].map((id) => ClipDummy.create({ id, trackId: 'track' })),
                    }),
                ],
            })
        ).toBeNull();
    });

    it('keeps source tracks and replay owners in the same witnessed order after peers prepend', () => {
        const left = { ...existingClip, audioOffsetSeconds: 0 };
        const right = ClipDummy.create({
            id: 'right',
            trackId: 'track',
            startBeat: 4,
            endBeat: 8,
            audioOffsetSeconds: 2,
        });
        const emptyMidi = {
            notes: { present: false, value: [] },
            controlChanges: { present: false, value: [] },
            pitchBends: { present: false, value: [] },
        };
        const expected: ClipSplitActionSnapshot = {
            trackId: 'track',
            leftClip: left,
            rightClip: null,
            rightClipIndex: 1,
            rightClipOrder: ['existing', 'right'],
            sourceMidi: emptyMidi,
            rightMidi: emptyMidi,
        };
        const action: AppAction = {
            type: 'restoreClipSplitState',
            payload: {
                clipId: 'existing',
                rightClipId: 'right',
                expected,
                replacement: { ...expected, rightClip: right },
            },
        };
        const peers = ['peer-one', 'peer-two'].map((id) =>
            ClipDummy.create({ id, trackId: 'track', startBeat: 12, endBeat: 16 })
        );
        const projected = projectClipReplayPrefix([action], {
            ...initial,
            tracks: [TrackDummy.create({ id: 'track', clips: [...peers, left] })],
        });
        const order = ['peer-one', 'peer-two', 'existing', 'right'];
        expect(projected?.clips.map((owner) => owner.clip.id)).toEqual(order);
        expect(projected?.tracks?.[0]?.clips.map((clip) => clip.id)).toEqual(order);
        expect(projected?.tracks?.[0]?.clips[2]).toEqual(left);
        expect(projected?.tracks?.[0]?.clips[3]).toEqual(right);
    });

    it('retains geometry and automation after a geometry-only restore while marking rich tracks incomplete', () => {
        const projected = projectClipReplayPrefix([geometryOnlyRestore], initial);

        expect(
            projected?.clips.map(({ owningTrackId, clip }) => ({
                owningTrackId,
                id: clip.id,
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
            }))
        ).toEqual([
            { owningTrackId: 'track', id: 'existing', startBeat: 0, endBeat: 4 },
            { owningTrackId: 'track', id: 'restored', startBeat: 8, endBeat: 12 },
        ]);
        expect(projected?.lanes).toEqual([automationLane]);
        expect(projected?.tracks).toBeNull();
    });

    it.each([
        { label: 'orphan canonical loop value', fields: { audioLoopStartSeconds: 1 } },
        { label: 'nonfinite optional offset', fields: { audioOffsetBeats: Infinity } },
        { label: 'nonfinite required fade', fields: { fadeInBeats: NaN } },
        { label: 'different clip identity', fields: { id: 'wrong-clip' } },
        { label: 'different track identity', fields: { trackId: 'wrong-track' } },
    ])('does not claim a complete source owner for $label', ({ fields }) => {
        const restore: AppAction = {
            type: 'restoreClip',
            payload: {
                ...geometryOnlyRestore.payload,
                clipSnapshot: ClipDummy.create({
                    id: 'restored',
                    trackId: 'track',
                    startBeat: 8,
                    endBeat: 12,
                    ...fields,
                }),
            },
        };
        const projected = projectClipReplayPrefix([restore], initial);
        expect(projected).not.toBeNull();
        expect(projected?.tracks).toBeNull();
        expect(projected?.lanes).toEqual([automationLane]);
    });

    it('keeps geometry and automation ripple restoration while marking a minimal owner incomplete', () => {
        const shifted = ClipDummy.create({ id: 'shifted', trackId: 'track', startBeat: 8, endBeat: 12 });
        const shiftedLane = {
            ...automationLane,
            id: 'shifted-lane',
            clipId: shifted.id,
            points: [{ id: 'point', beat: 8, value: 0.5, curve: 'linear' as const, tension: 0 }],
        };
        const restore: AppAction = {
            type: 'restoreClip',
            payload: {
                ...geometryOnlyRestore.payload,
                ripplePlan: {
                    removedClips: [geometryOnlyRestore.payload.clipSnapshot],
                    shiftedClips: [{ clipId: shifted.id, origStartBeat: 12, origEndBeat: 16, automationDelta: -4 }],
                    clipSatellites: [],
                    clipAutomationLanes: [],
                },
            },
        };
        const projected = projectClipReplayPrefix([restore], {
            ...initial,
            tracks: [TrackDummy.create({ id: 'track', clips: [existingClip, shifted] })],
            automationLanes: [automationLane, shiftedLane],
        });
        expect(projected?.clips.map(({ clip }) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['existing', 0, 4],
            ['restored', 8, 12],
            ['shifted', 12, 16],
        ]);
        expect(projected?.lanes[1]?.points[0]?.beat).toBe(12);
        expect(projected?.tracks).toBeNull();
    });

    it('keeps rich tracks complete when the restore carries a full clip state', () => {
        const richClip = ClipDummy.create({ id: 'restored', trackId: 'track', startBeat: 8, endBeat: 12 });
        const fullRestore: AppAction = {
            type: 'restoreClip',
            payload: {
                ...geometryOnlyRestore.payload,
                clipSnapshot: richClip,
            },
        };
        const projected = projectClipReplayPrefix([fullRestore], initial);

        expect(projected?.tracks?.[0]?.clips).toEqual([existingClip, richClip]);
        expect(projected?.clips.map(({ clip }) => clip.id)).toEqual(['existing', 'restored']);
        expect(projected?.lanes).toEqual([automationLane]);
    });
});
