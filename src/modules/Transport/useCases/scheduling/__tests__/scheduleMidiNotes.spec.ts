import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import {
    resolveClipsWithComping,
    getSynthParamsForTrack,
    projectSequencerGroove,
} from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { projectClipMidiEvents, projectCommittedGroove } from '#/modules/MIDI/useCases';
import { scheduleNote } from '#/modules/Synth/useCases';
import { processYeastMidi } from '#/modules/Yeast/useCases';

import { beatToSamples } from '../../../models/TempoMap';
import { defaultTransportState } from '../../../models/TransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { scheduleMidiNotes, type SchedulerCancellation } from '../scheduleMidiNotes';

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
}));
vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));
vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: { changes: [] } },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: vi.fn((_trackId, clips) => clips),
    getSynthParamsForTrack: vi.fn(() => ({})),
    projectSequencerGroove: vi.fn((event) => event),
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
    scheduleFaustNote: vi.fn(),
}));
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: vi.fn(() => null),
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: vi.fn(),
}));
vi.mock('#/modules/Yeast/useCases', () => ({
    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: vi.fn(() => ({ earlyBeats: 0.5, lateBeats: 0.5 })),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    getChordAtBeat: vi.fn(),
    projectCommittedGroove: vi.fn(({ events }) => events),
    projectClipMidiEvents: vi.fn(),
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
        (tempoMapStore as { value: unknown }).value = { changes: [] };
        (timeSignatureMapStore as { value: unknown }).value = { changes: [] };
        vi.mocked(resolveClipsWithComping).mockImplementation((_trackId, clips) =>
            clips.map((clip) => ({ ...clip, regionStartBeat: clip.startBeat, regionEndBeat: clip.endBeat }))
        );
        vi.mocked(projectSequencerGroove).mockImplementation((event) => event);
        vi.mocked(projectClipMidiEvents).mockImplementation((input) =>
            input.events.flatMap((event) => {
                const rawStartBeat = input.eventsAreAbsolute
                    ? event.startBeat
                    : input.iterationStartBeat + (event.startBeat - input.midiOffsetBeats);
                const projected = projectSequencerGroove({
                    id: event.id,
                    startBeat: rawStartBeat,
                    velocity: event.velocity,
                });
                const startBeat = Math.max(input.iterationStartBeat, input.clipStartBeat, projected.startBeat);
                const endBeat = Math.min(input.clipEndBeat, startBeat + event.duration);
                return endBeat <= startBeat
                    ? []
                    : [{ ...event, startBeat, duration: endBeat - startBeat, velocity: projected.velocity }];
            })
        );
        vi.mocked(projectCommittedGroove).mockImplementation(({ events }) => events);
        vi.mocked(processYeastMidi).mockImplementation(async (input) => [...input.events]);
    });

    it('does not schedule synth when MIDI store is uninitialized', async () => {
        await scheduleMidiNotes(0, 4, 0, 0, [], defaultTransportState, 120);

        expect(getSynthParamsForTrack).not.toHaveBeenCalled();
    });

    it('projects the clip assignment before committed playback scheduling', async () => {
        const track = midiTrack({ clips: [midiClip()] });
        const source = [{ id: 'n1', pitch: 60, startBeat: 0.25, duration: 0.25, velocity: 100 }];
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = { notesByClipId: { 'clip-1': source } };
        vi.mocked(projectCommittedGroove).mockReturnValue([{ ...source[0]!, startBeat: 0.3, velocity: 80 }]);

        await scheduleMidiNotes(0, 4, 0, -1, [], defaultTransportState, 120);

        expect(projectCommittedGroove).toHaveBeenCalledWith({
            events: source,
            consumerType: 'clip',
            consumerId: 'clip-1',
        });
        expect(vi.mocked(scheduleNote).mock.calls[0]?.[5]).toBe(80);
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

        vi.mocked(processYeastMidi).mockResolvedValue([
            { timeSamples: 24000, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 90 } },
            { timeSamples: 48000, kind: { type: 'noteOff', channel: 0, note: 64 } },
        ]);

        await scheduleMidiNotes(0, 4, 0, -1, [], defaultTransportState, 120);

        expect(processYeastMidi).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 'track-1',
            })
        );

        // The generated note reaches the synth as a complete note built from the
        // default template (rather than being dropped or silently malformed).
        // scheduleNote(ctx, gain, pitch, time, duration, velocity, params, mpe, gain).
        expect(scheduleNote).toHaveBeenCalledTimes(1);
        const call = vi.mocked(scheduleNote).mock.calls[0]!;
        expect(call[2]).toBe(64); // pitch from the generator
        expect(call[5]).toBe(90); // velocity carried through, not garbled
        // Probability defaults to 100 from the template, so the note is not gated out.
    });

    it('drops transformed MIDI when the scheduler generation is cancelled during Yeast processing', async () => {
        const track = midiTrack({ clips: [midiClip()], devices: [{ id: 'y', type: 'yeast' }] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        };

        type YeastProcessResult = Awaited<ReturnType<typeof processYeastMidi>>;
        let resolveYeast!: (events: YeastProcessResult) => void;
        const pendingYeast = new Promise<YeastProcessResult>((resolve) => {
            resolveYeast = resolve;
        });
        vi.mocked(processYeastMidi).mockReturnValueOnce(pendingYeast);
        let current = true;
        const cancellation: SchedulerCancellation = {
            generation: 1,
            isCurrent: () => current,
        };

        const scheduling = scheduleMidiNotes(0, 4, 0, -1, [], defaultTransportState, 120, cancellation);
        await Promise.resolve();
        current = false;
        resolveYeast([
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
            { timeSamples: 48000, kind: { type: 'noteOff', channel: 0, note: 64 } },
        ]);

        await scheduling;

        expect(scheduleNote).not.toHaveBeenCalled();
    });

    // §2 — A looping Yeast clip must run the Worker once per loop iteration so a
    // bar-aware processor sees iter-correct event positions, instead of running
    // once and replaying one iteration's output at every offset.
    it('runs the Yeast Worker per loop iteration over a looping clip (§2)', async () => {
        const track = midiTrack({
            clips: [midiClip({ endBeat: 8, loopEnabled: true, loopLength: 2 })],
            devices: [{ id: 'y', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        // One source note at clip-relative beat 0 — it recurs at each loop iteration.
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        };

        // Record the noteOn sample positions the Worker sees per call. The
        // processor echoes its input back so we observe per-iteration placement.
        const seenNoteOnSamples: number[][] = [];
        const processYeast = vi.fn<typeof processYeastMidi>(async (input) => {
            const events = input.events;
            seenNoteOnSamples.push(events.filter((e) => e.kind.type === 'noteOn').map((e) => e.timeSamples));
            return [...events];
        });
        vi.mocked(processYeastMidi).mockImplementation(processYeast);

        // clip endBeat 8, loopLength 2 => ceil(8/2) = 4 iterations.
        await scheduleMidiNotes(0, 8, 0, -1, [], defaultTransportState, 120);

        // The Worker ran once per iteration (was once total before the fix).
        expect(processYeast).toHaveBeenCalledTimes(4);
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
        (tempoMapStore as { value: unknown }).value = {
            changes: [{ id: 'tempo-0', beat: 0, tempo: 240, curve: 'instant' }],
        };

        let seenNoteOnSample: number | undefined;
        const processYeast = vi.fn<typeof processYeastMidi>(async (input) => {
            seenNoteOnSample = input.events.find((e) => e.kind.type === 'noteOn')?.timeSamples;
            return [...input.events];
        });
        vi.mocked(processYeastMidi).mockImplementation(processYeast);

        await scheduleMidiNotes(0, 4, 0, -1, [], defaultTransportState, 120);

        // spb = 240/60 = 4; beat 1 => round(1 * 48000 / 4) = 12000.
        // Flat-tempo (buggy) spb = 120/60 = 2 would give 24000.
        expect(seenNoteOnSample).toBe(12000);
    });

    it('uses integrated samples and drains a spanning note-off in the post-change Worker block', async () => {
        const track = midiTrack({
            clips: [midiClip({ endBeat: 8 })],
            devices: [{ id: 'y', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [{ id: 'n0', pitch: 60, startBeat: 3, duration: 2, velocity: 100 }],
            },
        };
        (tempoMapStore as { value: unknown }).value = {
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-1', beat: 4, tempo: 240, curve: 'instant' },
            ],
        };
        type YeastMidiEvent = Awaited<ReturnType<typeof processYeastMidi>>[number];
        const retained: YeastMidiEvent[] = [];
        const processYeast = vi.fn<typeof processYeastMidi>(async (input) => {
            retained.push(...input.events);
            const due = retained.filter((event) => event.timeSamples < input.blockEndSamples);
            const future = retained.filter((event) => event.timeSamples >= input.blockEndSamples);
            retained.splice(0, retained.length, ...future);
            return due;
        });
        vi.mocked(processYeastMidi).mockImplementation(processYeast);

        await scheduleMidiNotes(3, 6, 3, -1, [], defaultTransportState, 120);

        expect(processYeast).toHaveBeenCalledTimes(2);
        expect(processYeast.mock.calls.map(([input]) => input.blockStartSamples)).toEqual([72000, 96000]);
        expect(processYeast.mock.calls.map(([input]) => input.blockEndSamples)).toEqual([96000, 120000]);
        expect(processYeast.mock.calls.map(([input]) => input.transport)).toEqual([
            expect.objectContaining({ bpm: 120, ppqPosition: 3 }),
            expect.objectContaining({ bpm: 240, ppqPosition: 4 }),
        ]);
        expect(processYeast.mock.calls[0]![0].events.map((event) => event.timeSamples)).toEqual([72000, 108000]);
        expect(processYeast.mock.calls[1]![0].events).toEqual([]);
        expect(retained).toEqual([]);
        expect(scheduleNote).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleNote).mock.calls[0]![4]).toBe(0.75);
    });

    it.each([
        {
            label: 'instant',
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' as const },
                { id: 'tempo-1', beat: 4, tempo: 240, curve: 'instant' as const },
            ],
        },
        {
            label: 'ramp',
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'linear' as const },
                { id: 'tempo-1', beat: 8, tempo: 240, curve: 'instant' as const },
            ],
        },
    ])('maps worker-adjusted PPQ through the full $label tempo map', async ({ changes }) => {
        const track = midiTrack({ clips: [midiClip({ endBeat: 8 })], devices: [{ id: 'y', type: 'yeast' }] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n-ppq', pitch: 60, startBeat: 3.5, duration: 1, velocity: 100 }] },
        };
        (tempoMapStore as { value: unknown }).value = { changes };
        let emitted = false;
        vi.mocked(processYeastMidi).mockImplementation(async () => {
            if (emitted) {
                return [];
            }
            emitted = true;
            return [
                {
                    timeSamples: 1_000,
                    timePpq: 3.75,
                    kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
                },
                {
                    timeSamples: 2_000,
                    timePpq: 4.25,
                    kind: { type: 'noteOff' as const, channel: 0, note: 60 },
                },
            ];
        });

        await scheduleMidiNotes(3, 5, 3, -1, [], defaultTransportState, 120);

        const startSamples = beatToSamples(changes, 3.75, 120, 48_000);
        const endSamples = beatToSamples(changes, 4.25, 120, 48_000);
        const accumulatedSamples = beatToSamples(changes, 3, 120, 48_000);
        expect(vi.mocked(scheduleNote).mock.calls[0]?.[3]).toBeCloseTo((startSamples - accumulatedSamples) / 48_000, 8);
        expect(vi.mocked(scheduleNote).mock.calls[0]?.[4]).toBeCloseTo((endSamples - startSamples) / 48_000, 8);
    });

    it('admits a future source note early enough for a negative Yeast projection and schedules it once', async () => {
        const track = midiTrack({ clips: [midiClip()], devices: [{ id: 'y', type: 'yeast' }] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [{ id: 'n-lookahead', pitch: 60, startBeat: 1.2, duration: 0.25, velocity: 100 }],
            },
        };
        vi.mocked(processYeastMidi).mockImplementation(async (input) =>
            input.events.flatMap((event) => {
                if (event.kind.type !== 'noteOn' || event.sourceEventId === undefined) {
                    return [];
                }
                return [
                    { ...event, timeSamples: 21_600, timePpq: 0.9 },
                    {
                        timeSamples: 27_600,
                        trackId: event.trackId,
                        sourceEventId: `${event.sourceEventId}:projected-off`,
                        kind: { type: 'noteOff' as const, channel: event.kind.channel, note: event.kind.note },
                    },
                ];
            })
        );

        await scheduleMidiNotes(0, 1, 0, -1, [], defaultTransportState, 120);

        expect(processYeastMidi).toHaveBeenCalledWith(
            expect.objectContaining({
                events: expect.arrayContaining([
                    expect.objectContaining({
                        sourceEventId: expect.stringContaining('n-lookahead'),
                        timePpq: 1.2,
                        tempoBpm: 120,
                    }),
                ]),
            })
        );
        expect(scheduleNote).toHaveBeenCalledTimes(1);
    });

    it('rejects an absolute Yeast output below the lower half-open bound after a source epoch change', async () => {
        const track = midiTrack({ clips: [midiClip()], devices: [{ id: 'y', type: 'yeast' }] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [{ id: 'n-seek-regression', pitch: 60, startBeat: 1.2, duration: 0.25, velocity: 100 }],
            },
        };
        let admittedSourceId: string | undefined;
        vi.mocked(processYeastMidi).mockImplementation(async (input) => {
            admittedSourceId = input.events.find((event) => event.kind.type === 'noteOn')?.sourceEventId;
            return [
                {
                    timeSamples: 18_000,
                    timePpq: 0.75,
                    kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
                },
                {
                    timeSamples: 24_000,
                    timePpq: 1,
                    kind: { type: 'noteOff' as const, channel: 0, note: 60 },
                },
            ];
        });
        const cancellation: SchedulerCancellation = {
            generation: 3,
            isCurrent: () => true,
            sourceEpoch: () => 9,
        };

        await scheduleMidiNotes(1, 2, 1, 1, [], defaultTransportState, 120, cancellation);

        expect(admittedSourceId).toMatch(/^9:/);
        expect(scheduleNote).not.toHaveBeenCalled();
    });

    it('preserves project-sequencer dynamics through the instrument sink', async () => {
        const track = midiTrack({ clips: [midiClip()] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n-dynamics', pitch: 60, startBeat: 1, duration: 0.25, velocity: 100 }] },
        };
        vi.mocked(projectSequencerGroove).mockImplementation((event) => ({ ...event, velocity: 37 }));

        await scheduleMidiNotes(0, 2, 0, -1, [], defaultTransportState, 120);

        expect(projectSequencerGroove).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'n-dynamics', startBeat: 1, velocity: 100 })
        );
        expect(vi.mocked(scheduleNote).mock.calls[0]?.[5]).toBe(37);
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
        const processYeast = vi.fn<typeof processYeastMidi>((input) => {
            seenTransport = input.transport;
            return Promise.resolve([]);
        });
        vi.mocked(processYeastMidi).mockImplementation(processYeast);

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
        vi.mocked(projectSequencerGroove).mockImplementation((event) => ({
            ...event,
            startBeat: event.startBeat - 1,
        }));

        await scheduleMidiNotes(0, 4, 0, -1, [], defaultTransportState, 120);

        // Old behaviour: noteStartBeat (-1) < clip.startBeat (0) => dropped.
        // New behaviour: clamped to the iteration start (0) and scheduled.
        expect(scheduleNote).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleNote).mock.calls[0]![2]).toBe(60);
    });
});
