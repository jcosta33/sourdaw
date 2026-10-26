import { describe, expect, it } from 'vitest';

import { type AppAction, type ClipAutomationLaneSnapshot } from '#/utils/handlerContract';

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
            points: [{ id: 'point', beat: 8, value: 0.5, curve: 'linear' as const }],
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
