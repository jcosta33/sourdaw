import { describe, expect, it } from 'vitest';

import { type Clip } from '#/modules/Arrangement/stores';

import { resolveStoredControllerClips } from '../resolveStoredControllerClips';

const TRACK_ID = 'track-1';

function midiClip(overrides: Record<string, unknown> = {}): Clip {
    return {
        id: 'clip-1',
        type: 'midi',
        muted: false,
        startBeat: 0,
        endBeat: 4,
        gain: 1,
        loopEnabled: false,
        ...overrides,
    } as Clip;
}

const pedal = [{ id: 'cc-1', controller: 64, value: 127, beat: 1, channel: 0 }];

const selectedSource = {
    sourceClipId: 'clip-1',
    sourceEntryBeat: 5,
    sourceEndBeat: 9,
    phaseHeadBeat: 0,
    passLengthBeats: 4,
    rows: {
        notes: { present: true, value: [] },
        controlChanges: {
            present: true,
            value: [{ id: 'selected-pedal', controller: 64, value: 127, beat: 5.25, channel: 0 }],
        },
        pitchBends: { present: true, value: [] },
    },
};

describe('resolveStoredControllerClips', () => {
    it('chases selected frozen controllers from the original pass across a left edit and ignores ordinary rows', () => {
        const clips = resolveStoredControllerClips({
            trackId: TRACK_ID,
            clips: [midiClip({ startBeat: 1, endBeat: 8, midiTakeSource: selectedSource })],
            ccByClipId: { 'clip-1': pedal },
        });

        expect(clips).toHaveLength(2);
        expect(clips.map(({ controlChanges }) => controlChanges.map(({ id }) => id))).toEqual([
            ['selected-pedal'],
            ['selected-pedal'],
        ]);
        expect(clips.map(({ clip }) => clip.startBeat)).toEqual([1, 4]);
        expect(clips.map(({ controlChanges }) => controlChanges[0]?.beat)).toEqual([1, 4.25]);
    });
    // The caller holds no note lists: a clip split, copied, duplicated or pasted
    // from a controller-only clip has controller rows and no note list, and a
    // recorded controller-only take has none either.
    it('admits a MIDI clip by its stored controllers, whether or not it has a note list', () => {
        const clips = resolveStoredControllerClips({
            trackId: TRACK_ID,
            clips: [midiClip()],
            ccByClipId: { 'clip-1': pedal },
        });

        expect(clips).toHaveLength(1);
        expect(clips[0]?.controlChanges).toEqual(pedal);
    });

    it('skips a clip that stores no controllers', () => {
        const clips = resolveStoredControllerClips({
            trackId: TRACK_ID,
            clips: [midiClip()],
            ccByClipId: {},
        });

        expect(clips).toEqual([]);
    });

    it('skips a muted clip whatever it stores', () => {
        const clips = resolveStoredControllerClips({
            trackId: TRACK_ID,
            clips: [midiClip({ muted: true })],
            ccByClipId: { 'clip-1': pedal },
        });

        expect(clips).toEqual([]);
    });

    it('skips a clip that is not a MIDI clip', () => {
        const clips = resolveStoredControllerClips({
            trackId: TRACK_ID,
            clips: [midiClip({ type: 'audio' })],
            ccByClipId: { 'clip-1': pedal },
        });

        expect(clips).toEqual([]);
    });
});
