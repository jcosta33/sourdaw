import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { type AppAction } from '#/utils/handlerContract';

const mocks = vi.hoisted(() => ({
    getAllTracks: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getTransportState: vi.fn(),
    executeAppActionBatch: vi.fn(async (_actions: AppAction[], _options?: unknown) => ({ status: 'committed' })),
    clipStartTempo: null as number | null,
    tempoChangeBeat: null as number | null,
    tempoAfterChange: null as number | null,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const baseTempo = () => mocks.getTransportState()?.tempo ?? 120;
    const changeBeat = () => mocks.tempoChangeBeat ?? (mocks.clipStartTempo === null ? null : 4);
    const changedTempo = () => mocks.tempoAfterChange ?? mocks.clipStartTempo;
    const secondsAtBeat = (beat: number) => {
        const boundary = changeBeat();
        const after = changedTempo();
        if (boundary === null || after === null || beat <= boundary) {
            return (beat * 60) / baseTempo();
        }
        return (boundary * 60) / baseTempo() + ((beat - boundary) * 60) / after;
    };
    return {
        ...(await importOriginal<Record<string, unknown>>()),
        readTempoAtBeat: ({ beat }: { beat: number }) => {
            const boundary = changeBeat();
            const after = changedTempo();
            return boundary !== null && after !== null && beat >= boundary ? after : baseTempo();
        },
        readSecondsAtBeat: ({ beat }: { beat: number }) => secondsAtBeat(beat),
        readBeatAtSamples: ({ samples, sampleRate }: { samples: number; sampleRate: number }) => {
            const seconds = samples / sampleRate;
            const boundary = changeBeat();
            const after = changedTempo();
            if (boundary === null || after === null || seconds <= secondsAtBeat(boundary)) {
                return (seconds * baseTempo()) / 60;
            }
            return boundary + ((seconds - secondsAtBeat(boundary)) * after) / 60;
        },
    };
});

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppActionBatch: mocks.executeAppActionBatch,
    executeUserAppAction: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: mocks.getTransportState,
}));

import { audioToMidi } from '../audioToMidi';
import { detectOnsets } from '../detectOnsets';

type NoteCall = [clipId: string, pitch: number, startBeat: number, duration: number, velocity: number];

function noteCalls(): NoteCall[] {
    return mocks.executeAppActionBatch.mock.calls.flatMap(([actions]) =>
        actions.flatMap((action) => {
            if (action.type !== 'addNotes') {
                return [];
            }
            return action.payload.notes.map((note): NoteCall => [
                action.payload.clipId,
                note.pitch,
                note.startBeat,
                note.duration,
                note.velocity ?? 100,
            ]);
        })
    );
}

const SAMPLE_RATE = 44100;
const HOP_SIZE = 512;
const FRAME_SIZE = 1024;

beforeEach(() => {
    mocks.clipStartTempo = null;
    mocks.tempoChangeBeat = null;
    mocks.tempoAfterChange = null;
});

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

describe('audioToMidi plans complete command creation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
        mocks.getCachedAudioBuffer.mockReturnValue(makeBuffer(SAMPLE_RATE, (index) => (index % 5000 < 100 ? 1 : 0)));
    });

    it('prepares destination and clip identities in one compensated batch', async () => {
        mocks.getAllTracks.mockReturnValue([
            { id: 't1', kind: 'audio', clips: [{ id: 'c1', startBeat: 0, endBeat: 4, name: 'Drum' }] },
        ]);
        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 })).toBe(true);
        const [actions, options] = mocks.executeAppActionBatch.mock.calls[0]!;
        expect(actions.map((action) => action.type)).toEqual(['addTrack', 'addClip', 'addNotes']);
        const track = actions[0];
        const clip = actions[1];
        const notes = actions[2];
        expect(track).toMatchObject({
            type: 'addTrack',
            payload: { id: expect.any(String), kind: 'midi', name: 'Drum (MIDI)' },
        });
        if (track?.type !== 'addTrack' || clip?.type !== 'addClip' || notes?.type !== 'addNotes') {
            throw new Error('Expected complete conversion plan');
        }
        expect(clip.payload.trackId).toBe(track.payload.id);
        expect(notes.payload.clipId).toBe(clip.payload.id);
        expect(options).toMatchObject({
            requireCompensation: true,
            groupId: expect.any(String),
            groupLabel: 'Convert audio to MIDI',
        });
    });

    it('reuses an existing MIDI destination without a track creation command', async () => {
        mocks.getAllTracks.mockReturnValue([
            { id: 't1', kind: 'midi', clips: [{ id: 'c1', startBeat: 0, endBeat: 4, name: 'Drum' }] },
        ]);
        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 })).toBe(true);
        const actions = mocks.executeAppActionBatch.mock.calls[0]![0];
        expect(actions.map((action) => action.type)).toEqual(['addClip', 'addNotes']);
        expect(actions[0]).toMatchObject({ payload: { trackId: 't1' } });
    });
});

