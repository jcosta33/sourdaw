import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { captureTrackClipStates } from '../captureTrackClipStates';

function createMidiNote(id: string, pitch: number) {
    return { id, pitch, startBeat: 0, duration: 1, velocity: 100 };
}

function createMidiControlChange(id: string, value: number) {
    return { id, controller: 1, value, beat: 0, channel: 0 };
}

function createMidiPitchBend(id: string, value: number) {
    return { id, value, beat: 0, channel: 0 };
}

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    midiStoreValue: { value: null } as any,
}));

vi.mock('../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
    },
}));

describe('captureTrackClipStates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = null;
    });

    it('returns an empty array when the track store is unavailable', () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        expect(captureTrackClipStates(['t1'])).toEqual([]);
    });

    it('skips track ids that do not exist in the live store', () => {
        const track = TrackDummy.create({ id: 't1', clips: [] });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

        expect(captureTrackClipStates(['t1', 'missing'])).toEqual([
            {
                trackId: 't1',
                clips: [],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
        ]);
    });

    it('captures every named track, including its clips and MIDI satellites, keyed by clip id', () => {
        const clipC1 = ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' });
        const clipC2 = ClipDummy.create({ id: 'c2', trackId: 't2', type: 'midi' });
        const trackOne = TrackDummy.create({ id: 't1', clips: [clipC1] });
        const trackTwo = TrackDummy.create({ id: 't2', clips: [clipC2] });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [trackOne, trackTwo] });

        const noteC1 = createMidiNote('note-c1', 60);
        const noteC2 = createMidiNote('note-c2', 61);
        const ccC1 = createMidiControlChange('cc-c1', 10);
        const pitchBendC1 = createMidiPitchBend('pitch-bend-c1', 0);
        const unrelatedNote = createMidiNote('note-unrelated', 64);
        mocks.midiStoreValue.value = {
            notesByClipId: { c1: [noteC1], c2: [noteC2], unrelated: [unrelatedNote] },
            ccByClipId: { c1: [ccC1] },
            pitchBendByClipId: { c1: [pitchBendC1] },
        };

        const snapshots = captureTrackClipStates(['t1', 't2']);

        expect(snapshots).toEqual([
            {
                trackId: 't1',
                clips: [clipC1],
                midiNotesByClipId: { c1: [noteC1] },
                midiCcByClipId: { c1: [ccC1] },
                midiPitchBendByClipId: { c1: [pitchBendC1] },
            },
            {
                trackId: 't2',
                clips: [clipC2],
                midiNotesByClipId: { c2: [noteC2] },
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
        ]);
    });

    it('includes MIDI satellites owned by a hidden alternative lane, not just the active clips', () => {
        const activeClip = ClipDummy.create({ id: 'active', trackId: 't1', type: 'midi' });
        const hiddenClip = ClipDummy.create({ id: 'hidden', trackId: 't1', type: 'midi' });
        const track = TrackDummy.create({
            id: 't1',
            clips: [activeClip],
            alternatives: [{ id: 'alt-hidden', name: 'Hidden', clips: [hiddenClip] }],
        });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

        const hiddenNote = createMidiNote('note-hidden', 62);
        mocks.midiStoreValue.value = {
            notesByClipId: { hidden: [hiddenNote] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        const [snapshot] = captureTrackClipStates(['t1']);

        expect(snapshot?.clips).toEqual([activeClip]);
        expect(snapshot?.midiNotesByClipId).toEqual({ hidden: [hiddenNote] });
    });

    it('returns deep clones: mutating the result never reaches back into the live stores', () => {
        const clip = ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' });
        const track = TrackDummy.create({ id: 't1', clips: [clip] });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

        const note = createMidiNote('note-c1', 60);
        mocks.midiStoreValue.value = {
            notesByClipId: { c1: [note] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        const [snapshot] = captureTrackClipStates(['t1']);
        if (!snapshot) {
            throw new Error('expected a snapshot');
        }

        expect(snapshot.clips[0]).not.toBe(clip);
        expect(snapshot.midiNotesByClipId.c1?.[0]).not.toBe(note);

        // Mutate the SOURCE rather than the snapshot: a snapshot that still tracks the
        // live objects would change with them, and driving it from this direction needs
        // no cast past the contract's deliberately narrow snapshot types.
        const captured = JSON.stringify(snapshot);
        clip.name = 'mutated';
        note.pitch = 999;

        expect(JSON.stringify(snapshot)).toBe(captured);
    });
});
