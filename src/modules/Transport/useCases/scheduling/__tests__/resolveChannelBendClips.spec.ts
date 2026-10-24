import { describe, expect, it } from 'vitest';

import { type Clip } from '#/modules/Arrangement/stores';

import { resolveChannelBendClips } from '../resolveChannelBendClips';

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

const bends = [{ id: 'pb-1', value: 8_191, beat: 1, channel: 0 }];
const rpn = [{ id: 'cc-1', controller: 101, value: 0, beat: 0, channel: 0 }];

describe('resolveChannelBendClips', () => {
    // A clip split, copied, duplicated or pasted from a controller-only one has rows and no note list, and the
    // caller holds no note lists at all: a clip is admitted by its stored bend alone.
    it('admits a MIDI clip by its stored bend with the controllers that say how deep it is', () => {
        const clips = resolveChannelBendClips({
            trackId: TRACK_ID,
            clips: [midiClip()],
            ccByClipId: { 'clip-1': rpn },
            pitchBendByClipId: { 'clip-1': bends },
        });

        expect(clips).toHaveLength(1);
        expect(clips[0]?.pitchBends).toEqual(bends);
        expect(clips[0]?.controlChanges).toEqual(rpn);
    });

    it('admits a clip with a bend and no controllers, whose depth is the default', () => {
        const clips = resolveChannelBendClips({
            trackId: TRACK_ID,
            clips: [midiClip()],
            ccByClipId: {},
            pitchBendByClipId: { 'clip-1': bends },
        });

        expect(clips[0]?.controlChanges).toEqual([]);
    });

    it('skips a clip that stores no bend, whatever controllers it stores', () => {
        const clips = resolveChannelBendClips({
            trackId: TRACK_ID,
            clips: [midiClip()],
            ccByClipId: { 'clip-1': rpn },
            pitchBendByClipId: { 'clip-1': [] },
        });

        expect(clips).toEqual([]);
    });

    it('skips a muted clip whatever it stores', () => {
        const clips = resolveChannelBendClips({
            trackId: TRACK_ID,
            clips: [midiClip({ muted: true })],
            ccByClipId: {},
            pitchBendByClipId: { 'clip-1': bends },
        });

        expect(clips).toEqual([]);
    });

    it('skips a clip that is not a MIDI clip', () => {
        const clips = resolveChannelBendClips({
            trackId: TRACK_ID,
            clips: [midiClip({ type: 'audio' })],
            ccByClipId: {},
            pitchBendByClipId: { 'clip-1': bends },
        });

        expect(clips).toEqual([]);
    });
});
