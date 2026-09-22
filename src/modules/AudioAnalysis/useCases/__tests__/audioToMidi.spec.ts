import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(() => ({ id: 'new-midi-clip' })),
    getAllTracks: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    addMidiNote: vi.fn(),
    getTransportState: vi.fn(),
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: mocks.addClip,
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: mocks.addMidiNote,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: mocks.getTransportState,
}));

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { audioToMidi } from '../audioToMidi';
import { detectOnsets } from '../detectOnsets';

const SAMPLE_RATE = 44100;
const HOP_SIZE = 512;
const FRAME_SIZE = 1024;

/**
 * Build a mono AudioBuffer-like object. `fill(index)` returns the sample value at
 * `index`; `length` defines the clip length in samples.
 */
function makeBuffer(length: number, fill: (index: number) => number): AudioBuffer {
    const data = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        data[index] = fill(index);
    }
    return {
        sampleRate: SAMPLE_RATE,
        length,
        numberOfChannels: 1,
        duration: length / SAMPLE_RATE,
        getChannelData: () => data,
    } as unknown as AudioBuffer;
}

describe('audioToMidi track creation routes through the command boundary (Fix 1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.addMidiNote.mockReset();
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
        mocks.addClip.mockReturnValue({ id: 'new-midi-clip' });
    });

    function loudBuffer(): AudioBuffer {
        // Several sharp onsets so detectOnsets yields notes.
        const length = SAMPLE_RATE;
        return makeBuffer(length, (index) => (index % 5000 < 100 ? 1.0 : 0));
    }

    it('dispatches an addTrack AppAction (instead of mutating the store) when target is not MIDI', () => {
        const audioClip = { id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Drum' };
        const audioTrack = { id: 't1', kind: 'audio', clips: [audioClip] };
        const createdTrack = { id: 'midi-created', kind: 'midi', clips: [] };

        // After the dispatch, getAllTracks must surface the newly-created MIDI track.
        mocks.getAllTracks
            .mockReturnValueOnce([audioTrack]) // clip lookup
            .mockReturnValueOnce([audioTrack]) // resolveMidiTrackId: existing-track check
            .mockReturnValueOnce([audioTrack]) // resolveMidiTrackId: idsBefore snapshot
            .mockReturnValue([audioTrack, createdTrack]); // after dispatch + later reads
        mocks.getCachedAudioBuffer.mockReturnValue(loudBuffer());

        audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 });

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf1' });
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'addTrack',
            payload: { name: 'Drum (MIDI)', kind: 'midi' },
        });
        // The clip is attached to the dispatched track's id — proving the resolved id
        // flows from the command boundary, not from a hidden direct mutation.
        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'midi-created' }));
        expect(mocks.addMidiNote).toHaveBeenCalled();
    });

    it('does not dispatch addTrack when the target already is a MIDI track', () => {
        const audioClip = { id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Drum' };
        const midiTrack = { id: 't1', kind: 'midi', clips: [audioClip] };
        mocks.getAllTracks.mockReturnValue([midiTrack]);
        mocks.getCachedAudioBuffer.mockReturnValue(loudBuffer());

        audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 });

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf1' });
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 't1' }));
    });

    it('aborts without adding a clip when the dispatched track never materialises', () => {
        const audioClip = { id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Drum' };
        const audioTrack = { id: 't1', kind: 'audio', clips: [audioClip] };
        // Dispatch is a no-op (e.g. uninitialised store): no new MIDI track ever appears.
        mocks.getAllTracks.mockReturnValue([audioTrack]);
        mocks.getCachedAudioBuffer.mockReturnValue(loudBuffer());

        audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 });

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf1' });
        expect(mocks.executeAppAction).toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });
});

describe('audioToMidi pitched mode (clamped pitch-window path coverage)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.addMidiNote.mockReset();
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
        mocks.addClip.mockReturnValue({ id: 'new-midi-clip' });
    });

    it('processes a clip whose final onset sits near the end without error', () => {
        // A tone burst whose onset is close enough to the clip end that the pitch window
        // would overrun — exercises the bounds clamp in detectPitchForOnsets. This asserts
        // the path completes and still emits pitched notes; it does NOT distinguish the fix
        // from the bug (see the note below for why no such public-surface seam exists).
        const freq = 220;
        const burstSample = 12 * HOP_SIZE;
        const length = burstSample + HOP_SIZE * 2 + FRAME_SIZE;
        const buffer = makeBuffer(length, (index) =>
            index >= burstSample ? Math.sin((2 * Math.PI * freq * index) / SAMPLE_RATE) : 0
        );

        const audioClip = { id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Tone' };
        const midiTrack = { id: 't1', kind: 'midi', clips: [audioClip] };
        mocks.getAllTracks.mockReturnValue([midiTrack]);
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);

        expect(() => audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1, mode: 'pitched' })).not.toThrow();
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf1' });
        expect(mocks.addMidiNote).toHaveBeenCalled();
        // The window never reads out of bounds, so every emitted pitch is a valid MIDI value.
        for (const call of mocks.addMidiNote.mock.calls) {
            const pitch = call[1] as number;
            expect(pitch).toBeGreaterThanOrEqual(0);
            expect(pitch).toBeLessThanOrEqual(127);
        }
    });
});

