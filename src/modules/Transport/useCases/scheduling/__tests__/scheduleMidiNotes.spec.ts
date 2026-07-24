import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Clip, trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping, getSynthParamsForTrack } from '#/modules/Arrangement/useCases';
import { applyNoteExpression, ensureTrackStrip } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat } from '#/modules/Automation/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    getChordAtBeat,
    projectClipMidiEvents,
    projectCommittedGroove,
    shouldPlayMidiEvent,
    transposeForChordTrack,
} from '#/modules/MIDI/useCases';
import { scheduleNote } from '#/modules/Synth/useCases';
import { processYeastMidi } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { scheduleFrozenTrack } from '../scheduleFrozenTrack';
import { scheduleMidiNotes, type SchedulerCancellation } from '../scheduleMidiNotes';

const shouldPlayProbability = vi.hoisted(() => vi.fn((_input: { eventId: string }) => true));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
}));
vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));
vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { value: null },
}));
vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
}));
vi.mock('#/modules/Toaster/stores', () => ({ toasterStore: { value: null } }));
vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: { changes: [] } },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: vi.fn((_trackId: string, clips: Clip[]) =>
        clips.map((clip) => ({
            ...clip,
            regionStartBeat: clip.startBeat,
            regionEndBeat: clip.endBeat,
            sourceStartBeat: clip.startBeat,
        }))
    ),
    getSynthParamsForTrack: vi.fn(() => ({})),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    applyNoteExpression: vi.fn(),
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
    getYeastSchedulingLookahead: vi.fn(() => ({ earlyBeats: 0, lateBeats: 0 })),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    getChordAtBeat: vi.fn(),
    projectClipMidiEvents: vi.fn(),
    projectCommittedGroove: vi.fn(({ events }: { events: readonly unknown[] }) => events),
    transposeForChordTrack: vi.fn((param: unknown) => param),
    shouldPlayMidiEvent: shouldPlayProbability,
}));
vi.mock('../scheduleFrozenTrack', () => ({
    scheduleFrozenTrack: vi.fn(() => true),
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

function midiClip(overrides: Record<string, unknown> = {}): Clip {
    return {
        id: 'clip-1',
        type: 'midi',
        muted: false,
        startBeat: 0,
        endBeat: 4,
        gain: 1,
        loopEnabled: false,
        ...overrides,
    } as Clip;
}

describe('scheduleMidiNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (trackStore as { value: unknown }).value = { tracks: [] };
        (midiStore as { value: unknown }).value = null;
        (automationStore as { value: unknown }).value = null;
        (tempoMapStore as { value: unknown }).value = { changes: [] };
        (timeSignatureMapStore as { value: unknown }).value = { changes: [] };
        vi.mocked(resolveClipsWithComping).mockImplementation((_trackId, clips) =>
            clips.map((clip) => ({
                ...clip,
                regionStartBeat: clip.startBeat,
                regionEndBeat: clip.endBeat,
                sourceStartBeat: clip.startBeat,
            }))
        );
        vi.mocked(projectClipMidiEvents).mockImplementation((input) =>
            input.events.map((event) => ({
                ...event,
                startBeat: input.eventsAreAbsolute
                    ? event.startBeat
                    : input.iterationStartBeat + event.startBeat - input.midiOffsetBeats,
            }))
        );
        vi.mocked(processYeastMidi).mockImplementation((input) => Promise.resolve([...input.events]));
        vi.mocked(projectCommittedGroove).mockImplementation(({ events }) => events);
        vi.mocked(ensureTrackStrip).mockImplementation(
            () =>
                ({
                    gainNode: {},
                    preFaderTap: { connect: vi.fn() },
                    deviceNodes: [],
                }) as never
        );
        shouldPlayProbability.mockImplementation(() => true);
    });

    it('schedules a frozen MIDI track once per playback session, not on every tick', async () => {
        const track = midiTrack({
            clips: [midiClip()],
            freezeState: { status: 'frozen', frozenBufferId: 'frozen-buffer-1' },
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = { notesByClipId: {} };

        // Two consecutive scheduler ticks over the same frozen track. The whole
        // frozen buffer is scheduled in one shot, so the second tick must not
        // layer another copy (the audio path dedups via scheduledFrozenTracks).
        const scheduledFrozenTracks = new Set<string>();
        await scheduleMidiNotes(0, 4, 0, -1, scheduledFrozenTracks, [], defaultTransportState, 120);
        await scheduleMidiNotes(0.2, 4.2, 0.2, -1, scheduledFrozenTracks, [], defaultTransportState, 120);

        expect(vi.mocked(scheduleFrozenTrack)).toHaveBeenCalledTimes(1);
    });

    // Regression (PR #514 review): the dedup Set was keyed by track.id only, so
    // an unfreeze → refreeze within one session (new frozenBufferId, same id)
    // kept the old dedup entry and the refrozen track stayed silent until the
    // next session. The key must include the buffer id so a refreeze reschedules.
    it('reschedules a frozen MIDI track after an unfreeze → refreeze with a new buffer within the session', async () => {
        (midiStore as { value: unknown }).value = { notesByClipId: {} };
        const scheduledFrozenTracks = new Set<string>();

        const frozenV1 = midiTrack({
            clips: [midiClip()],
            freezeState: { status: 'frozen', frozenBufferId: 'frozen-buffer-1' },
        });
        (trackStore as { value: unknown }).value = { tracks: [frozenV1] };
        await scheduleMidiNotes(0, 4, 0, -1, scheduledFrozenTracks, [], defaultTransportState, 120);
        // Next tick, same buffer: still deduped.
        await scheduleMidiNotes(0.2, 4.2, 0.2, -1, scheduledFrozenTracks, [], defaultTransportState, 120);
        expect(vi.mocked(scheduleFrozenTrack)).toHaveBeenCalledTimes(1);

        // Refreeze mid-session: same track.id, new frozen render. The dedup
        // entry for buffer 1 must not suppress scheduling buffer 2.
        const frozenV2 = midiTrack({
            clips: [midiClip()],
            freezeState: { status: 'frozen', frozenBufferId: 'frozen-buffer-2' },
        });
        (trackStore as { value: unknown }).value = { tracks: [frozenV2] };
        await scheduleMidiNotes(0.4, 4.4, 0.4, -1, scheduledFrozenTracks, [], defaultTransportState, 120);

        expect(vi.mocked(scheduleFrozenTrack)).toHaveBeenCalledTimes(2);
        expect(scheduledFrozenTracks.has('track-1:frozen-buffer-1')).toBe(true);
        expect(scheduledFrozenTracks.has('track-1:frozen-buffer-2')).toBe(true);
    });

    it('does not schedule synth when MIDI store is uninitialized', async () => {
        await scheduleMidiNotes(0, 4, 0, 0, new Set<string>(), [], defaultTransportState, 120);

        expect(getSynthParamsForTrack).not.toHaveBeenCalled();
    });

    it('should project the canonical clip assignment before transport scheduling', async () => {
        const track = midiTrack({ clips: [midiClip()] });
        const source = [{ id: 'n1', pitch: 60, startBeat: 0.25, duration: 0.25, velocity: 100 }];
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = { notesByClipId: { 'clip-1': source } };
        vi.mocked(projectClipMidiEvents).mockReturnValue([{ ...source[0]!, startBeat: 0.5, velocity: 40 }]);

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(projectClipMidiEvents).toHaveBeenCalledWith({
            events: [source[0]],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 4,
            iterationStartBeat: 0,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
            loopEnabled: false,
            clipGrooveAlreadyApplied: false,
            eventsAreAbsolute: false,
        });
        expect(vi.mocked(scheduleNote).mock.calls[0]?.[3]).toBe(0.25);
        expect(vi.mocked(scheduleNote).mock.calls[0]?.[5]).toBe(40);
    });

    it('does not chord-project live Toaster child notes', async () => {
        const toasterNoteOn = vi.fn();
        const parent = midiTrack({
            id: 'toaster-parent',
            kind: 'folder',
            devices: [{ id: 'toaster', type: 'toaster' }],
        });
        const child = midiTrack({
            parentId: 'toaster-parent',
            clips: [midiClip()],
            followChordTrack: true,
        });
        (trackStore as { value: unknown }).value = { tracks: [parent, child] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [{ id: 'n1', pitch: 36, startBeat: 1, duration: 0.25, velocity: 100 }],
            },
        };
        vi.mocked(ensureTrackStrip).mockImplementation(
            (trackId) =>
                ({
                    gainNode: {},
                    preFaderTap: { connect: vi.fn() },
                    deviceNodes:
                        trackId === 'toaster-parent'
                            ? [{ deviceId: 'toaster', type: 'toaster', toasterControls: { noteOn: toasterNoteOn } }]
                            : [],
                }) as never
        );

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(toasterNoteOn).toHaveBeenCalledTimes(1);
        expect(transposeForChordTrack).not.toHaveBeenCalled();
    });

    it('applies the parent Toaster swing lane to live child-note timing', async () => {
        const toasterNoteOn = vi.fn();
        const parent = midiTrack({
            id: 'toaster-parent',
            kind: 'folder',
            automationMode: 'read',
            devices: [
                {
                    id: 'toaster',
                    type: 'toaster',
                    parameterValues: {},
                },
                { id: 'toaster-b', type: 'toaster', parameterValues: {} },
            ],
        });
        const child = midiTrack({
            parentId: 'toaster-parent',
            clips: [midiClip()],
            devices: [{ id: 'yeast', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [parent, child] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [{ id: 'n1', pitch: 36, startBeat: 1.25, duration: 0.25, velocity: 100 }],
            },
        };
        (automationStore as { value: unknown }).value = {
            lanes: [
                {
                    id: 'other-swing-lane',
                    trackId: 'toaster-parent',
                    parameterId: 'toaster-b:swing',
                    enabled: true,
                },
                {
                    id: 'swing-lane',
                    trackId: 'toaster-parent',
                    parameterId: 'toaster:swing',
                    enabled: true,
                },
            ],
        };
        vi.mocked(getAutomationValueAtBeat).mockImplementation((laneId) => (laneId === 'swing-lane' ? 0.4 : 1));
        vi.mocked(ensureTrackStrip).mockImplementation(
            (trackId) =>
                ({
                    gainNode: {},
                    preFaderTap: { connect: vi.fn() },
                    deviceNodes:
                        trackId === 'toaster-parent'
                            ? [{ deviceId: 'toaster', type: 'toaster', toasterControls: { noteOn: toasterNoteOn } }]
                            : [],
                }) as never
        );

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(processYeastMidi).toHaveBeenCalled();
        expect(toasterNoteOn.mock.calls[0]?.[3]).toBe(31_200);
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
            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);
            return vi.mocked(scheduleNote).mock.calls.map((call) => call[2]);
        }

        shouldPlayProbability.mockImplementation(({ eventId }: { eventId: string }) => {
            const index = Number(eventId.slice('note-'.length));
            return index % 2 === 0;
        });

        const first = await pitchesFromRun();
        const second = await pitchesFromRun();

        // Same seed inputs => identical gating decisions, every run.
        expect(second).toEqual(first);
        // Sanity: 50% gating actually drops some of the 16 notes (not all-or-nothing).
        expect(first.length).toBeGreaterThan(0);
        expect(first.length).toBeLessThan(notes.length);
    });

    it('keys equal-position probability decisions by persisted seed and stable event id', async () => {
        const track = midiTrack({ clips: [midiClip()] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            probabilitySeed: 0xdecafbad,
            notesByClipId: {
                'clip-1': [
                    { id: 'event-alpha', pitch: 60, startBeat: 1, duration: 0.25, velocity: 100, probability: 50 },
                    { id: 'event-beta', pitch: 61, startBeat: 1, duration: 0.25, velocity: 100, probability: 50 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        shouldPlayProbability.mockImplementation(({ eventId }: { eventId: string }) => eventId === 'event-alpha');

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(vi.mocked(scheduleNote).mock.calls.map((call) => call[2])).toEqual([60]);
        expect(shouldPlayMidiEvent).toHaveBeenCalledWith({
            projectProbabilitySeed: 0xdecafbad,
            clipId: 'clip-1',
            eventId: 'event-alpha',
            absoluteOccurrenceIndex: 0,
            probabilityPercent: 50,
        });
        expect(shouldPlayMidiEvent).toHaveBeenCalledWith({
            projectProbabilitySeed: 0xdecafbad,
            clipId: 'clip-1',
            eventId: 'event-beta',
            absoluteOccurrenceIndex: 0,
            probabilityPercent: 50,
        });
    });

    it('keeps probability occurrence anchored to the source loop through a comp segment', async () => {
        const sourceClip = midiClip({ startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 2 });
        const track = midiTrack({ clips: [sourceClip] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            probabilitySeed: 0xdecafbad,
            notesByClipId: {
                'clip-1': [
                    { id: 'event-alpha', pitch: 60, startBeat: 0.5, duration: 0.25, velocity: 100, probability: 50 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        vi.mocked(resolveClipsWithComping).mockReturnValue([
            {
                ...sourceClip,
                startBeat: 4,
                endBeat: 6,
                regionStartBeat: 4,
                regionEndBeat: 6,
                sourceStartBeat: 0,
            },
        ]);

        await scheduleMidiNotes(4, 6, 4, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(shouldPlayMidiEvent).toHaveBeenCalledWith({
            projectProbabilitySeed: 0xdecafbad,
            clipId: 'clip-1',
            eventId: 'event-alpha',
            absoluteOccurrenceIndex: 2,
            probabilityPercent: 50,
        });
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

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(processYeastMidi).toHaveBeenCalledWith(
            expect.objectContaining({
                rackId: 'y',
                routeId: 'track-1',
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

    it('routes grooved generator notes by their final carrier and clips the note tail', async () => {
        const firstClip = midiClip({ id: 'clip-1', startBeat: 0, endBeat: 2 });
        const secondClip = midiClip({ id: 'clip-2', startBeat: 2.5, endBeat: 4 });
        const track = midiTrack({
            clips: [firstClip, secondClip],
            followChordTrack: true,
            devices: [{ id: 'y', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = { notesByClipId: { 'clip-1': [], 'clip-2': [] } };
        vi.mocked(processYeastMidi).mockResolvedValue([
            {
                timeSamples: 42_000,
                timePpq: 1.75,
                kind: { type: 'noteOn', channel: 0, note: 64, velocity: 90 },
            },
            {
                timeSamples: 54_000,
                timePpq: 2.25,
                kind: { type: 'noteOn', channel: 0, note: 65, velocity: 80 },
            },
            { timeSamples: 72_000, timePpq: 3, kind: { type: 'noteOff', channel: 0, note: 65 } },
            { timeSamples: 120_000, timePpq: 5, kind: { type: 'noteOff', channel: 0, note: 64 } },
        ]);
        vi.mocked(projectCommittedGroove).mockImplementation(({ events }) =>
            events.map((event) => ({ ...event, startBeat: event.startBeat + 1 }))
        );

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(getChordAtBeat).toHaveBeenCalledWith(2.5);
        expect(getChordAtBeat).toHaveBeenCalledWith(2.75);
        expect(getChordAtBeat).not.toHaveBeenCalledWith(0);
        expect(scheduleNote).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleNote).mock.calls[0]?.[4]).toBe(0.625);
    });

    it('pairs an equal-sample Note Off only when it follows the Note On in stable event order', async () => {
        const track = midiTrack({ clips: [midiClip()], devices: [{ id: 'y', type: 'yeast' }] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }] },
        };
        vi.mocked(processYeastMidi).mockResolvedValue([
            { timeSamples: 24000, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
            { timeSamples: 24000, kind: { type: 'noteOff', channel: 0, note: 60 } },
        ]);

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(scheduleNote).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleNote).mock.calls[0]![4]).toBe(0);
    });

    it('does not pair an equal-sample Note Off that precedes its Note On', async () => {
        const track = midiTrack({ clips: [midiClip()], devices: [{ id: 'y', type: 'yeast' }] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }] },
        };
        vi.mocked(processYeastMidi).mockResolvedValue([
            { timeSamples: 24000, kind: { type: 'noteOff', channel: 0, note: 60 } },
            { timeSamples: 24000, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
        ]);

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(scheduleNote).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleNote).mock.calls[0]![4]).toBe(0.125);
    });

    it('preserves the ChordGenerator strum boundary when an off shares the latest on sample', async () => {
        const track = midiTrack({ clips: [midiClip()], devices: [{ id: 'y', type: 'yeast' }] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }] },
        };
        vi.mocked(processYeastMidi).mockResolvedValue([
            { timeSamples: 24000, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
            { timeSamples: 24240, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
            { timeSamples: 24480, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
            { timeSamples: 24480, kind: { type: 'noteOff', channel: 0, note: 60 } },
            { timeSamples: 24480, kind: { type: 'noteOff', channel: 0, note: 64 } },
            { timeSamples: 24480, kind: { type: 'noteOff', channel: 0, note: 67 } },
        ]);

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        const durationByPitch = new Map(vi.mocked(scheduleNote).mock.calls.map((call) => [call[2], call[4]] as const));
        expect(durationByPitch.get(60)).toBe(0);
        expect(durationByPitch.get(64)).toBeCloseTo(0.005, 12);
        expect(durationByPitch.get(67)).toBeCloseTo(0.01, 12);
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
            discontinuityEpoch: 1,
            isCurrent: () => current,
        };

        const scheduling = scheduleMidiNotes(
            0,
            4,
            0,
            -1,
            new Set<string>(),
            [],
            defaultTransportState,
            120,
            cancellation
        );
        await Promise.resolve();
        expect(processYeastMidi).toHaveBeenCalledWith(
            expect.objectContaining({
                transport: expect.objectContaining({ discontinuityEpoch: 1 }),
            })
        );
        current = false;
        resolveYeast([
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
            { timeSamples: 48000, kind: { type: 'noteOff', channel: 0, note: 64 } },
        ]);

        await scheduling;

        expect(scheduleNote).not.toHaveBeenCalled();
    });

    // §2 — A looping Yeast clip must feed every visible iteration into one rack
    // transaction so stateful processors advance once per scheduler block.
    it('runs one Yeast rack pass containing every looping clip iteration (§2)', async () => {
        const track = midiTrack({
            clips: [midiClip({ endBeat: 8, loopEnabled: true, loopLength: 2 })],
            devices: [{ id: 'y', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        // One source note at clip-relative beat 0 — it recurs at each loop iteration.
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        };

        // The processor echoes its input so route-preserved source notes can be
        // projected back through their owning iterations.
        let seenNoteOnSamples: number[] = [];
        const processYeast = vi.fn<typeof processYeastMidi>((input) => {
            const events = input.events;
            seenNoteOnSamples = events
                .filter((event) => event.kind.type === 'noteOn')
                .map((event) => event.timeSamples);
            return Promise.resolve([...events]);
        });
        vi.mocked(processYeastMidi).mockImplementation(processYeast);

        // clip endBeat 8, loopLength 2 => ceil(8/2) = 4 iterations.
        await scheduleMidiNotes(0, 8, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(processYeast).toHaveBeenCalledTimes(1);
        expect(processYeast).toHaveBeenCalledWith(expect.objectContaining({ preserveInputTrackIds: true }));
        expect(seenNoteOnSamples).toEqual([0, 48000, 96000, 144000]);
    });

    it('schedules track-scoped generator output in a narrow later-loop window', async () => {
        const track = midiTrack({
            clips: [midiClip({ endBeat: 8, loopEnabled: true, loopLength: 2 })],
            devices: [{ id: 'y', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n0', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        };
        vi.mocked(processYeastMidi).mockResolvedValue([
            {
                timeSamples: 144000,
                timePpq: 6,
                trackId: 'track-1',
                kind: { type: 'noteOn', channel: 0, note: 64, velocity: 90 },
            },
            {
                timeSamples: 168000,
                timePpq: 7,
                trackId: 'track-1',
                kind: { type: 'noteOff', channel: 0, note: 64 },
            },
        ]);

        await scheduleMidiNotes(6, 8, 6, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(processYeastMidi).toHaveBeenCalledTimes(1);
        expect(processYeastMidi).toHaveBeenCalledWith(
            expect.objectContaining({
                blockStartSamples: 144000,
                blockEndSamples: 192000,
                preserveInputTrackIds: true,
            })
        );
        expect(scheduleNote).toHaveBeenCalledTimes(1);
        const scheduled = vi.mocked(scheduleNote).mock.calls[0]!;
        expect(scheduled[2]).toBe(64);
        expect(scheduled[3]).toBe(0);
        expect(scheduled[4]).toBe(0.5);
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

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

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
            return Promise.resolve(due);
        });
        vi.mocked(processYeastMidi).mockImplementation(processYeast);

        await scheduleMidiNotes(3, 6, 3, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(processYeast).toHaveBeenCalledTimes(2);
        expect(processYeast.mock.calls.map(([input]) => input.blockStartSamples)).toEqual([72000, 96000]);
        expect(processYeast.mock.calls.map(([input]) => input.blockEndSamples)).toEqual([96000, 120000]);
        expect(processYeast.mock.calls.map(([input]) => input.transport)).toEqual([
            expect.objectContaining({ bpm: 120, ppqPosition: 3 }),
            expect.objectContaining({ bpm: 240, ppqPosition: 4 }),
        ]);
        expect(processYeast.mock.calls[0]![0].events.map((event) => event.timeSamples)).toEqual([72000]);
        expect(processYeast.mock.calls[1]![0].events.map((event) => event.timeSamples)).toEqual([108000]);
        expect(retained).toEqual([]);
        expect(scheduleNote).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleNote).mock.calls[0]![4]).toBe(0.75);
    });

    it('feeds each raw event to one owning block while draining a delayed Yeast note once', async () => {
        const track = midiTrack({
            clips: [midiClip({ endBeat: 8 })],
            devices: [{ id: 'y', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [{ id: 'n0', pitch: 60, startBeat: 3.9, duration: 0.2, velocity: 100 }],
            },
        };
        type YeastMidiEvent = Awaited<ReturnType<typeof processYeastMidi>>[number];
        const retained: YeastMidiEvent[] = [];
        const processYeast = vi.fn<typeof processYeastMidi>((input) => {
            for (const event of input.events) {
                retained.push({
                    ...event,
                    timeSamples: event.timeSamples + 4_800,
                    timePpq: (event.timePpq ?? 0) + 0.2,
                });
            }
            const due = retained.filter((event) => event.timeSamples < input.blockEndSamples);
            const future = retained.filter((event) => event.timeSamples >= input.blockEndSamples);
            retained.splice(0, retained.length, ...future);
            return Promise.resolve(due);
        });
        vi.mocked(processYeastMidi).mockImplementation(processYeast);

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);
        await scheduleMidiNotes(4, 8, 4, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(processYeast.mock.calls[0]![0].events.map((event) => event.kind.type)).toEqual(['noteOn']);
        expect(processYeast.mock.calls[1]![0].events.map((event) => event.kind.type)).toEqual(['noteOff']);
        expect(scheduleNote).toHaveBeenCalledTimes(1);
        expect(retained).toEqual([]);
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
        await scheduleMidiNotes(6, 10, 6, -1, new Set<string>(), [], { ...defaultTransportState }, 120);

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
        vi.mocked(projectClipMidiEvents).mockImplementation((input) =>
            input.events.map((event) => ({ ...event, startBeat: input.iterationStartBeat }))
        );

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        // Old behaviour: noteStartBeat (-1) < clip.startBeat (0) => dropped.
        // New behaviour: clamped to the iteration start (0) and scheduled.
        expect(scheduleNote).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleNote).mock.calls[0]![2]).toBe(60);
    });

    // audit MD-2 — a recorded MPE note must sound its captured expression on
    // playback, through the same surface the live Web MIDI handlers use.
    describe('MPE per-note expression on scheduled playback', () => {
        function fermenterStripWithNoteCapture() {
            const noteOn = vi.fn();
            vi.mocked(ensureTrackStrip).mockImplementation(
                () =>
                    ({
                        gainNode: {},
                        preFaderTap: { connect: vi.fn() },
                        deviceNodes: [
                            {
                                type: 'fermenter',
                                deviceId: 'device-1',
                                fermenterControls: { noteOn, noteOff: vi.fn(), noteExpression: vi.fn() },
                            },
                        ],
                    }) as never
            );
            return noteOn;
        }

        it('applies the captured pressure, slide and bend at the note own start frame', async () => {
            const noteOn = fermenterStripWithNoteCapture();
            const track = midiTrack({
                clips: [midiClip()],
                devices: [{ id: 'device-1', type: 'fermenter' }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [
                        {
                            id: 'n0',
                            pitch: 64,
                            startBeat: 0,
                            duration: 1,
                            velocity: 100,
                            pressure: 90,
                            slide: 20,
                            pitchBend: -4096,
                            channel: 3,
                        },
                    ],
                },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(noteOn).toHaveBeenCalledTimes(1);
            const noteSampleFrame = vi.mocked(noteOn).mock.calls[0]![2] as number;
            expect(applyNoteExpression).toHaveBeenCalledTimes(1);
            expect(applyNoteExpression).toHaveBeenCalledWith({
                trackId: 'track-1',
                note: 64,
                channel: 3,
                expression: { pressure: 90, slide: 20, pitchBend: -4096 },
                sampleFrame: noteSampleFrame,
            });
            // The note-on and note-off carry the same member channel, so the
            // engine can address this note rather than the pitch.
            expect(vi.mocked(noteOn).mock.calls[0]![3]).toBe(3);
        });

        it('forwards an unexpressive note as three neutral dimensions, never a stale value', async () => {
            fermenterStripWithNoteCapture();
            const track = midiTrack({
                clips: [midiClip()],
                devices: [{ id: 'device-1', type: 'fermenter' }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [{ id: 'n0', pitch: 64, startBeat: 0, duration: 1, velocity: 100 }],
                },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(applyNoteExpression).toHaveBeenCalledWith({
                trackId: 'track-1',
                note: 64,
                channel: 0,
                expression: { pressure: undefined, slide: undefined, pitchBend: undefined },
                sampleFrame: expect.any(Number),
            });
        });
    });
});
