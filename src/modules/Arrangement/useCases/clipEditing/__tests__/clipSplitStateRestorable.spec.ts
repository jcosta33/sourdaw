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
    it('accepts an absent right clip after an unrelated same-track append', () => {
        const left = ClipDummy.create({ id: 'left', trackId: 'track-1' });
        const right = ClipDummy.create({ id: 'right', trackId: 'track-1' });
        const peer = ClipDummy.create({ id: 'peer', trackId: 'track-1' });
        const expected = snapshot(left);
        const replacement = { ...expected, rightClip: right };
        const state = { tracks: [TrackDummy.create({ id: 'track-1', clips: [left, peer] })] };

        expect(clipSplitStateRestorable({ clipId: 'left', rightClipId: 'right', expected, replacement }, state)).toBe(
            true
        );
    });

    it('authenticates owned fragment order and exact values after unrelated clip reordering', () => {
        const left = ClipDummy.create({ id: 'left', trackId: 'track-1' });
        const right = ClipDummy.create({ id: 'right', trackId: 'track-1' });
        const peer = ClipDummy.create({ id: 'peer', trackId: 'track-1' });
        const expected = { ...snapshot(left), rightClip: right };
        const payload = { clipId: 'left', rightClipId: 'right', expected, replacement: snapshot(left) };
        const atSlot = { tracks: [TrackDummy.create({ id: 'track-1', clips: [left, right, peer] })] };
        const moved = { tracks: [TrackDummy.create({ id: 'track-1', clips: [left, peer, right] })] };
        const reversed = { tracks: [TrackDummy.create({ id: 'track-1', clips: [right, left, peer] })] };
        const edited = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [left, { ...right, name: 'Peer edit' }, peer] })],
        };

        expect(clipSplitStateRestorable(payload, atSlot)).toBe(true);
        expect(clipSplitStateRestorable(payload, moved)).toBe(true);
        expect(clipSplitStateRestorable(payload, reversed)).toBe(false);
        expect(clipSplitStateRestorable(payload, edited)).toBe(false);
    });

    it('accepts an earlier unrelated deletion but refuses an unpaired saved reinsertion slot', () => {
        const left = ClipDummy.create({ id: 'left', trackId: 'track-1' });
        const right = ClipDummy.create({ id: 'right', trackId: 'track-1' });
        const expected = { ...snapshot(left), rightClip: right, rightClipIndex: 2 };
        const state = { tracks: [TrackDummy.create({ id: 'track-1', clips: [left, right] })] };

        expect(
            clipSplitStateRestorable(
                { clipId: 'left', rightClipId: 'right', expected, replacement: snapshot(left) },
                state
            )
        ).toBe(true);
        expect(
            clipSplitStateRestorable(
                { clipId: 'left', rightClipId: 'right', expected, replacement: { ...expected, rightClip: null } },
                state
            )
        ).toBe(true);
        expect(
            clipSplitStateRestorable(
                { clipId: 'left', rightClipId: 'right', expected, replacement: { ...expected, rightClipIndex: 3 } },
                state
            )
        ).toBe(false);
        expect(clipSplitStateRestorable({ clipId: 'left', rightClipId: 'right', expected, replacement: expected }, state)).toBe(
            true
        );
    });

    it('accepts a different in-range insertion slot for a composed split', () => {
        const left = ClipDummy.create({ id: 'left', trackId: 'track-1' });
        const right = ClipDummy.create({ id: 'right', trackId: 'track-1' });
        const peer = ClipDummy.create({ id: 'peer', trackId: 'track-1' });
        const expected = { ...snapshot(left), rightClipIndex: 2 };
        const replacement = { ...expected, rightClip: right, rightClipIndex: 1 };
        const state = { tracks: [TrackDummy.create({ id: 'track-1', clips: [left, peer] })] };

        expect(clipSplitStateRestorable({ clipId: 'left', rightClipId: 'right', expected, replacement }, state)).toBe(
            true
        );
    });

    it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 3])(
        'refuses an invalid replacement insertion slot %s',
        (rightClipIndex) => {
            const left = ClipDummy.create({ id: 'left', trackId: 'track-1' });
            const right = ClipDummy.create({ id: 'right', trackId: 'track-1' });
            const expected = snapshot(left);
            const replacement = { ...expected, rightClip: right, rightClipIndex };
            const state = {
                tracks: [
                    TrackDummy.create({
                        id: 'track-1',
                        clips: [left, ClipDummy.create({ id: 'peer', trackId: 'track-1' })],
                    }),
                ],
            };

            expect(
                clipSplitStateRestorable({ clipId: 'left', rightClipId: 'right', expected, replacement }, state)
            ).toBe(false);
        }
    );

    it('refuses a malformed remembered insertion slot even while the right clip is absent', () => {
        const left = ClipDummy.create({ id: 'left', trackId: 'track-1' });
        const expected = { ...snapshot(left), rightClipIndex: Number.NaN };
        const state = { tracks: [TrackDummy.create({ id: 'track-1', clips: [left] })] };

        expect(
            clipSplitStateRestorable(
                { clipId: 'left', rightClipId: 'right', expected, replacement: snapshot(left) },
                state
            )
        ).toBe(false);
    });

    it.each(['left', 'right'] as const)('refuses a %s identity reused under another project track', (id) => {
        const left = ClipDummy.create({ id: 'left', trackId: 'track-1' });
        const expected = snapshot(left);
        const state = {
            tracks: [
                TrackDummy.create({ id: 'track-1', clips: [left] }),
                TrackDummy.create({ id: 'peer-track', clips: [ClipDummy.create({ id, trackId: 'peer-track' })] }),
            ],
        };
        expect(
            clipSplitStateRestorable({ clipId: 'left', rightClipId: 'right', expected, replacement: expected }, state)
        ).toBe(false);
    });

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
