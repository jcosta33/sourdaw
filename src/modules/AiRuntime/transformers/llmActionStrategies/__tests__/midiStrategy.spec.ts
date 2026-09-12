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
});