describe('audioToMidi return value discriminates real conversion from no-op/failure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.addMidiNote.mockReset();
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
        mocks.addClip.mockReturnValue({ id: 'new-midi-clip' });
    });

    function loudBuffer(): AudioBuffer {
        const length = SAMPLE_RATE;
        return makeBuffer(length, (index) => (index % 5000 < 100 ? 1.0 : 0));
    }

    function silentBuffer(): AudioBuffer {
        const length = SAMPLE_RATE;
        return makeBuffer(length, () => 0);
    }

    it('returns true when notes were actually written', () => {
        const audioClip = { id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Drum' };
        const midiTrack = { id: 't1', kind: 'midi', clips: [audioClip] };
        mocks.getAllTracks.mockReturnValue([midiTrack]);
        mocks.getCachedAudioBuffer.mockReturnValue(loudBuffer());

        const result = audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 });

        expect(result).toBe(true);
        expect(mocks.addMidiNote).toHaveBeenCalled();
    });

    it('returns false without writing a clip when no onsets are detected', () => {
        const audioClip = { id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Drum' };
        const midiTrack = { id: 't1', kind: 'midi', clips: [audioClip] };
        mocks.getAllTracks.mockReturnValue([midiTrack]);
        mocks.getCachedAudioBuffer.mockReturnValue(silentBuffer());

        const result = audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 });

        expect(result).toBe(false);
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });

    it('returns false instead of throwing when addMidiNote fails (e.g. MIDI store not initialized)', () => {
        const audioClip = { id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Drum' };
        const midiTrack = { id: 't1', kind: 'midi', clips: [audioClip] };
        mocks.getAllTracks.mockReturnValue([midiTrack]);
        mocks.getCachedAudioBuffer.mockReturnValue(loudBuffer());
        mocks.addMidiNote.mockImplementation(() => {
            throw new Error('MIDI store not initialized');
        });

        let result: boolean | undefined;
        expect(() => {
            result = audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 });
        }).not.toThrow();

        expect(result).toBe(false);
    });
});

