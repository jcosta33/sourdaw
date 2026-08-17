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
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: mocks.addMidiNote,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: mocks.getTransportState,
}));

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { audioToMidi } from '../audioToMidi';

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
