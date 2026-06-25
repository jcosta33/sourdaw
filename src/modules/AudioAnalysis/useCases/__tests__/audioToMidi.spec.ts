import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioToMidi, detectOnsets } from '../audioToMidi';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(() => ({ id: 'new-midi-clip' })),
    getAllTracks: vi.fn(),
    audioBufferCacheGet: vi.fn(),
    addMidiNote: vi.fn(),
    getTransportState: vi.fn(),
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: mocks.addClip,
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { get: mocks.audioBufferCacheGet },
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

/** RMS energy of the FRAME_SIZE window starting at frame `frame` — independent of the
 *  implementation under test, used to derive ground-truth amplitudes. */
function frameRms(buffer: AudioBuffer, frame: number): number {
    const data = buffer.getChannelData(0);
    const start = frame * HOP_SIZE;
    const end = Math.min(start + FRAME_SIZE, data.length);
    let sum = 0;
    for (let i = start; i < end; i++) {
        sum += data[i]! * data[i]!;
    }
    return Math.sqrt(sum / (end - start));
}

/**
 * Re-derive, from the raw buffer alone, the frame index at which `detectOnsets` reports
 * its first onset — replicating the spectral-flux peak-picking but NOT the timestamp /
 * amplitude indexing under test. This gives an independent ground truth so the timing
 * assertions cannot be satisfied tautologically by the implementation's own output.
 * Returns -1 if no onset frame qualifies.
 */
function expectedPeakFluxFrame(buffer: AudioBuffer, sensitivity: number): number {
    const data = buffer.getChannelData(0);
    const numFrames = Math.floor((data.length - FRAME_SIZE) / HOP_SIZE) + 1;
    if (numFrames < 2) {
        return -1;
    }

    const energies: number[] = [];
    for (let i = 0; i < numFrames; i++) {
        energies.push(frameRms(buffer, i));
    }

    const flux: number[] = [];
    let maxFlux = 0;
    for (let i = 0; i < numFrames - 1; i++) {
        const value = Math.max(0, energies[i + 1]! - energies[i]!);
        flux.push(value);
        if (value > maxFlux) {
            maxFlux = value;
        }
    }
    if (maxFlux < 1e-8) {
        return -1;
    }

    const threshold = sensitivity * maxFlux;
    for (let i = 1; i < flux.length - 1; i++) {
        if (flux[i]! > threshold && flux[i]! > flux[i - 1]! && flux[i]! >= flux[i + 1]!) {
            return i;
        }
    }
    return -1;
}

describe('detectOnsets onset timing (Fix 2: one-hop lag)', () => {
    it('reports the onset at the flux-peak frame, not one hop later', () => {
        // Silence, then a sustained loud region beginning at a known frame boundary far
        // from both edges so the energy rise (and thus the flux peak) is unambiguous.
        const onsetFrame = 20;
        const onsetSample = onsetFrame * HOP_SIZE;
        const length = 80 * HOP_SIZE + FRAME_SIZE;
        const buffer = makeBuffer(length, (index) => (index >= onsetSample ? 0.8 : 0));

        const onsets = detectOnsets(buffer, 0.3, 0.001);

        expect(onsets.length).toBeGreaterThan(0);
        const reported = onsets[0]!.timeSec;

        // Ground truth derived *independently* from the buffer (not from the reported
        // value): the frame index where detectOnsets peaks. The fix timestamps the onset
        // at `peakFrame * HOP/sr`; the buggy version added one extra hop.
        const peakFrame = expectedPeakFluxFrame(buffer, 0.3);
        expect(peakFrame).toBeGreaterThan(0);

        const fixedTime = (peakFrame * HOP_SIZE) / SAMPLE_RATE;
        const buggyTime = ((peakFrame + 1) * HOP_SIZE) / SAMPLE_RATE;

        expect(reported).toBeCloseTo(fixedTime, 9);
        expect(reported).not.toBeCloseTo(buggyTime, 9);
    });

    it('reads amplitude from the flux-peak frame, not the frame after it', () => {
        // Silence, then a sustained loud region: the flux-peak frame (still partly inside
        // the rising edge) and the frame after it (fully loud) have *different* RMS
        // energies, so reading the wrong (next) frame yields a measurably different
        // amplitude. Both the peak frame and its successor are derived independently from
        // the buffer.
        const riseSample = 24 * HOP_SIZE;
        const length = 80 * HOP_SIZE + FRAME_SIZE;
        const buffer = makeBuffer(length, (index) => (index >= riseSample ? 0.7 : 0));

        const onsets = detectOnsets(buffer, 0.3, 0.001);
        expect(onsets.length).toBeGreaterThan(0);

        const peakFrame = expectedPeakFluxFrame(buffer, 0.3);
        expect(peakFrame).toBeGreaterThan(0);
        const peakEnergy = frameRms(buffer, peakFrame);
        const nextEnergy = frameRms(buffer, peakFrame + 1);

        // Sanity: the two frames really do differ, so the assertion can discriminate
        // between reading the peak frame (fix) and the next frame (bug).
        expect(Math.abs(peakEnergy - nextEnergy)).toBeGreaterThan(1e-6);
        expect(onsets[0]!.amplitude).toBeCloseTo(peakEnergy, 6);
        expect(onsets[0]!.amplitude).not.toBeCloseTo(nextEnergy, 6);
    });
});

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
        mocks.audioBufferCacheGet.mockReturnValue(loudBuffer());

        audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 });

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
        mocks.audioBufferCacheGet.mockReturnValue(loudBuffer());

        audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 });

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 't1' }));
    });

    it('aborts without adding a clip when the dispatched track never materialises', () => {
        const audioClip = { id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Drum' };
        const audioTrack = { id: 't1', kind: 'audio', clips: [audioClip] };
        // Dispatch is a no-op (e.g. uninitialised store): no new MIDI track ever appears.
        mocks.getAllTracks.mockReturnValue([audioTrack]);
        mocks.audioBufferCacheGet.mockReturnValue(loudBuffer());

        audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 });

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
        mocks.audioBufferCacheGet.mockReturnValue(buffer);

        expect(() => audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1, mode: 'pitched' })).not.toThrow();
        expect(mocks.addMidiNote).toHaveBeenCalled();
        // The window never reads out of bounds, so every emitted pitch is a valid MIDI value.
        for (const call of mocks.addMidiNote.mock.calls) {
            const pitch = call[1] as number;
            expect(pitch).toBeGreaterThanOrEqual(0);
            expect(pitch).toBeLessThanOrEqual(127);
        }
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
