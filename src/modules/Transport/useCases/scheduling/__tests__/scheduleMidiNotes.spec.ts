import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping, getSynthParamsForTrack, getGrooveOffsetAtBeat } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { createBufferSource, ensureTrackStrip, getCurrentTime } from '#/modules/AudioEngine/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { scheduleNote } from '#/modules/Synth/useCases';
import { getYeastRack } from '#/modules/Yeast/stores';

import { getTempoAtBeat } from '../../../models/TempoMap';
import { defaultTransportState } from '../../../models/TransportState';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { scheduleFrozenTrack, scheduleMidiNotes } from '../scheduleMidiNotes';

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
}));
vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));
vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: { changes: [] } },
}));
vi.mock('../../../models/TempoMap', () => ({
    getTempoAtBeat: vi.fn(() => 120),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: vi.fn((_trackId, clips) => clips),
    getSynthParamsForTrack: vi.fn(() => ({})),
    getGrooveOffsetAtBeat: vi.fn(() => 0),
}));
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { get: vi.fn(() => null) },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCompensationDelay: vi.fn(() => 0),
    ensureTrackStrip: vi.fn(() => ({ gainNode: {}, preFaderTap: { connect: vi.fn() } })),
    getCurrentTime: vi.fn(() => 0),
    getDrumKitByIndex: vi.fn(() => null),
    getAudioContext: vi.fn(() => ({
        sampleRate: 48000,
        createGain: vi.fn(() => ({ connect: vi.fn() })),
    })),
    createBufferSource: vi.fn(),
    scheduleFaustNote: vi.fn(),
}));
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: vi.fn(() => null),
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: vi.fn(),
}));
vi.mock('#/modules/Yeast/stores', () => ({
    getYeastRack: vi.fn(() => ({ getProcessorIds: () => [], processBlock: vi.fn() })),
    getYeastWorkletNodeAsync: vi.fn(() => null),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    getChordAtBeat: vi.fn(),
    transposeForChordTrack: vi.fn((param) => param),
}));

function midiTrack(overrides: Record<string, unknown> = {}) {
    return {
        id: 'track-1',
        kind: 'midi',
        muted: false,
        parentId: null,
        followChordTrack: false,
        devices: [],
        clips: [],
        freezeState: { status: 'unfrozen' },
        ...overrides,
    } as never;
}

function midiClip(overrides: Record<string, unknown> = {}) {
    return {
        id: 'clip-1',
        type: 'midi',
        muted: false,
        startBeat: 0,
        endBeat: 4,
        gain: 1,
        loopEnabled: false,
        ...overrides,
    } as never;
}

