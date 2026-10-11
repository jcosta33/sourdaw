import { describe, expect, it } from 'vitest';

import { type AppAction, type MidiClipDataActionSnapshot } from '#/utils/handlerContract';

import { type MidiStoreState } from '../../../stores/midiStore';
import { midiClipSplitStateMatches } from '../midiClipSplitStateMatches';

const absent: MidiClipDataActionSnapshot = {
    notes: { present: false, value: [] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};

function state(notes: MidiStoreState['notesByClipId']): MidiStoreState {
    return {
        probabilitySeed: 1,
        notesByClipId: notes,
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

const note = { id: 'saved-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 };
const cc = { id: 'saved-cc', controller: 64, value: 127, beat: 1, channel: 1 };
const bend = { id: 'saved-bend', value: 200, beat: 1, channel: 1 };
const captured: MidiClipDataActionSnapshot = {
    notes: { present: true, value: [note] },
    controlChanges: { present: true, value: [cc] },
    pitchBends: { present: true, value: [bend] },
};
const emptySource: MidiClipDataActionSnapshot = {
    notes: { present: true, value: [] },
    controlChanges: { present: true, value: [] },
    pitchBends: { present: true, value: [] },
};
const redoInput = {
    sourceClipId: 'source',
    rightClipId: 'right',
    expectedSource: emptySource,
    expectedRight: absent,
    replacementSource: emptySource,
    replacementRight: captured,
};

function restorePeer(snapshot: MidiClipDataActionSnapshot): AppAction {
    return {
        type: 'restoreClip',
        payload: {
            clipId: 'peer',
            trackId: 'track',
            clipSnapshot: { id: 'peer', trackId: 'track', startBeat: 0, endBeat: 4 },
            ripplePlan: null,
            midiNotesSnapshot: snapshot.notes.present ? snapshot.notes.value : null,
            midiCcSnapshot: snapshot.controlChanges.present ? snapshot.controlChanges.value : null,
            midiPitchBendSnapshot: snapshot.pitchBends.present ? snapshot.pitchBends.value : null,
            retiredTakeLanes: [],
        },
    };
}

function restorePeerSplit(snapshot: MidiClipDataActionSnapshot): AppAction {
    const clip = {
        id: 'peer',
        trackId: 'track',
        name: 'Peer',
        startBeat: 0,
        endBeat: 4,
        type: 'midi' as const,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
    };
    const expected = {
        trackId: 'track',
        leftClip: clip,
        rightClip: null,
        rightClipIndex: 1,
        sourceMidi: absent,
        rightMidi: absent,
    };
    return {
        type: 'restoreClipSplitState',
        payload: {
            clipId: 'peer',
            rightClipId: 'peer-right',
            expected,
            replacement: { ...expected, rightClip: { ...clip, id: 'peer-right' }, rightMidi: snapshot },
        },
    };
}

describe('midiClipSplitStateMatches', () => {
    it.each(['notes', 'controlChanges', 'pitchBends'] as const)(
        'rejects a replacement %s identity retained by a live peer or preceding restore',
        (slot) => {
            const snapshot = { ...absent, [slot]: captured[slot] };
            const live: MidiStoreState = {
                ...state({ source: [], peer: [...snapshot.notes.value] }),
                ccByClipId: { source: [], peer: [...snapshot.controlChanges.value] },
                pitchBendByClipId: { source: [], peer: [...snapshot.pitchBends.value] },
            };
            expect(midiClipSplitStateMatches(redoInput, live)).toBe(false);
            const beforePrefix = {
                ...state({ source: [] }),
                ccByClipId: { source: [] },
                pitchBendByClipId: { source: [] },
            };
            expect(midiClipSplitStateMatches(redoInput, beforePrefix, [restorePeer(snapshot)])).toBe(false);
            expect(midiClipSplitStateMatches(redoInput, beforePrefix, [restorePeerSplit(snapshot)])).toBe(false);
            expect(
                midiClipSplitStateMatches(redoInput, live, [{ type: 'removeClip', payload: { clipId: 'peer' } }])
            ).toBe(true);
        }
    );

    it('preserves both valid owner legs and unrelated peer rows across identity moves', () => {
        const peerNote = { ...note, id: 'independent-peer' };
        const live: MidiStoreState = {
            ...state({ source: [note], peer: [peerNote] }),
            ccByClipId: { source: [cc] },
            pitchBendByClipId: { source: [bend] },
        };
        const before = structuredClone(live);
        expect(midiClipSplitStateMatches({ ...redoInput, expectedSource: captured }, live)).toBe(true);
        const splitState = {
            ...state({ source: [], right: [note], peer: [peerNote] }),
            ccByClipId: { source: [], right: [cc] },
            pitchBendByClipId: { source: [], right: [bend] },
        };
        expect(
            midiClipSplitStateMatches(
                { ...redoInput, expectedRight: captured, replacementSource: captured, replacementRight: absent },
                splitState
            )
        ).toBe(true);
        expect(live).toEqual(before);
    });

    it('rejects duplicate replacement identities across affected buckets and MIDI row kinds', () => {
        const live = { ...state({ source: [] }), ccByClipId: { source: [] }, pitchBendByClipId: { source: [] } };
        expect(midiClipSplitStateMatches({ ...redoInput, replacementSource: captured }, live)).toBe(false);
        const duplicate = { ...captured, controlChanges: { present: true, value: [{ ...cc, id: note.id }] } };
        expect(midiClipSplitStateMatches({ ...redoInput, replacementRight: duplicate }, live)).toBe(false);
        const crossKindPeer = {
            ...live,
            pitchBendByClipId: { ...live.pitchBendByClipId, peer: [{ ...bend, id: note.id }] },
        };
        expect(midiClipSplitStateMatches(redoInput, crossKindPeer)).toBe(false);
    });

    it('accepts matching note objects rebuilt with different key insertion order', () => {
        const capturedNote = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        const rebuiltNote = { velocity: 100, duration: 1, startBeat: 0, pitch: 60, id: 'note-1' };
        const source: MidiClipDataActionSnapshot = {
            ...absent,
            notes: { present: true, value: [capturedNote] },
        };

        expect(
            midiClipSplitStateMatches(
                {
                    sourceClipId: 'source',
                    rightClipId: 'right',
                    expectedSource: source,
                    expectedRight: absent,
                    replacementSource: source,
                    replacementRight: absent,
                },
                state({ source: [rebuiltNote] })
            )
        ).toBe(true);
    });

    it('rejects changed values, array order, and present-versus-absent clip data', () => {
        const first = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        const second = { id: 'note-2', pitch: 64, startBeat: 1, duration: 1, velocity: 100 };
        const source: MidiClipDataActionSnapshot = {
            ...absent,
            notes: { present: true, value: [first, second] },
        };
        const input = {
            sourceClipId: 'source',
            rightClipId: 'right',
            expectedSource: source,
            expectedRight: absent,
            replacementSource: source,
            replacementRight: absent,
        };

        expect(midiClipSplitStateMatches(input, state({ source: [{ ...first, pitch: 61 }, second] }))).toBe(false);
        expect(midiClipSplitStateMatches(input, state({ source: [second, first] }))).toBe(false);
        expect(midiClipSplitStateMatches({ ...input, expectedSource: absent }, state({ source: [] }))).toBe(false);
    });
});
