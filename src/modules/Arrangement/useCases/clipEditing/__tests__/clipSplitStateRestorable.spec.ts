import { describe, expect, it } from 'vitest';

import { type ClipSplitActionSnapshot, type MidiClipDataActionSnapshot } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { clipSplitStateRestorable } from '../clipSplitStateRestorable';

const emptyMidi: MidiClipDataActionSnapshot = {
    notes: { present: false, value: [] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};

function snapshot(leftClip: ClipSplitActionSnapshot['leftClip']): ClipSplitActionSnapshot {
    return {
        trackId: 'track-1',
        leftClip,
        rightClip: null,
        rightClipIndex: 1,
        sourceMidi: emptyMidi,
        rightMidi: emptyMidi,
    };
}

describe('clipSplitStateRestorable', () => {
    it('accepts a live clip whose object keys were rebuilt in a different order', () => {
        const captured = ClipDummy.create({ id: 'left', trackId: 'track-1' });
        const { audioBufferId, ...leadingFields } = captured;
        const rebuilt = { ...leadingFields, audioBufferId };
        const expected = snapshot(captured);
        const state = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [rebuilt] })],
            selectedTrackId: null,
        };

        expect(
            clipSplitStateRestorable({ clipId: 'left', rightClipId: 'right', expected, replacement: expected }, state)
        ).toBe(true);
    });

    it('rejects a changed value and a present optional key missing from the capture', () => {
        const captured = ClipDummy.create({ id: 'left', trackId: 'track-1' });
        const expected = snapshot(captured);
        const changedState = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [{ ...captured, name: 'Collaborator edit' }] })],
            selectedTrackId: null,
        };
        const presentOptionalState = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [{ ...captured, loopEnabled: undefined }] })],
            selectedTrackId: null,
        };

        expect(
            clipSplitStateRestorable(
                { clipId: 'left', rightClipId: 'right', expected, replacement: expected },
                changedState
            )
        ).toBe(false);
        expect(
            clipSplitStateRestorable(
                { clipId: 'left', rightClipId: 'right', expected, replacement: expected },
                presentOptionalState
            )
        ).toBe(false);
    });
});