describe('audioToMidi follows the physical source and tempo map', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
    });

    function arrangeClip(clip: Record<string, unknown>): void {
        mocks.getAllTracks.mockReturnValue([{ id: 't1', kind: 'midi', clips: [clip] }]);
    }

    function stepBuffer(onsetSeconds: number, durationSeconds: number): AudioBuffer {
        return makeBuffer(Math.round(durationSeconds * SAMPLE_RATE), (index) =>
            index >= Math.round(onsetSeconds * SAMPLE_RATE) ? 0.8 : 0
        );
    }

    function notes(): Array<{ pitch: number; beat: number }> {
        return noteCalls().map((call) => ({ pitch: call[1], beat: call[2] }));
    }

    it('honours canonical zero over stale beat offset and integrates a tempo change before the onset', async () => {
        mocks.tempoChangeBeat = 3;
        mocks.tempoAfterChange = 60;
        arrangeClip({
            id: 'c1',
            audioBufferId: 'buf1',
            startBeat: 2,
            endBeat: 5,
            name: 'Drum',
            audioOffsetSeconds: 0,
            audioOffsetBeats: 3,
        });
        mocks.getCachedAudioBuffer.mockReturnValue(stepBuffer(1.5, 2));

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 })).toBe(true);
        expect(notes()).toHaveLength(1);
        expect(notes()[0]!.pitch).toBe(36);
        // Beat 2→3 takes 0.5 s; beat 3→4 takes 1 s. The attack is two beats into the clip.
        expect(notes()[0]!.beat).toBeCloseTo(2, 1);
    });

    it.each([
        { rate: 0.5, expectedBeat: 3 },
        { rate: 2, expectedBeat: 1.125 },
    ])(
        'places a $rate-rate source attack after signed pre-roll across the tempo change',
        async ({ rate, expectedBeat }) => {
            mocks.tempoChangeBeat = 3;
            mocks.tempoAfterChange = 60;
            arrangeClip({
                id: 'c1',
                audioBufferId: 'buf1',
                startBeat: 2,
                endBeat: 6,
                name: 'Drum',
                audioOffsetSeconds: -0.5,
                audioOffsetBeats: 0,
                stretchMode: 'repitch',
                stretchRatio: rate,
            });
            mocks.getCachedAudioBuffer.mockReturnValue(stepBuffer(0.75, 1.5));

            expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 })).toBe(true);
            expect(notes()).toHaveLength(1);
            // The detector reports a leading energy frame, about 0.06 beat before the sample step.
            expect(Math.abs(notes()[0]!.beat - expectedBeat)).toBeLessThan(0.08);
        }
    );

    it('uses original pass seams and distinct first, wrap, and later-head sources', async () => {
        const regionTone = (index: number, sourceStart: number, sourceEnd: number, frequency: number) => {
            const seconds = index / SAMPLE_RATE;
            if (seconds < sourceStart || seconds >= sourceEnd) {
                return 0;
            }
            const amplitude = seconds - sourceStart >= 0.14 ? 0.9 : 0.06;
            return amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE);
        };
        const buffer = makeBuffer(
            3 * SAMPLE_RATE,
            (index) =>
                regionTone(index, 0, 1, 660) +
                regionTone(index, 1, 1.5, 440) +
                regionTone(index, 2, 2.5, 330) +
                regionTone(index, 2.6, 3, 990)
        );
        arrangeClip({
            id: 'c1',
            audioBufferId: 'buf1',
            startBeat: 1,
            endBeat: 5,
            name: 'Three-part loop',
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: -2,
            audioOffsetSeconds: 2,
            audioLoopStartSeconds: 0,
            audioLoopPassEntrySeconds: 1,
            audioLoopPassOriginBeat: 0,
            audioOffsetBeats: 7,
        });
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1, mode: 'pitched' })).toBe(true);
        const emitted = notes().sort((left, right) => left.beat - right.beat);
        expect(emitted).toHaveLength(3);
        expect(emitted.map((note) => note.pitch)).toEqual([64, 76, 69]);
        expect(emitted[0]!.beat).toBeCloseTo(0.28, 1);
        expect(emitted[1]!.beat).toBeCloseTo(1.28, 1);
        expect(emitted[2]!.beat).toBeCloseTo(3.28, 1);
    });

    it('does not read an onset when the canonical entry is the exclusive physical source end', async () => {
        const buffer = stepBuffer(0.25, 1);
        arrangeClip({
            id: 'c1',
            audioBufferId: 'buf1',
            startBeat: 0,
            endBeat: 2,
            name: 'Ended source',
            audioOffsetSeconds: buffer.duration,
            audioOffsetBeats: 0,
        });
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 })).toBe(false);
        expect(notes()).toHaveLength(0);
    });
});