describe('scheduleMidiNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (trackStore as { value: unknown }).value = { tracks: [] };
        (midiStore as { value: unknown }).value = null;
        (timeSignatureMapStore as { value: unknown }).value = { changes: [] };
        vi.mocked(resolveClipsWithComping).mockImplementation((_trackId, clips) => clips);
        vi.mocked(getGrooveOffsetAtBeat).mockReturnValue(0);
        vi.mocked(getTempoAtBeat).mockReturnValue(120);
    });

    it('does not schedule synth when MIDI store is uninitialized', async () => {
        await scheduleMidiNotes(0, 4, 0, 0, [], defaultTransportState, 120);

        expect(getSynthParamsForTrack).not.toHaveBeenCalled();
    });

    // §1 — Per-note probability must be deterministic so replays are identical.
    it('makes per-note probability gating deterministic across runs (§55.3)', async () => {
        const track = midiTrack({ clips: [midiClip()] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        // 16 notes, each at 50% probability, spread across the clip window.
        const notes = Array.from({ length: 16 }, (_value, index) => ({
            id: `note-${index}`,
            pitch: 60 + index,
            startBeat: index * 0.2,
            duration: 0.1,
            velocity: 100,
            probability: 50,
        }));
        (midiStore as { value: unknown }).value = { notesByClipId: { 'clip-1': notes } };

        async function pitchesFromRun() {
            vi.mocked(scheduleNote).mockClear();
            await scheduleMidiNotes(0, 4, 0, -1, [], defaultTransportState, 120);
            return vi.mocked(scheduleNote).mock.calls.map((call) => call[2]);
        }

        const first = await pitchesFromRun();
        const second = await pitchesFromRun();

        // Same seed inputs => identical gating decisions, every run.
        expect(second).toEqual(first);
        // Sanity: 50% gating actually drops some of the 16 notes (not all-or-nothing).
        expect(first.length).toBeGreaterThan(0);
        expect(first.length).toBeLessThan(notes.length);
    });

    // §6 — A Yeast generator can emit notes for a clip that has none. Those
    // notes must be fully-specified MidiNotes, not malformed {} spreads.
    it('schedules well-formed notes when Yeast generates onto an empty clip (§6)', async () => {
        const track = midiTrack({ clips: [midiClip()], devices: [{ id: 'y', type: 'yeast' }] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        // Empty source clip — no authored notes.
        (midiStore as { value: unknown }).value = { notesByClipId: { 'clip-1': [] } };

        // Yeast rack with a processor that emits a generated note.
        vi.mocked(getYeastRack).mockReturnValue({
            getProcessorIds: () => ['gen'],
            processBlock: vi.fn(() => [
                { timeSamples: 24000, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 90 } },
                { timeSamples: 48000, kind: { type: 'noteOff', channel: 0, note: 64 } },
            ]),
        } as never);

        await scheduleMidiNotes(0, 4, 0, -1, [], defaultTransportState, 120);

        // The generated note reaches the synth as a complete note built from the
        // default template (rather than being dropped or silently malformed).
        // scheduleNote(ctx, gain, pitch, time, duration, velocity, params, mpe, gain).
        expect(scheduleNote).toHaveBeenCalledTimes(1);
        const call = vi.mocked(scheduleNote).mock.calls[0]!;
        expect(call[2]).toBe(64); // pitch from the generator
        expect(call[5]).toBe(90); // velocity carried through, not garbled
        // Probability defaults to 100 from the template, so the note is not gated out.
    });

    // §2 — A looping Yeast clip must run the worklet once per loop iteration so a
    // bar-aware processor sees iter-correct event positions, instead of running
    // once and replaying one iteration's output at every offset.
    it('runs the Yeast worklet per loop iteration over a looping clip (§2)', async () => {
        const track = midiTrack({
            clips: [midiClip({ endBeat: 8, loopEnabled: true, loopLength: 2 })],
            devices: [{ id: 'y', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        // One source note at clip-relative beat 0 — it recurs at each loop iteration.
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        };

        // Record the noteOn sample positions the worklet sees per call. The
        // processor echoes its input back so we observe per-iteration placement.
        const seenNoteOnSamples: number[][] = [];
        const processBlock = vi.fn((events: { timeSamples: number; kind: { type: string } }[]) => {
            seenNoteOnSamples.push(events.filter((e) => e.kind.type === 'noteOn').map((e) => e.timeSamples));
            return events;
        });
        vi.mocked(getYeastRack).mockReturnValue({
            getProcessorIds: () => ['gen'],
            processBlock,
        } as never);

        // clip endBeat 8, loopLength 2 => ceil(8/2) = 4 iterations.
        await scheduleMidiNotes(0, 8, 0, -1, [], defaultTransportState, 120);

        // The worklet ran once per iteration (was once total before the fix).
        expect(processBlock).toHaveBeenCalledTimes(4);
        // Each iteration placed its note at a distinct, iteration-shifted sample
        // position (2 beats apart at 120bpm/48k = 48000 samples), not a single
        // replayed position.
        const firstSampleEachIter = seenNoteOnSamples.map((arr) => arr[0]);
        expect(firstSampleEachIter).toEqual([0, 48000, 96000, 144000]);
    });

    // §3 — The Yeast block's beats↔samples conversion must use the tempo map's
    // value at the block, not the flat transport tempo.
    it('uses the tempo map (not flat transport tempo) for Yeast beats↔samples (§3)', async () => {
        const track = midiTrack({ clips: [midiClip()], devices: [{ id: 'y', type: 'yeast' }] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }] },
        };
        // Tempo map reports 240bpm at the block; transport.tempo stays at 120.
        vi.mocked(getTempoAtBeat).mockReturnValue(240);

        let seenNoteOnSample: number | undefined;
        const processBlock = vi.fn((events: { timeSamples: number; kind: { type: string } }[]) => {
            seenNoteOnSample = events.find((e) => e.kind.type === 'noteOn')?.timeSamples;
            return events;
        });
        vi.mocked(getYeastRack).mockReturnValue({ getProcessorIds: () => ['gen'], processBlock } as never);

        await scheduleMidiNotes(0, 4, 0, -1, [], defaultTransportState, 120);

        // spb = 240/60 = 4; beat 1 => round(1 * 48000 / 4) = 12000.
        // Flat-tempo (buggy) spb = 120/60 = 2 would give 24000.
        expect(seenNoteOnSample).toBe(12000);
    });

    // audit row 2 — The Yeast transport metadata (bar index, beat-in-bar, time
    // signature) must derive from the time-signature map, the same authority the
    // metronome uses — not the flat transport numerator/denominator. After a
    // mid-project meter change a bar-aware processor would otherwise read the
    // wrong bar while the metronome stays correct.
    it('derives Yeast bar/time-signature metadata from the time-signature map (audit row 2)', async () => {
        const track = midiTrack({ clips: [midiClip({ endBeat: 12 })], devices: [{ id: 'y', type: 'yeast' }] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 6, duration: 1, velocity: 100 }] },
        };
        // A 3/4 meter from beat 0. transport defaults stay at 4/4 so a flat-numerator
        // reading would disagree with the map.
        (timeSignatureMapStore as { value: unknown }).value = {
            changes: [{ id: 'ts0', beat: 0, numerator: 3, denominator: 4 }],
        };

        let seenTransport: { barIndex: number; beatInBar: number; timeSigNum: number; timeSigDen: number } | undefined;
        const processBlock = vi.fn(
            (
                _events: unknown,
                _start: number,
                _end: number,
                transportInfo: { barIndex: number; beatInBar: number; timeSigNum: number; timeSigDen: number }
            ) => {
                seenTransport = transportInfo;
                return [];
            }
        );
        vi.mocked(getYeastRack).mockReturnValue({ getProcessorIds: () => ['gen'], processBlock } as never);

        // Block starts at beat 6 — bar 3 (index 2), beat 1 in 3/4. Flat 4/4 (buggy)
        // would report barIndex floor(6/4)=1, beatInBar 6%4=2, timeSigNum 4.
        await scheduleMidiNotes(6, 10, 6, -1, [], { ...defaultTransportState }, 120);

        expect(seenTransport).toBeDefined();
        expect(seenTransport!.timeSigNum).toBe(3);
        expect(seenTransport!.timeSigDen).toBe(4);
        expect(seenTransport!.barIndex).toBe(2);
        expect(seenTransport!.beatInBar).toBe(0);
    });

    // §4 — A negative groove offset must clamp a note to the iteration start, not
    // silently drop it (data loss).
    it('clamps a note moved earlier by a negative groove offset instead of dropping it (§4)', async () => {
        const track = midiTrack({ clips: [midiClip()] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        };
        // Groove pushes the note to beat -1, before the iteration start (beat 0).
        vi.mocked(getGrooveOffsetAtBeat).mockReturnValue(-1);

        await scheduleMidiNotes(0, 4, 0, -1, [], defaultTransportState, 120);

        // Old behaviour: noteStartBeat (-1) < clip.startBeat (0) => dropped.
        // New behaviour: clamped to the iteration start (0) and scheduled.
        expect(scheduleNote).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleNote).mock.calls[0]![2]).toBe(60);
    });
});

describe('scheduleFrozenTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // §5 — A frozen buffer is rendered starting at the track's earliest clip
    // startBeat, so playback must be offset by that beat — not beat 0.
    it('offsets the frozen buffer by the track start beat, not beat 0 (§5)', () => {
        const start = vi.fn();
        const connect = vi.fn();
        const source = { start, connect, onended: null } as never;
        vi.mocked(createBufferSource).mockReturnValue(source);
        vi.mocked(audioBufferCache.get).mockReturnValue({ duration: 100 } as never);
        vi.mocked(ensureTrackStrip).mockReturnValue({ preFaderTap: { connect: vi.fn() } } as never);
        vi.mocked(getCurrentTime).mockReturnValue(0);

        const track = {
            id: 'track-frozen',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
            clips: [{ startBeat: 8 }, { startBeat: 12 }],
        };

        const scheduled = scheduleFrozenTrack(track, 0, [], 120);

        expect(scheduled).toBe(true);
        // earliest clip startBeat = 8; at 120bpm, 8 beats = 4 seconds.
        // Old (buggy) behaviour offset by beat 0 => start(0).
        expect(start).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledWith(4);
    });
});
