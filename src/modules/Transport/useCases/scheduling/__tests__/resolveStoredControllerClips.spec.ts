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

describe('resolveStoredControllerClips', () => {
    it('admits a clip whose note list is empty, as a controller-only recorded take commits it', () => {
        const clips = resolveStoredControllerClips({
            trackId: TRACK_ID,
            clips: [midiClip()],
            notesByClipId: { 'clip-1': [] },
            ccByClipId: { 'clip-1': pedal },
        });

        expect(clips).toHaveLength(1);
        expect(clips[0]?.controlChanges).toEqual(pedal);
    });

    it('skips a clip with no note list at all, so only a committed take carries its controllers', () => {
        const clips = resolveStoredControllerClips({
            trackId: TRACK_ID,
            clips: [midiClip()],
            notesByClipId: {},
            ccByClipId: { 'clip-1': pedal },
        });

        expect(clips).toEqual([]);
    });

    it('skips a clip that has a note list and no controllers', () => {
        const clips = resolveStoredControllerClips({
            trackId: TRACK_ID,
            clips: [midiClip()],
            notesByClipId: { 'clip-1': [] },
            ccByClipId: {},
        });

        expect(clips).toEqual([]);
    });

    it('skips a muted clip whatever it stores', () => {
        const clips = resolveStoredControllerClips({
            trackId: TRACK_ID,
            clips: [midiClip({ muted: true })],
            notesByClipId: { 'clip-1': [] },
            ccByClipId: { 'clip-1': pedal },
        });

        expect(clips).toEqual([]);
    });
});
