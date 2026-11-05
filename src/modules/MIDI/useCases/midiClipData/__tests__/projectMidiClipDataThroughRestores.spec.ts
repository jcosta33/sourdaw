import { beforeEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { midiStore } from '../../../stores/midiStore';
import { projectMidiClipDataThroughRestores } from '../projectMidiClipDataThroughRestores';

const NOTE = { id: 'note-restored', pitch: 64, startBeat: 1, duration: 2, velocity: 100 };
const CC = { id: 'cc-restored', controller: 64, value: 127, beat: 2, channel: 0 };
const BEND = { id: 'bend-restored', value: 512, beat: 1, channel: 0 };

type MidiSnapshots = {
    notes?: (typeof NOTE)[] | null;
    cc?: (typeof CC)[] | null;
    bends?: (typeof BEND)[] | null;
};

function restoreClip(clipId: string, { notes = null, cc = null, bends = null }: MidiSnapshots): AppAction {
    return {
        type: 'restoreClip',
        payload: {
            clipId,
            trackId: 'track-1',
            clipSnapshot: { id: clipId, trackId: 'track-1', startBeat: 0, endBeat: 4 },
            ripplePlan: null,
            midiNotesSnapshot: notes,
            midiCcSnapshot: cc,
            midiPitchBendSnapshot: bends,
            retiredTakeLanes: [],
        },
    };
}

function restoreTrack(ccByClipId: Record<string, (typeof CC)[]>): AppAction {
    return {
        type: 'restoreTrack',
        payload: {
            trackId: 'track-1',
            trackSnapshot: { id: 'track-1' },
            trackName: 'Keys',
            trackKind: 'midi',
            trackGain: 1,
            trackParentId: null,
            trackIndex: 0,
            wasSelected: false,
            routingPatches: [],
            automationLaneSnapshots: [],
            clipSatellites: [],
            midiNotesByClipId: {},
            midiCcByClipId: ccByClipId,
            midiPitchBendByClipId: {},
            takeLaneSnapshots: [],
            sidechainRouteSnapshots: [],
            ownedModulatorSnapshots: [],
            incomingModulationMappingSnapshots: [],
        },
    };
}

describe('projectMidiClipDataThroughRestores', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: { live: [{ ...NOTE, id: 'note-live' }] },
            ccByClipId: { live: [{ ...CC, id: 'cc-live' }] },
            pitchBendByClipId: {},
        });
    });

    it('reads the live buckets when no earlier member restores anything', () => {
        expect(projectMidiClipDataThroughRestores([])).toEqual({
            notesByClipId: { live: [{ ...NOTE, id: 'note-live' }] },
            ccByClipId: { live: [{ ...CC, id: 'cc-live' }] },
            pitchBendByClipId: {},
        });
    });

    it('takes the notes, controllers and bends a prior restoreClip replays for its clip', () => {
        const projected = projectMidiClipDataThroughRestores([
            restoreClip('copy', { notes: [NOTE], cc: [CC], bends: [BEND] }),
        ]);

        expect(projected.notesByClipId.copy).toEqual([NOTE]);
        expect(projected.ccByClipId.copy).toEqual([CC]);
        expect(projected.pitchBendByClipId.copy).toEqual([BEND]);
        expect(projected.ccByClipId.live).toEqual([{ ...CC, id: 'cc-live' }]);
    });

    it('leaves a bucket alone when the restore captured none for it', () => {
        const projected = projectMidiClipDataThroughRestores([restoreClip('live', { bends: [BEND] })]);

        expect(projected.notesByClipId.live).toEqual([{ ...NOTE, id: 'note-live' }]);
        expect(projected.ccByClipId.live).toEqual([{ ...CC, id: 'cc-live' }]);
        expect(projected.pitchBendByClipId.live).toEqual([BEND]);
    });

    it('takes the controllers a prior restoreTrack replays', () => {
        const projected = projectMidiClipDataThroughRestores([restoreTrack({ copy: [CC] })]);

        expect(projected.ccByClipId.copy).toEqual([CC]);
        expect(Object.hasOwn(projected.pitchBendByClipId, 'copy')).toBe(false);
    });

    it('skips a controller snapshot the decoder refuses', () => {
        const malformed = [{ ...CC, controller: Number.NaN }];
        const projected = projectMidiClipDataThroughRestores([restoreClip('copy', { cc: malformed })]);

        expect(Object.hasOwn(projected.ccByClipId, 'copy')).toBe(false);
    });

    it('never writes the projection into the store', () => {
        projectMidiClipDataThroughRestores([restoreClip('copy', { notes: [NOTE], cc: [CC] })]);

        expect(Object.hasOwn(midiStore.value!.notesByClipId, 'copy')).toBe(false);
        expect(Object.hasOwn(midiStore.value!.ccByClipId, 'copy')).toBe(false);
    });
});
