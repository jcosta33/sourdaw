import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { bridgeMidiToolCall, midiActionNames, midiStrategyRegistry } from '../midiStrategy';

const projectContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 0,
    metronomeEnabled: false,
    metronomeVolume: 0,
    masterGain: 1,
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
    tracks: [
        {
            id: 'track-midi',
            name: 'Midi',
            kind: 'midi',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 2,
            deviceCount: 0,
            devices: [],
            clips: [
                {
                    id: 'clip-midi-a',
                    name: 'Midi A',
                    type: 'midi',
                    startBeat: 0,
                    endBeat: 8,
                    locked: false,
                    muted: false,
                    gain: 1,
                    loopEnabled: false,
                    noteCount: 4,
                },
                {
                    id: 'clip-midi-b',
                    name: 'Midi B',
                    type: 'midi',
                    startBeat: 8,
                    endBeat: 12,
                    locked: false,
                    muted: false,
                    gain: 1,
                    loopEnabled: false,
                    noteCount: 3,
                },
            ],
        },
    ],
};

const foreignCall = { name: 'addMarker', arguments: { beat: 0, name: 'Intro' } };

describe('midiStrategy', () => {
    it('registers exactly the exported midi action names', () => {
        expect(new Set(midiStrategyRegistry.keys())).toEqual(new Set(midiActionNames));
    });

    it('returns null for a name owned by another family', () => {
        expect(bridgeMidiToolCall({ call: foreignCall, context: projectContext, index: 0 })).toBeNull();
    });

    it('addNotes writes well-formed notes into a writable clip window', () => {
        expect(
            bridgeMidiToolCall({
                call: {
                    name: 'addNotes',
                    arguments: { clipId: 'clip-midi-a', notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
                },
                context: projectContext,
                index: 0,
            })
        ).toEqual({
            type: 'addNotes',
            payload: { clipId: 'clip-midi-a', notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
        });
    });

    it('quantizeNotes snaps notes on an unlocked non-empty MIDI clip to a bounded grid', () => {
        expect(
            bridgeMidiToolCall({
                call: { name: 'quantizeNotes', arguments: { clipId: 'clip-midi-a', gridSize: 4 } },
                context: projectContext,
                index: 1,
            })
        ).toEqual({ type: 'quantizeNotes', payload: { clipId: 'clip-midi-a', gridSize: 4 } });
    });

    it('removeShortMidiOverlaps removes overlaps within a bounded duration', () => {
        expect(
            bridgeMidiToolCall({
                call: { name: 'removeShortMidiOverlaps', arguments: { clipId: 'clip-midi-a', maximumOverlapMs: 10 } },
                context: projectContext,
                index: 2,
            })
        ).toEqual({
            type: 'removeShortMidiOverlaps',
            payload: { clipId: 'clip-midi-a', maximumOverlapMs: 10 },
        });
    });

    it('arpeggiate applies the exact application-admitted EX-07 settings', () => {
        expect(
            bridgeMidiToolCall({
                call: {
                    name: 'arpeggiate',
                    arguments: { clipId: 'clip-midi-a', pattern: 'up', rate: 8, octaves: 1, gate: 50 },
                },
                context: projectContext,
                index: 3,
            })
        ).toEqual({
            type: 'arpeggiate',
            payload: { clipId: 'clip-midi-a', pattern: 'up', rate: 8, octaves: 1, gate: 50 },
        });
    });

    it('copyMidiArticulations copies between a distinct same-track pair of editable clips', () => {
        expect(
            bridgeMidiToolCall({
                call: {
                    name: 'copyMidiArticulations',
                    arguments: { sourceClipId: 'clip-midi-a', targetClipId: 'clip-midi-b' },
                },
                context: projectContext,
                index: 4,
            })
        ).toEqual({
            type: 'copyMidiArticulations',
            payload: { sourceClipId: 'clip-midi-a', targetClipId: 'clip-midi-b' },
        });
    });

    it('transposeNotes shifts pitch by a non-zero bounded integer semitone delta', () => {
        expect(
            bridgeMidiToolCall({
                call: { name: 'transposeNotes', arguments: { clipId: 'clip-midi-a', semitones: 3 } },
                context: projectContext,
                index: 5,
            })
        ).toEqual({ type: 'transposeNotes', payload: { clipId: 'clip-midi-a', semitones: 3 } });
    });

    it('retrogradeNotes reverses an unlocked MIDI clip containing at least two notes', () => {
        expect(
            bridgeMidiToolCall({
                call: { name: 'retrogradeNotes', arguments: { clipId: 'clip-midi-a' } },
                context: projectContext,
                index: 6,
            })
        ).toEqual({ type: 'retrogradeNotes', payload: { clipId: 'clip-midi-a' } });
    });

    it('invertNotes mirrors pitch on an unlocked MIDI clip containing at least two notes', () => {
        expect(
            bridgeMidiToolCall({
                call: { name: 'invertNotes', arguments: { clipId: 'clip-midi-b' } },
                context: projectContext,
                index: 7,
            })
        ).toEqual({ type: 'invertNotes', payload: { clipId: 'clip-midi-b' } });
    });

    it('quantizeNoteLengths snaps note durations to a bounded grid', () => {
        expect(
            bridgeMidiToolCall({
                call: { name: 'quantizeNoteLengths', arguments: { clipId: 'clip-midi-a', gridSize: 0.25 } },
                context: projectContext,
                index: 8,
            })
        ).toEqual({ type: 'quantizeNoteLengths', payload: { clipId: 'clip-midi-a', gridSize: 0.25 } });
    });

    it('scaleAllVelocities scales every velocity by a bounded non-unity factor', () => {
        expect(
            bridgeMidiToolCall({
                call: { name: 'scaleAllVelocities', arguments: { clipId: 'clip-midi-a', factor: 2 } },
                context: projectContext,
                index: 9,
            })
        ).toEqual({ type: 'scaleAllVelocities', payload: { clipId: 'clip-midi-a', factor: 2 } });
    });

    it('setAllVelocities sets every velocity to a bounded integer', () => {
        expect(
            bridgeMidiToolCall({
                call: { name: 'setAllVelocities', arguments: { clipId: 'clip-midi-a', velocity: 100 } },
                context: projectContext,
                index: 10,
            })
        ).toEqual({ type: 'setAllVelocities', payload: { clipId: 'clip-midi-a', velocity: 100 } });
    });

    it('addNotes validates against the anchored loop window of a trimmed looped clip', () => {
        // A clip looped at 0 (region media [0, 4)) and start-trimmed to 3:
        // the trim advanced the offset to 3, so the scheduler's window in
        // media coordinates is [offset − advance, …) = [0, 4) — pass one
        // enters at phase 3 and wraps to the region head. The pre-anchor
        // window `[offset, offset + min(4, 5))` = [3, 7) admitted the
        // trimmed-away material the scheduler silently drops and refused the
        // wrapped head it plays.
        const loopedContext: ProjectContext = {
            ...projectContext,
            tracks: [
                {
                    ...projectContext.tracks[0]!,
                    clips: [
                        {
                            id: 'clip-loop-trimmed',
                            name: 'Looped',
                            type: 'midi',
                            startBeat: 3,
                            endBeat: 8,
                            locked: false,
                            muted: false,
                            gain: 1,
                            loopEnabled: true,
                            loopLength: 4,
                            loopOriginBeat: 0,
                            midiOffsetBeats: 3,
                            noteCount: 1,
                        },
                    ],
                },
            ],
        };

        // Media 4.5 sits inside the old window but outside the region: the
        // scheduler would drop it, so validation rejects it.
        expect(
            bridgeMidiToolCall({
                call: {
                    name: 'addNotes',
                    arguments: { clipId: 'clip-loop-trimmed', notes: [{ pitch: 60, startBeat: 4.5, duration: 1 }] },
                },
                context: loopedContext,
                index: 0,
            })
        ).toMatchObject({ name: 'addNotes', reason: expect.stringContaining('falls outside') });

        // Media 0.5 is the wrapped region head the scheduler plays below the
        // old floor: validation admits it.
        expect(
            bridgeMidiToolCall({
                call: {
                    name: 'addNotes',
                    arguments: { clipId: 'clip-loop-trimmed', notes: [{ pitch: 62, startBeat: 0.5, duration: 1 }] },
                },
                context: loopedContext,
                index: 0,
            })
        ).toEqual({
            type: 'addNotes',
            payload: { clipId: 'clip-loop-trimmed', notes: [{ pitch: 62, startBeat: 0.5, duration: 1 }] },
        });
    });

    it('addNotes keeps the pre-anchor window for an unanchored looped clip', () => {
        // Loop on but never anchored: the advance is zero and the window
        // stays `[offset, offset + min(loop, span))` = [0, 4) — the exact
        // pre-anchor behavior.
        const unanchoredContext: ProjectContext = {
            ...projectContext,
            tracks: [
                {
                    ...projectContext.tracks[0]!,
                    clips: [
                        {
                            id: 'clip-loop-unanchored',
                            name: 'Looped',
                            type: 'midi',
                            startBeat: 0,
                            endBeat: 8,
                            locked: false,
                            muted: false,
                            gain: 1,
                            loopEnabled: true,
                            loopLength: 4,
                            midiOffsetBeats: 0,
                            noteCount: 1,
                        },
                    ],
                },
            ],
        };

        expect(
            bridgeMidiToolCall({
                call: {
                    name: 'addNotes',
                    arguments: {
                        clipId: 'clip-loop-unanchored',
                        notes: [{ pitch: 60, startBeat: 3.5, duration: 0.25 }],
                    },
                },
                context: unanchoredContext,
                index: 0,
            })
        ).toEqual({
            type: 'addNotes',
            payload: { clipId: 'clip-loop-unanchored', notes: [{ pitch: 60, startBeat: 3.5, duration: 0.25 }] },
        });
        expect(
            bridgeMidiToolCall({
                call: {
                    name: 'addNotes',
                    arguments: { clipId: 'clip-loop-unanchored', notes: [{ pitch: 60, startBeat: 4.5, duration: 1 }] },
                },
                context: unanchoredContext,
                index: 0,
            })
        ).toMatchObject({ name: 'addNotes', reason: expect.stringContaining('falls outside') });
    });
});