describe('audioToMidi pitched mode (clamped pitch-window path coverage)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clipStartTempo = null;
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
    });

    it('processes a clip whose final onset sits near the end without error', async () => {
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

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1, mode: 'pitched' })).toBe(true);
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf1' });
        expect(noteCalls().length).toBeGreaterThan(0);
        // The window never reads out of bounds, so every emitted pitch is a valid MIDI value.
        for (const call of noteCalls()) {
            const pitch = call[1];
            expect(pitch).toBeGreaterThanOrEqual(0);
            expect(pitch).toBeLessThanOrEqual(127);
        }
    });
});

describe('audioToMidi committed result', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
        mocks.getAllTracks.mockReturnValue([
            { id: 't1', kind: 'midi', clips: [{ id: 'c1', startBeat: 0, endBeat: 4, name: 'Drum' }] },
        ]);
        mocks.getCachedAudioBuffer.mockReturnValue(makeBuffer(SAMPLE_RATE, (index) => (index % 5000 < 100 ? 1 : 0)));
    });

    it.each(['committed', 'committed-with-warning'])('returns true only after %s', async (status) => {
        mocks.executeAppActionBatch.mockResolvedValueOnce({ status });
        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 })).toBe(true);
        expect(noteCalls().length).toBeGreaterThan(0);
    });

    it.each(['failed', 'conflicted', 'rejected', 'cancelled', 'ambiguous', 'no-op'])(
        'returns false for %s',
        async (status) => {
            mocks.executeAppActionBatch.mockResolvedValueOnce({ status });
            expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 })).toBe(false);
        }
    );

    it('does not submit a creation batch when there are no onsets', async () => {
        mocks.getCachedAudioBuffer.mockReturnValue(makeBuffer(SAMPLE_RATE, () => 0));
        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 })).toBe(false);
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('returns false when dispatch rejects', async () => {
        mocks.executeAppActionBatch.mockRejectedValueOnce(new Error('MIDI store not initialized'));
        await expect(audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: 0.1 })).resolves.toBe(false);
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
        mocks.clipStartTempo = null;
        mocks.getTransportState.mockReturnValue({ tempo: TEMPO });
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
        return noteCalls().map((call) => call[2]);
    }

    it('drops an onset before a positive audio offset and shifts a later one earlier by that offset', async () => {
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

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(false);
        expect(noteCalls()).toHaveLength(0);

        vi.clearAllMocks();
        mocks.getTransportState.mockReturnValue({ tempo: TEMPO });
        arrangeClip(clip);
        const laterBuffer = stepBuffer(laterOnsetSample, length);
        mocks.getCachedAudioBuffer.mockReturnValue(laterBuffer);

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(true);
        const rawOnsets = detectOnsets(laterBuffer, SENSITIVITY, MIN_INTERVAL_SEC);
        expect(rawOnsets.length).toBeGreaterThan(0);
        const rawStartBeat = rawOnsets[0]!.timeSec * BEATS_PER_SECOND;
        const written = noteStartBeats();
        expect(written).toHaveLength(1);
        expect(written[0]).toBeLessThan(rawStartBeat);
        expect(written[0]).toBeCloseTo(rawStartBeat - offsetBeats, 1);
    });

    it('transcribes the audible source transient using clip-start tempo rather than base tempo', async () => {
        mocks.clipStartTempo = 60;
        const onsetSample = 100 * HOP_SIZE;
        const buffer = stepBuffer(onsetSample, 180 * HOP_SIZE + FRAME_SIZE);
        arrangeClip({
            id: 'c1',
            audioBufferId: 'buf1',
            startBeat: 4,
            endBeat: 6,
            name: 'Drum',
            audioOffsetBeats: 1,
        });
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(true);
        expect(noteStartBeats()).toHaveLength(1);
        expect(noteStartBeats()[0]).toBeGreaterThan(0);
        expect(noteStartBeats()[0]).toBeLessThan(0.5);
    });

    it('writes no note for an onset past the clip audible end', async () => {
        const onsetSample = 200 * HOP_SIZE;
        const length = 280 * HOP_SIZE + FRAME_SIZE;
        const buffer = stepBuffer(onsetSample, length);
        arrangeClip({ id: 'c1', audioBufferId: 'buf1', startBeat: 0, endBeat: 4, name: 'Drum' });
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);

        const rawOnsets = detectOnsets(buffer, SENSITIVITY, MIN_INTERVAL_SEC);
        expect(rawOnsets.length).toBeGreaterThan(0);
        expect(rawOnsets[0]!.timeSec).toBeGreaterThan(4 / BEATS_PER_SECOND);

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(false);
        expect(noteCalls()).toHaveLength(0);
    });

    it('repeats an in-loop onset once per iteration and ignores buffer past the loop window', async () => {
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

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(true);
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

    it('places the first audible onset after a negative-offset pre-roll, not at beat 0', async () => {
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

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY })).toBe(true);
        const written = noteStartBeats();
        expect(written.length).toBeGreaterThan(0);
        const firstBeat = Math.min(...written);
        expect(firstBeat).not.toBeCloseTo(0, 1);
        expect(firstBeat).not.toBeCloseTo(rawStartBeat, 1);
        expect(firstBeat).toBeCloseTo(-audioOffsetBeats + rawStartBeat, 1);
        expect(firstBeat).toBeGreaterThan(1);
    });

    it('transcribes a trimmed loop from its anchored region, tail then wrapped head', async () => {
        // A clip looped at 0 (region source beats [0, 2)) and start-trimmed
        // to 1: the pass enters at phase 1, so each pass plays source beats
        // [1, 2) — the region tail — then wraps to [0, 1) — the region head.
        // Material past the region end (source beats [2, 3)) never sounds.
        // Transcribe in pitched mode: the notes must carry the tail's and the
        // wrapped head's pitches, one pair per pass, and never the pitch of
        // the silent material. The pre-anchor read
        // (`[offset, offset + loop)` = [1, 3) every pass) transcribed the
        // silent span and missed the wrapped head instead.
        //
        // Each span a read covers is filled with one continuous sine — quiet,
        // then loud past a detector hop so the amplitude step is the onset —
        // because the pitch window at a reported onset reaches back into the
        // pre-onset material and only resolves when that material is tone of
        // the same frequency. The pitches separate the spans: wrapped head
        // 660 Hz (midi 76), region tail 440 Hz (midi 69), past-the-end 880 Hz
        // (midi 81) — the last inside the pre-anchor read only.
        const tone = (from: number, to: number, freq: number, amp: number) => (index: number) =>
            index >= from && index < to ? amp * Math.sin((2 * Math.PI * freq * index) / SAMPLE_RATE) : 0;
        const HOP = 512;
        const step = 12 * HOP;
        const wrap = (index: number) =>
            index < step ? tone(0, 22050, 660, 0.06)(index) : tone(0, 22050, 660, 0.9)(index);
        const tail = (index: number) =>
            index < 22050 + step ? tone(22050, 44100, 440, 0.06)(index) : tone(22050, 44100, 440, 0.9)(index);
        const pastEnd = (index: number) =>
            index < 44100 + step ? tone(44100, 66150, 880, 0.06)(index) : tone(44100, 66150, 880, 0.9)(index);
        const buffer = makeBuffer(4 * SAMPLE_RATE, (index) => wrap(index) + tail(index) + pastEnd(index));
        arrangeClip({
            id: 'c1',
            audioBufferId: 'buf1',
            startBeat: 1,
            endBeat: 5,
            name: 'Looped',
            audioOffsetBeats: 1,
            loopEnabled: true,
            loopLength: 2,
            loopOriginBeat: 0,
        });
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);

        expect(await audioToMidi({ clipId: 'c1', trackId: 't1', sensitivity: SENSITIVITY, mode: 'pitched' })).toBe(
            true
        );

        const written = noteCalls().map((call) => ({
            pitch: call[1],
            startBeat: call[2],
        }));
        expect(written).toHaveLength(4);
        const sorted = written.slice().sort((left, right) => left.startBeat - right.startBeat);
        // Each pass: the region tail's A4 at its pass-relative read offset,
        // then the wrapped head's E5 one beat later. Beat tolerance carries
        // the onset detector's frame granularity; the pitches discriminate.
        const nearBeat = (beat: number, expected: number) => expect(Math.abs(beat - expected)).toBeLessThan(0.15);
        nearBeat(sorted[0]!.startBeat, 0.26);
        nearBeat(sorted[1]!.startBeat, 1.26);
        nearBeat(sorted[2]!.startBeat, 2.26);
        nearBeat(sorted[3]!.startBeat, 3.26);
        expect(sorted[0]!.pitch).toBe(69);
        expect(sorted[1]!.pitch).toBe(76);
        expect(sorted[2]!.pitch).toBe(69);
        expect(sorted[3]!.pitch).toBe(76);
        // The material past the region end (880 Hz) is never transcribed.
        for (const note of written) {
            expect(note.pitch).not.toBe(81);
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