describe('audioToMidi converts only the audio a clip plays', () => {
    const TEMPO = 120;
    const BEATS_PER_SECOND = TEMPO / 60;
    const SENSITIVITY = 0.1;
    const MIN_INTERVAL_BEATS = 0.25;
    const MIN_INTERVAL_SEC = MIN_INTERVAL_BEATS / BEATS_PER_SECOND;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.addMidiNote.mockReset();
        mocks.getTransportState.mockReturnValue({ tempo: TEMPO });
        mocks.addClip.mockReturnValue({ id: 'new-midi-clip' });
    });

    function arrangeClip(clip: Record<string, unknown>): void {
        mocks.getAllTracks.mockReturnValue([{ id: 't1', kind: 'midi', clips: [clip] }]);
    }

    function stepBuffer(onsetSample: number, length: number, laterOnsetSample?: number): AudioBuffer {
        return makeBuffer(length, (index) => {
            if (laterOnsetSample !== undefined && index >= laterOnsetSample) {
                return 0.95;
            }
            return index >= onsetSample ? 0.8 : 0;
        });
    }

    function noteStartBeats(): number[] {
        return mocks.addMidiNote.mock.calls.map((call) => call[2] as number);
    }

    it('drops an onset before a positive audio offset and shifts a later one earlier by that offset', () => {
        const offsetHops = 86;
        const offsetSec = (offsetHops * HOP_SIZE) / SAMPLE_RATE;
        const offsetBeats = offsetSec * BEATS_PER_SECOND;
        const headOnsetSample = 8 * HOP_SIZE;
        const laterOnsetSample = 100 * HOP_SIZE;
        const length = 180 * HOP_SIZE + FRAME_SIZE;
        const clip = {
            id: 'c1',
            audioBufferId: 'buf1',
            startBeat: 0,
            endBeat: 4,
            name: 'Drum',
            audioOffsetBeats: offsetBeats,
        };

        arrangeClip(clip);
        mocks.getCachedAudioBuffer.mockReturnValue(stepBuffer(headOnsetSample, length));

        expect(audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(false);
        expect(mocks.addMidiNote).not.toHaveBeenCalled();

        vi.clearAllMocks();
        mocks.getTransportState.mockReturnValue({ tempo: TEMPO });
        mocks.addClip.mockReturnValue({ id: 'new-midi-clip' });
        arrangeClip(clip);
        const laterBuffer = stepBuffer(laterOnsetSample, length);
        mocks.getCachedAudioBuffer.mockReturnValue(laterBuffer);

        expect(audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(true);
        const rawOnsets = detectOnsets(laterBuffer, SENSITIVITY, MIN_INTERVAL_SEC);
        expect(rawOnsets.length).toBeGreaterThan(0);
        const rawStartBeat = rawOnsets[0]!.timeSec * BEATS_PER_SECOND;
        const written = noteStartBeats();
        expect(written).toHaveLength(1);
        expect(written[0]).toBeLessThan(rawStartBeat);
        expect(written[0]).toBeCloseTo(rawStartBeat - offsetBeats, 1);
    });

    it('writes no note for an onset past the clip audible end', () => {
        const onsetSample = 200 * HOP_SIZE;
        const length = 280 * HOP_SIZE + FRAME_SIZE;
        const buffer = stepBuffer(onsetSample, length);
        arrangeClip({ id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Drum' });
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);

        const rawOnsets = detectOnsets(buffer, SENSITIVITY, MIN_INTERVAL_SEC);
        expect(rawOnsets.length).toBeGreaterThan(0);
        expect(rawOnsets[0]!.timeSec).toBeGreaterThan(4 / BEATS_PER_SECOND);

        expect(audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(false);
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });

    it('repeats an in-loop onset once per iteration and ignores buffer past the loop window', () => {
        const inLoopSample = 8 * HOP_SIZE;
        const outsideSample = 60 * HOP_SIZE;
        const length = 180 * HOP_SIZE + FRAME_SIZE;
        const buffer = stepBuffer(inLoopSample, length, outsideSample);
        arrangeClip({
            id: 'c1',
            audioBufferId: 'buf1',
            startBeat: 0,
            endBeat: 4,
            name: 'Drum',
            loopEnabled: true,
            loopLength: 1,
        });
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);

        const rawOnsets = detectOnsets(buffer, SENSITIVITY, MIN_INTERVAL_SEC);
        expect(rawOnsets.length).toBeGreaterThanOrEqual(2);
        const outsideBeat = rawOnsets[1]!.timeSec * BEATS_PER_SECOND;

        expect(audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(true);
        const written = noteStartBeats()
            .slice()
            .sort((left, right) => left - right);
        expect(written).toHaveLength(4);
        expect(written[1]! - written[0]!).toBeCloseTo(1, 5);
        expect(written[2]! - written[1]!).toBeCloseTo(1, 5);
        expect(written[3]! - written[2]!).toBeCloseTo(1, 5);
        for (const startBeat of written) {
            expect(startBeat).toBeGreaterThanOrEqual(0);
            expect(startBeat).toBeLessThan(4);
            expect(startBeat).not.toBeCloseTo(outsideBeat, 1);
        }
    });

    it('places the first audible onset after a negative-offset pre-roll, not at beat 0', () => {
        const onsetSample = 8 * HOP_SIZE;
        const length = SAMPLE_RATE;
        const buffer = stepBuffer(onsetSample, length);
        const audioOffsetBeats = -2;
        arrangeClip({
            id: 'c1',
            audioBufferId: 'buf1',
            startBeat: 0,
            endBeat: 4,
            name: 'Drum',
            audioOffsetBeats,
        });
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);

        const rawOnsets = detectOnsets(buffer, SENSITIVITY, MIN_INTERVAL_SEC);
        expect(rawOnsets.length).toBeGreaterThan(0);
        const rawStartBeat = rawOnsets[0]!.timeSec * BEATS_PER_SECOND;

        expect(audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(true);
        const written = noteStartBeats();
        expect(written.length).toBeGreaterThan(0);
        const firstBeat = Math.min(...written);
        expect(firstBeat).not.toBeCloseTo(0, 1);
        expect(firstBeat).not.toBeCloseTo(rawStartBeat, 1);
        expect(firstBeat).toBeCloseTo(-audioOffsetBeats + rawStartBeat, 1);
        expect(firstBeat).toBeGreaterThan(1);
    });
});

// Fix 3 (pitch-window bounds clamp in detectPitchForOnsets) has no red/green regression
// test here, deliberately. The clamp slides the pitch window left so estimatePitch always
// receives a full `2 * FRAME_SIZE` window instead of a silently shrunk one near the clip
// end. But that difference is NOT observable through the public surface (the emitted MIDI
// notes): `detectOnsets` only ever reports an onset at frame index `numFrames - 3` at the
// latest, so for any detector-produced onset the *un*-clamped (buggy) window already spans
// `length - onsetSample ∈ [1024, 1536)` samples — never small enough to trip estimatePitch's
// `actual < 64` / `searchEnd <= minLag` fallback, and ≥1024 tone samples resolve to the same
// lag as the full 2048-sample window. An exhaustive search over silence→tone, multi-burst,
// and dip-induced onsets found no buffer where the clamped and unclamped windows yield a
// different note. The fix remains correct (it removes a latent shrunk-window hazard that
// would surface if FRAME_SIZE/HOP_SIZE or the onset-reporting range changed), but asserting
// it would require reaching into the private detectPitchForOnsets/estimatePitch internals,
// which the public-surface testing rule forbids. See the pitched-mode coverage above, which
// exercises the clamped path without distinguishing fix from bug.
