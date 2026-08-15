import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Clip, trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping, getSynthParamsForTrack } from '#/modules/Arrangement/useCases';
import {
    applyNoteExpression,
    ensureTrackStrip,
    getDrumKitByIndex,
    scheduleFaustNote,
} from '#/modules/AudioEngine/useCases';
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
import { isFaustInstrumentModule, registerFaustDSP } from '#/modules/PluginHost/useCases';
import { getDrumKitDefByIndex, scheduleDrumKitNote, scheduleKitNote, scheduleNote } from '#/modules/Synth/useCases';
import { processYeastMidi } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { scheduleFrozenTrack } from '../scheduleFrozenTrack';
import { scheduleMidiNotes, type SchedulerCancellation } from '../scheduleMidiNotes';

const shouldPlayProbability = vi.hoisted(() => vi.fn((_input: { eventId: string }) => true));
const registerScheduledSourceMock = vi.hoisted(() => vi.fn<(node: AudioScheduledSourceNode) => void>());

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
    registerScheduledSource: registerScheduledSourceMock,
    // The one definition of the MPE member default, as the production barrel
    // exports it (audit MD-8).
    getDefaultBendRangeSemitones: () => 48,
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
    resolveMidiNoteArticulationId: ({ deviceType, articulation }: { deviceType: string; articulation?: string }) =>
        deviceType === 'levain' && articulation === 'staccato' ? 8 : null,
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

/**
 * Registered through the real `registerFaustDSP`, not a stubbed lookup: the
 * `isInstrument` flag these fixtures carry is the same record
 * `createFaustStrategy` reads to decide `FaustDeviceStrategy.acceptsNotes`.
 * A hand-written fake registry here would let live and offline "agree" about a
 * module state neither one could actually be in.
 */
const PASSTHROUGH_DSP = 'process = _,_;';
const FAUST_INSTRUMENT_TYPE = registerFaustDSP('Synth', PASSTHROUGH_DSP, [], true).id;
const FAUST_EFFECT_TYPE = registerFaustDSP('Parity Fixture Reverb', PASSTHROUGH_DSP, [], false).id;

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

    // audit MD-6 — the built-in synth voice is a bare oscillator written into
    // the strip. Its handle used to be discarded, so neither transport stop nor
    // a panic could silence it before its programmed stop time.
    it('registers a scheduled built-in synth voice so a stop or panic can silence it', async () => {
        const voice = { stop: vi.fn() } as unknown as OscillatorNode & { _env: GainNode };
        vi.mocked(scheduleNote).mockReturnValueOnce(voice);
        const track = midiTrack({ clips: [midiClip()] });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0.25, duration: 0.25, velocity: 100 }] },
        };

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(scheduleNote).toHaveBeenCalledTimes(1);
        expect(registerScheduledSourceMock).toHaveBeenCalledExactlyOnceWith(voice);
    });

    // audit MD-8, review round 1 — MD-8 made the live path RPN-aware and left
    // playback pinned at the MPE default. Declare ±12, record a bend, play it
    // back: live sounded +6 semitones, playback +24. The note now carries the
    // range it was performed under and both scheduled sites read it.
    describe('recorded pitch-bend depth (live↔playback parity)', () => {
        function bentNote(overrides: Record<string, unknown>) {
            return {
                id: 'n1',
                pitch: 60,
                startBeat: 0.25,
                duration: 0.25,
                velocity: 100,
                // Half-scale bend: +4096 of 8192.
                pitchBend: 4096,
                ...overrides,
            };
        }

        function scheduleBentNote(note: Record<string, unknown>, devices?: unknown[]) {
            const track = midiTrack({ clips: [midiClip()], ...(devices ? { devices } : {}) });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = { notesByClipId: { 'clip-1': [note] } };
        }

        it('plays a built-in synth bend at the range it was recorded under', async () => {
            scheduleBentNote(bentNote({ pitchBendRangeSemitones: 12 }));

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            // scheduleNote(ctx, dest, pitch, time, duration, velocity, params, mpe, gain)
            const mpe = vi.mocked(scheduleNote).mock.calls[0]?.[7];
            expect(mpe?.pitchBend).toBe(4096);
            expect(mpe?.pitchBendRangeSemitones).toBe(12);
        });

        it('sounds that bend at the depth performed, not four times deeper', async () => {
            scheduleBentNote(bentNote({ pitchBendRangeSemitones: 12 }));

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            const mpe = vi.mocked(scheduleNote).mock.calls[0]?.[7];
            const soundedSemitones = ((mpe?.pitchBend ?? 0) / 8192) * (mpe?.pitchBendRangeSemitones ?? 0);
            // Half-scale bend at ±12 st. Re-interpreted at the MPE default it
            // would be +24 — the divergence this closes.
            expect(soundedSemitones).toBeCloseTo(6, 10);
        });

        it('omits the range entirely for a note that carries expression but never bent', async () => {
            // A range on a note with no bend describes nothing and the synth
            // never reads it. Emitting it would make every exact-shape
            // assertion downstream pin a fallback instead of a decision.
            scheduleBentNote({ id: 'n1', pitch: 60, startBeat: 0.25, duration: 0.25, velocity: 100, pressure: 64 });

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            const mpe = vi.mocked(scheduleNote).mock.calls[0]?.[7];
            expect(mpe?.pressure).toBe(64);
            expect(mpe).not.toHaveProperty('pitchBendRangeSemitones');
        });

        it('falls back to the MPE default for a note recorded before the range was captured', async () => {
            // Existing recordings carry no range and were performed at ±48.
            scheduleBentNote(bentNote({}));

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(vi.mocked(scheduleNote).mock.calls[0]?.[7]?.pitchBendRangeSemitones).toBe(48);
        });

        it('passes the recorded range to the worklet-synth expression surface', async () => {
            scheduleBentNote(bentNote({ pitchBendRangeSemitones: 12 }), [{ id: 'ferm-1', type: 'fermenter' }]);
            vi.mocked(ensureTrackStrip).mockReturnValue({
                gainNode: {},
                preFaderTap: { connect: vi.fn() },
                deviceNodes: [
                    {
                        deviceId: 'ferm-1',
                        type: 'fermenter',
                        fermenterControls: { ready: true, noteOn: vi.fn(), noteOff: vi.fn() },
                    },
                ],
            } as never);

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(applyNoteExpression).toHaveBeenCalledWith(expect.objectContaining({ bendRangeSemitones: 12 }));
        });

        it('defaults the worklet-synth range for a note with no recorded range', async () => {
            scheduleBentNote(bentNote({}), [{ id: 'ferm-1', type: 'fermenter' }]);
            vi.mocked(ensureTrackStrip).mockReturnValue({
                gainNode: {},
                preFaderTap: { connect: vi.fn() },
                deviceNodes: [
                    {
                        deviceId: 'ferm-1',
                        type: 'fermenter',
                        fermenterControls: { ready: true, noteOn: vi.fn(), noteOff: vi.fn() },
                    },
                ],
            } as never);

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(applyNoteExpression).toHaveBeenCalledWith(expect.objectContaining({ bendRangeSemitones: 48 }));
        });
    });

    // Crumbs' catalog id carries the `builtin-` prefix, so it was absent from
    // the worklet-synth table and a Crumbs track fell through to the fallback
    // sawtooth here — while the offline render, once Crumbs became renderable,
    // voiced the real sampler. Live and the export have to reach the same
    // engine, and the fallback substituting for a sampler is the "plausible
    // wrong instrument" failure, not a graceful degradation.
    it('routes a Crumbs track to its sampler rather than the fallback synth', async () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        const track = midiTrack({
            clips: [midiClip()],
            devices: [{ id: 'crumbs-1', type: 'builtin-crumbs' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [{ id: 'n1', pitch: 62, startBeat: 0.25, duration: 0.5, velocity: 96 }],
            },
        };
        vi.mocked(ensureTrackStrip).mockReturnValue({
            gainNode: {},
            preFaderTap: { connect: vi.fn() },
            deviceNodes: [
                {
                    deviceId: 'crumbs-1',
                    type: 'builtin-crumbs',
                    crumbsControls: { ready: true, noteOn, noteOff },
                },
            ],
        } as never);

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(scheduleNote).not.toHaveBeenCalled();
        // Every slot, not just pitch and velocity. Crumbs' node was written
        // against Toaster's pad order at first — `(pad, velocity, midiNote?,
        // sampleFrame?)` — which put this call's `sampleFrame` in a slot Crumbs
        // discards and its channel in `sampleFrame`, voicing every note at
        // frame 0. All four slots are `number`, so only asserting the values
        // catches it. At 120 bpm / 48 kHz, beat 0.25 is frame 6000 and the note
        // ends half a beat later at 18000.
        expect(noteOn.mock.calls[0]).toEqual([62, 96, 6000, 0]);
        expect(noteOff.mock.calls[0]).toEqual([62, 18000, 0]);
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
        expect(toasterNoteOn).toHaveBeenCalledWith(0, 100, 60, expect.any(Number));
        expect(transposeForChordTrack).not.toHaveBeenCalled();
    });

    it('maps direct Toaster-track GM notes to pads with neutral tuning', async () => {
        const toasterNoteOn = vi.fn();
        const parent = midiTrack({
            id: 'toaster-parent',
            clips: [midiClip()],
            devices: [{ id: 'toaster', type: 'toaster' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [parent] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [
                    { id: 'n1', pitch: 36, startBeat: 1, duration: 0.25, velocity: 100 },
                    { id: 'n2', pitch: 60, startBeat: 2, duration: 0.25, velocity: 90 },
                ],
            },
        };
        vi.mocked(ensureTrackStrip).mockReturnValue({
            gainNode: {},
            preFaderTap: { connect: vi.fn() },
            deviceNodes: [{ deviceId: 'toaster', type: 'toaster', toasterControls: { noteOn: toasterNoteOn } }],
        } as never);

        await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

        expect(toasterNoteOn).toHaveBeenNthCalledWith(1, 0, 100, 60, expect.any(Number));
        expect(toasterNoteOn).toHaveBeenNthCalledWith(2, 0, 90, 60, expect.any(Number));
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
            yeastRouteLineage: new Map(),
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

    it('does not recarry delayed route-owned Yeast output onto a later occurrence', async () => {
        const routeId = 'live-yeast:track-1:clip-1:0';
        const track = midiTrack({
            clips: [midiClip({ endBeat: 8, gain: 0.25, loopEnabled: true, loopLength: 2 })],
            devices: [{ id: 'y', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [{ id: 'n0', pitch: 60, startBeat: 0.25, duration: 0.25, velocity: 100 }],
            },
        };
        const cancellation = {
            generation: 1,
            discontinuityEpoch: 1,
            isCurrent: () => true,
            yeastRouteLineage: new Map(),
        };
        vi.mocked(processYeastMidi)
            .mockImplementationOnce(({ events }) => Promise.resolve([...events]))
            .mockResolvedValueOnce([
                {
                    timeSamples: 108_000,
                    timePpq: 4.5,
                    durationSamples: 12_000,
                    trackId: routeId,
                    noteInstanceId: `${routeId}:n0`,
                    kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                },
            ]);

        await scheduleMidiNotes(0, 1, 0, -1, new Set<string>(), [], defaultTransportState, 120, cancellation);
        vi.mocked(scheduleNote).mockClear();
        await scheduleMidiNotes(4, 5, 4, 4, new Set<string>(), [], defaultTransportState, 120, cancellation);

        expect(scheduleNote).not.toHaveBeenCalled();
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
                // This note carries no recorded range, so it plays at the depth
                // it was performed at before RPN 0 was decoded (audit MD-8).
                bendRangeSemitones: 48,
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
                // No bend, so no range — this assertion keeps its original
                // exact shape rather than gaining a pinned fallback.
            });
        });
    });

    describe('per-track dispatch decision (§154.3)', () => {
        it('routes a drum-kit-def track through scheduleDrumKitNote', async () => {
            vi.mocked(getDrumKitDefByIndex).mockReturnValue({ id: 'kit-1', voices: [] } as never);
            const track = midiTrack({
                clips: [midiClip()],
                devices: [{ id: 'dk', type: 'builtin-drum-kit', parameterValues: { kit: 0 } }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 36, startBeat: 0, duration: 0.25, velocity: 110 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleDrumKitNote).toHaveBeenCalledTimes(1);
            expect(scheduleKitNote).not.toHaveBeenCalled();
            expect(scheduleNote).not.toHaveBeenCalled();
        });

        it('routes a resolved-drum-kit track through scheduleKitNote with the note duration', async () => {
            // clearAllMocks() in beforeEach resets call counts but NOT the
            // mockReturnValue the drum-kit-def test set on getDrumKitDefByIndex;
            // that residual would make resolveDrumKitDef truthy and steal the
            // dispatch into the scheduleDrumKitNote arm. Reset both resolvers so
            // the kit-def arm is null and resolveDrumKit wins.
            vi.mocked(getDrumKitDefByIndex).mockReturnValue(null);
            vi.mocked(getDrumKitByIndex).mockReturnValue({
                id: 'kit-a',
                voices: [{ name: 'kick', pitchRange: [35, 42], params: {} as never }],
            } as never);
            const track = midiTrack({
                clips: [midiClip()],
                devices: [{ id: 'dk', type: 'builtin-drum-kit', parameterValues: { kit: 0 } }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 38, startBeat: 0, duration: 0.5, velocity: 95 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleKitNote).toHaveBeenCalledTimes(1);
            // The resolved kit (not the kit-def) carries the note duration, so the
            // call reaches scheduleKitNote rather than the one-shot drumKitDef path.
            expect(scheduleDrumKitNote).not.toHaveBeenCalled();
            expect(scheduleNote).not.toHaveBeenCalled();
        });

        it('routes a faust-device track through scheduleFaustNote', async () => {
            const track = midiTrack({
                clips: [midiClip()],
                devices: [{ id: 'f1', type: FAUST_INSTRUMENT_TYPE }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.5, velocity: 80 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleFaustNote).toHaveBeenCalledTimes(1);
            // (trackId, deviceId, pitch, time, duration, velocity, noteGain)
            expect(scheduleFaustNote).toHaveBeenCalledWith(
                'track-1',
                'f1',
                60,
                expect.any(Number),
                expect.any(Number),
                80,
                1
            );
            expect(scheduleNote).not.toHaveBeenCalled();
        });

        /**
         * A MIDI track whose only Faust device is an *effect* has no instrument.
         * Writing freq/gain/gate into a reverb voices nothing, and because the
         * Faust branch is an `else if`, taking it also skips the builtin-synth
         * fallback — the part is silent live while the export renders it.
         */
        it('falls back to the builtin synth when the track carries only a faust effect', async () => {
            const track = midiTrack({
                clips: [midiClip()],
                devices: [{ id: 'fx1', type: FAUST_EFFECT_TYPE }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.5, velocity: 80 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleFaustNote).not.toHaveBeenCalled();
            expect(scheduleNote).toHaveBeenCalledTimes(1);
            // The fallback voices the note the clip actually holds, not a
            // placeholder: pitch 60 at velocity 80.
            expect(vi.mocked(scheduleNote).mock.calls[0]?.[2]).toBe(60);
            expect(vi.mocked(scheduleNote).mock.calls[0]?.[5]).toBe(80);
        });

        /**
         * Convergence, not one-sided correctness. `isFaustInstrumentModule` is the
         * predicate the offline path bottoms out in: `buildDeviceChain` injects it
         * into `createFaustStrategy`, which stores it as `FaustDeviceStrategy.acceptsNotes`,
         * which is the only thing that gives a chain entry `instrumentControls` —
         * and `scheduleTrackClips` picks its offline note target by
         * `deviceEntries.find((entry) => entry.instrumentControls)`. `isOfflineInstrumentDevice`
         * returns the same flag for the dry-bounce insert filter.
         *
         * So asserting live's routing decision *equals* that predicate for both
         * kinds of Faust module is the same statement as "live and offline send
         * this track's notes to the same device". A test that only asserted live
         * no longer matches effects would go green again the next time the two
         * predicates drift apart.
         */
        it.each([
            { label: 'instrument', deviceType: FAUST_INSTRUMENT_TYPE },
            { label: 'effect', deviceType: FAUST_EFFECT_TYPE },
        ])(
            'routes a faust $label exactly as the offline instrument predicate classifies it',
            async ({ deviceType }) => {
                const track = midiTrack({
                    clips: [midiClip()],
                    devices: [{ id: 'faust-device', type: deviceType }],
                });
                (trackStore as { value: unknown }).value = { tracks: [track] };
                (midiStore as { value: unknown }).value = {
                    notesByClipId: {
                        'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.5, velocity: 80 }],
                    },
                };

                await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

                const offlineAcceptsNotes = isFaustInstrumentModule(deviceType);
                const liveSentNotesToTheFaustDevice = vi.mocked(scheduleFaustNote).mock.calls.length > 0;
                expect(liveSentNotesToTheFaustDevice).toBe(offlineAcceptsNotes);
                // And the note is voiced either way — exactly one of the two
                // targets takes it, so neither side can converge by both doing
                // nothing.
                const faustCalls = vi.mocked(scheduleFaustNote).mock.calls.length;
                const fallbackCalls = vi.mocked(scheduleNote).mock.calls.length;
                expect(faustCalls + fallbackCalls).toBe(1);
            }
        );

        it('passes a Levain note its canonical per-note articulation without changing pitch, velocity, or frame', async () => {
            const noteOn = vi.fn();
            const noteOff = vi.fn();
            vi.mocked(ensureTrackStrip).mockImplementation(
                () =>
                    ({
                        gainNode: {},
                        preFaderTap: { connect: vi.fn() },
                        deviceNodes: [
                            {
                                type: 'levain',
                                deviceId: 'levain-1',
                                levainControls: { noteOn, noteOff, noteExpression: vi.fn() },
                            },
                        ],
                    }) as never
            );
            const track = midiTrack({
                clips: [midiClip()],
                devices: [{ id: 'levain-1', type: 'levain' }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [
                        {
                            id: 'n1',
                            pitch: 62,
                            startBeat: 0.25,
                            duration: 0.5,
                            velocity: 96,
                            channel: 4,
                            articulation: 'staccato',
                        },
                    ],
                },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(noteOn).toHaveBeenCalledOnce();
            expect(noteOn).toHaveBeenCalledWith(62, 96, 6_000, 4, 8);
            expect(noteOff).toHaveBeenCalledWith(62, 18_000, 4);
        });

        it('routes a grand-boule worklet synth and normalises velocity by /127', async () => {
            const noteOn = vi.fn();
            const noteOff = vi.fn();
            vi.mocked(ensureTrackStrip).mockImplementation(
                () =>
                    ({
                        gainNode: {},
                        preFaderTap: { connect: vi.fn() },
                        deviceNodes: [
                            {
                                type: 'grand-boule',
                                deviceId: 'gb-1',
                                grandBouleControls: { noteOn, noteOff, noteExpression: vi.fn() },
                            },
                        ],
                    }) as never
            );
            const track = midiTrack({
                clips: [midiClip()],
                devices: [{ id: 'gb-1', type: 'grand-boule' }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.5, velocity: 127 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            // grand-boule velocityTransform divides by 127 → 1.0.
            expect(noteOn).toHaveBeenCalledWith(60, 1, expect.any(Number), 0);
            // A note carrying no channel resolves to the base channel on the
            // release as well as the attack. `toHaveBeenCalled()` alone was
            // what let the slot the channel goes in stay wrong here.
            expect(noteOff).toHaveBeenCalledWith(60, expect.any(Number), undefined, 0);
        });

        it('releases a grand-boule note on its member channel, not through the release-velocity slot', async () => {
            // Grand Boule is the one worklet synth whose `noteOff` reads a
            // release velocity in slot 3 and its member channel in slot 4;
            // Fermenter, Levain and Crumbs take the channel in slot 3. Calling
            // the shared three-argument form put the channel index where the
            // release dynamic goes and left the release unaddressed, so it
            // silenced every voice at that pitch. All four control types accept
            // three numbers, so nothing but this assertion sees it.
            const noteOn = vi.fn();
            const noteOff = vi.fn();
            vi.mocked(ensureTrackStrip).mockImplementation(
                () =>
                    ({
                        gainNode: {},
                        preFaderTap: { connect: vi.fn() },
                        deviceNodes: [
                            {
                                type: 'grand-boule',
                                deviceId: 'gb-1',
                                grandBouleControls: { noteOn, noteOff, noteExpression: vi.fn() },
                            },
                        ],
                    }) as never
            );
            const track = midiTrack({
                clips: [midiClip()],
                devices: [{ id: 'gb-1', type: 'grand-boule' }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.5, velocity: 127, channel: 3 }],
                },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(noteOff).toHaveBeenCalledWith(60, expect.any(Number), undefined, 3);
        });

        it('routes through the default synth (scheduleNote) with MPE when a note carries expression', async () => {
            const track = midiTrack({ clips: [midiClip()] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.5, velocity: 90, pressure: 64 }],
                },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleNote).toHaveBeenCalledTimes(1);
            // 8th arg is the mpe object.
            expect(vi.mocked(scheduleNote).mock.calls[0]![7]).toEqual({
                pressure: 64,
                slide: undefined,
                pitchBend: undefined,
            });
        });

        it('passes undefined MPE to the default synth for an unexpressed note', async () => {
            const track = midiTrack({ clips: [midiClip()] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.5, velocity: 90 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(vi.mocked(scheduleNote).mock.calls[0]![7]).toBeUndefined();
        });
    });

    describe('note-window filtering', () => {
        it('bounds projection work for a dense non-looping clip', async () => {
            const track = midiTrack({ clips: [midiClip({ endBeat: 128 })] });
            const notes = Array.from({ length: 1_280 }, (_, index) => ({
                id: `n${index}`,
                pitch: 60,
                startBeat: index / 10,
                duration: index === 0 ? 128 : 0.05,
                velocity: 100,
            })).reverse();
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = { notesByClipId: { 'clip-1': notes } };

            await scheduleMidiNotes(64, 65, 64, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(projectClipMidiEvents).toHaveBeenCalledTimes(30);
            expect(scheduleNote).toHaveBeenCalledTimes(10);
        });

        it('preserves persisted note order inside a bounded non-looping window', async () => {
            const track = midiTrack({ clips: [midiClip()] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [
                        { id: 'late', pitch: 62, startBeat: 2, duration: 0.25, velocity: 100 },
                        { id: 'early', pitch: 60, startBeat: 0, duration: 0.25, velocity: 100 },
                        { id: 'middle', pitch: 61, startBeat: 1, duration: 0.25, velocity: 100 },
                    ],
                },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            const projectedIds = vi.mocked(projectClipMidiEvents).mock.calls.map(([input]) => input.events[0]!.id);
            expect(projectedIds).toEqual(['late', 'early', 'middle']);
            expect(vi.mocked(scheduleNote).mock.calls.map((call) => call[2])).toEqual([62, 60, 61]);
        });

        it('projects only loop occurrences that intersect the scheduler window', async () => {
            const track = midiTrack({
                clips: [midiClip({ endBeat: 128, loopEnabled: true, loopLength: 4 })],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [{ id: 'loop-note', pitch: 60, startBeat: 0.25, duration: 0.25, velocity: 100 }],
                },
            };

            await scheduleMidiNotes(64, 65, 64, 64, new Set<string>(), [], defaultTransportState, 120);

            expect(projectClipMidiEvents).toHaveBeenCalledTimes(1);
            expect(scheduleNote).toHaveBeenCalledTimes(1);
            expect(shouldPlayMidiEvent).toHaveBeenCalledWith(
                expect.objectContaining({ eventId: 'loop-note', absoluteOccurrenceIndex: 16 })
            );
        });

        it('keeps tiny-loop projection bounded to the live scheduler window', async () => {
            const track = midiTrack({
                clips: [midiClip({ endBeat: 10, loopEnabled: true, loopLength: 1 / 480 })],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [{ id: 'loop-note', pitch: 60, startBeat: 0, duration: 1 / 960, velocity: 100 }],
                },
            };

            await scheduleMidiNotes(4, 4.01, 4, 4, new Set<string>(), [], defaultTransportState, 120);

            expect(projectClipMidiEvents).toHaveBeenCalledTimes(5);
            expect(scheduleNote).toHaveBeenCalledTimes(4);
        });

        it('bounds projection work for a dense looping clip', async () => {
            const track = midiTrack({
                clips: [midiClip({ endBeat: 256, loopEnabled: true, loopLength: 128 })],
            });
            const notes = Array.from({ length: 1_280 }, (_, index) => ({
                id: `n${index}`,
                pitch: 60,
                startBeat: index / 10,
                duration: index === 0 ? 128 : 0.05,
                velocity: 100,
            })).reverse();
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = { notesByClipId: { 'clip-1': notes } };

            await scheduleMidiNotes(64, 65, 64, 64, new Set<string>(), [], defaultTransportState, 120);

            expect(projectClipMidiEvents).toHaveBeenCalledTimes(30);
            expect(scheduleNote).toHaveBeenCalledTimes(10);
        });

        it('bounds Yeast loop work while retaining a prior occurrence release in the window', async () => {
            const track = midiTrack({
                clips: [midiClip({ endBeat: 128, loopEnabled: true, loopLength: 4 })],
                devices: [{ id: 'yeast-1', type: 'yeast' }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [{ id: 'long-note', pitch: 60, startBeat: 0, duration: 5, velocity: 100 }],
                },
            };

            await scheduleMidiNotes(4.5, 5.5, 4.5, 4.5, new Set<string>(), [], defaultTransportState, 120);

            expect(shouldPlayMidiEvent).toHaveBeenCalledTimes(1);
            expect(shouldPlayMidiEvent).toHaveBeenCalledWith(
                expect.objectContaining({ eventId: 'long-note', absoluteOccurrenceIndex: 0 })
            );
            expect(processYeastMidi).toHaveBeenCalledWith(
                expect.objectContaining({
                    events: [
                        expect.objectContaining({
                            noteInstanceId: 'live-yeast:track-1:clip-1:0:long-note',
                            kind: { type: 'noteOff', channel: 0, note: 60 },
                        }),
                    ],
                })
            );
        });

        it('retains a leading interval when the clip starts at the scheduler high-water mark', async () => {
            const track = midiTrack({ clips: [midiClip({ startBeat: 4, endBeat: 8 })] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [{ id: 'leading', pitch: 60, startBeat: -2, duration: 7, velocity: 100 }],
                },
            };
            vi.mocked(projectClipMidiEvents).mockImplementationOnce((input) =>
                input.events.map((event) => ({ ...event, startBeat: 4, duration: 1 }))
            );

            await scheduleMidiNotes(4, 5, 4, 4, new Set<string>(), [], defaultTransportState, 120);

            expect(projectClipMidiEvents).toHaveBeenCalledTimes(1);
            expect(scheduleNote).toHaveBeenCalledTimes(1);
        });

        it('skips a note whose start beat is before lastScheduledBeat', async () => {
            const track = midiTrack({ clips: [midiClip()] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 1, duration: 0.25, velocity: 100 }] },
            };

            // lastScheduledBeat=5 ⇒ note at beat 1 (<=5) is dropped.
            await scheduleMidiNotes(0, 4, 0, 5, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleNote).not.toHaveBeenCalled();
        });

        it('skips a note whose start beat is outside the [fromBeat, toBeat) window', async () => {
            const track = midiTrack({ clips: [midiClip({ startBeat: 8, endBeat: 12 })] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            // Note lands at beat 9; window is 0..4 ⇒ outside.
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 1, duration: 0.25, velocity: 100 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleNote).not.toHaveBeenCalled();
            expect(projectClipMidiEvents).not.toHaveBeenCalled();
            expect(getSynthParamsForTrack).not.toHaveBeenCalled();
            expect(ensureTrackStrip).not.toHaveBeenCalled();
            expect(resolveClipsWithComping).not.toHaveBeenCalled();
        });

        it('reuses an active-clip index instead of rescanning project-wide geometry', async () => {
            let geometryReads = 0;
            const clips = Array.from({ length: 2_048 }, (_, index) => {
                const startBeat = index * 2;
                const clip = midiClip({ id: `clip-${index}` });
                Object.defineProperties(clip, {
                    startBeat: {
                        enumerable: true,
                        get: () => {
                            geometryReads++;
                            return startBeat;
                        },
                    },
                    endBeat: {
                        enumerable: true,
                        get: () => {
                            geometryReads++;
                            return startBeat + 1;
                        },
                    },
                });
                return clip;
            });
            const track = midiTrack({ clips });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = { notesByClipId: {} };

            await scheduleMidiNotes(2_048, 2_049, 2_048, 2_048, new Set<string>(), [], defaultTransportState, 120);
            geometryReads = 0;
            await scheduleMidiNotes(2_048, 2_049, 2_048, 2_048, new Set<string>(), [], defaultTransportState, 120);

            expect(geometryReads).toBeLessThan(100);
            expect(resolveClipsWithComping).toHaveBeenLastCalledWith('track-1', [clips[1_024]]);
        });

        it('skips a clip whose loopLen collapses to <= 0 (startBeat === endBeat)', async () => {
            const track = midiTrack({ clips: [midiClip({ startBeat: 4, endBeat: 4 })] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.25, velocity: 100 }] },
            };

            await scheduleMidiNotes(0, 8, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleNote).not.toHaveBeenCalled();
        });

        it('skips a clip with no notes in the midi store', async () => {
            const track = midiTrack({ clips: [midiClip()] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = { notesByClipId: {} };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleNote).not.toHaveBeenCalled();
        });

        it('skips a non-midi clip and a muted clip', async () => {
            const track = midiTrack({
                clips: [
                    midiClip({ id: 'audio-clip', type: 'audio', muted: false }),
                    midiClip({ id: 'muted-clip', muted: true }),
                ],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'audio-clip': [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.25, velocity: 100 }],
                    'muted-clip': [{ id: 'n2', pitch: 61, startBeat: 0, duration: 0.25, velocity: 100 }],
                },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleNote).not.toHaveBeenCalled();
        });

        it('skips a non-midi track kind and a muted track', async () => {
            (trackStore as { value: unknown }).value = {
                tracks: [midiTrack({ id: 'audio-trk', kind: 'audio' }), midiTrack({ id: 'muted-trk', muted: true })],
            };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {},
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleNote).not.toHaveBeenCalled();
        });

        it('drops a note beyond the loop length on a non-looping iteration', async () => {
            const track = midiTrack({ clips: [midiClip({ startBeat: 0, endBeat: 2 })] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            // Note authored at startBeat 3 but loopLen=2 → 3 - 0 >= 2 ⇒ dropped.
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 3, duration: 0.25, velocity: 100 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(scheduleNote).not.toHaveBeenCalled();
        });
    });

    describe('toaster child pad fallback (no canonical route)', () => {
        it('derives the pad from pitch when the child has no canonical pad index', async () => {
            const toasterNoteOn = vi.fn();
            // Parent has the toaster device + controls, but the child is NOT found
            // in the parentId scan (pad stays -1) → pitch-derived pad branch.
            const parent = midiTrack({
                id: 'toaster-parent',
                kind: 'folder',
                devices: [{ id: 'toaster', type: 'toaster' }],
            });
            const child = midiTrack({
                id: 'orphan-child',
                parentId: 'toaster-parent',
                clips: [midiClip()],
            });
            (trackStore as { value: unknown }).value = { tracks: [parent, child] };
            // pitch 60 → pad = 60-36 = 24 → 24>=24 && <=39 → pad=0 (fallback fold).
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 1, duration: 0.25, velocity: 100 }] },
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

            // The note reaches the toaster; pitch 60 yields pad 0 via the fold.
            expect(toasterNoteOn).toHaveBeenCalledWith(0, 100, 60, expect.any(Number));
        });
    });

    describe('early-exit and store-null branches', () => {
        it('treats a null tempo map as an empty changes list (?? [])', async () => {
            (tempoMapStore as { value: unknown }).value = null;
            const track = midiTrack({ clips: [midiClip()] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0.5, duration: 0.25, velocity: 100 }] },
            };

            // No throw — the nullish coalesce keeps beatToSamples on [] changes.
            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            expect(vi.mocked(scheduleNote)).toHaveBeenCalledTimes(1);
        });

        it('halts the per-track loop when the cancellation token flips stale before a track', async () => {
            const trackA = midiTrack({ id: 'a', clips: [midiClip({ id: 'clip-a' })] });
            const trackB = midiTrack({ id: 'b', clips: [midiClip({ id: 'clip-b' })] });
            (trackStore as { value: unknown }).value = { tracks: [trackA, trackB] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-a': [{ id: 'n1', pitch: 60, startBeat: 0.5, duration: 0.25, velocity: 100 }],
                    'clip-b': [{ id: 'n2', pitch: 62, startBeat: 0.5, duration: 0.25, velocity: 100 }],
                },
            };
            // isCurrent returns true for track A's guard, bounded iteration,
            // note-loop guard, and note dispatch, then false at track B's guard.
            let calls = 0;
            const cancellation: SchedulerCancellation = {
                generation: 0,
                discontinuityEpoch: 0,
                isCurrent: () => ++calls <= 4,
                yeastRouteLineage: new Map(),
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120, cancellation);

            // Track A passes the guard (scheduled); the loop returns before B.
            expect(vi.mocked(scheduleNote)).toHaveBeenCalledTimes(1);
        });

        it('halts the per-note loop when the cancellation token flips stale mid-clip', async () => {
            const track = midiTrack({ clips: [midiClip()] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': [
                        { id: 'n1', pitch: 60, startBeat: 0.5, duration: 0.25, velocity: 100 },
                        { id: 'n2', pitch: 62, startBeat: 1.5, duration: 0.25, velocity: 100 },
                    ],
                },
            };
            // isCurrent is true for the track and bounded-iteration guards, then
            // false at the first note-loop check.
            let calls = 0;
            const cancellation: SchedulerCancellation = {
                generation: 0,
                discontinuityEpoch: 0,
                isCurrent: () => ++calls <= 2,
                yeastRouteLineage: new Map(),
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120, cancellation);

            expect(vi.mocked(scheduleNote)).not.toHaveBeenCalled();
        });

        it('does not project loop notes after cancellation turns stale at the occurrence boundary', async () => {
            const track = midiTrack({
                clips: [midiClip({ endBeat: 128, loopEnabled: true, loopLength: 4 })],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: {
                    'clip-1': Array.from({ length: 100 }, (_, index) => ({
                        id: `off-window-${index}`,
                        pitch: 60,
                        startBeat: 2,
                        duration: 0.25,
                        velocity: 100,
                    })),
                },
            };
            let calls = 0;
            const cancellation: SchedulerCancellation = {
                generation: 0,
                discontinuityEpoch: 0,
                isCurrent: () => ++calls <= 2,
                yeastRouteLineage: new Map(),
            };

            await scheduleMidiNotes(64, 65, 64, 64, new Set<string>(), [], defaultTransportState, 120, cancellation);

            expect(projectClipMidiEvents).not.toHaveBeenCalled();
        });

        it('skips a yeast track clip whose visual length collapses to zero (loopLength <= 0)', async () => {
            const track = midiTrack({
                devices: [{ id: 'yeast', type: 'yeast' }],
                clips: [midiClip({ startBeat: 2, endBeat: 2 })],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.25, velocity: 100 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            // The collapsed clip yields no live-yeast iteration and no default synth call.
            expect(processYeastMidi).not.toHaveBeenCalled();
            expect(vi.mocked(scheduleNote)).not.toHaveBeenCalled();
        });

        it('skips a frozen track whose status is frozen but no buffer id is set', async () => {
            const track = midiTrack({
                clips: [midiClip()],
                freezeState: { status: 'frozen' },
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 0.5, duration: 0.25, velocity: 100 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            // No buffer id → not a real freeze; the frozen-schedule arm is skipped
            // and the clip flows through the normal synth path.
            expect(vi.mocked(scheduleFrozenTrack)).not.toHaveBeenCalled();
            expect(vi.mocked(scheduleNote)).toHaveBeenCalledTimes(1);
        });

        it('resolves toaster swing to 0 when every fallback in the chain is absent', async () => {
            const toasterNoteOn = vi.fn();
            const parent = midiTrack({
                id: 'toaster-parent',
                kind: 'folder',
                // automationMode absent; toasterStore null; parameterValues has no swing.
                devices: [{ id: 'toaster', type: 'toaster', parameterValues: {} }],
            });
            const child = midiTrack({ parentId: 'toaster-parent', clips: [midiClip()] });
            (trackStore as { value: unknown }).value = { tracks: [parent, child] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 36, startBeat: 1, duration: 0.25, velocity: 100 }] },
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

            // swingOffsetBeats falls through to 0; sampleFrame = round(time*sr) with no swing delta.
            expect(toasterNoteOn).toHaveBeenCalledTimes(1);
        });

        it('skips chord transposition when a drum kit owns the track', async () => {
            vi.mocked(getDrumKitDefByIndex).mockReturnValue(null);
            vi.mocked(getDrumKitByIndex).mockReturnValue({ id: 'kit-a', voices: [] } as never);
            const track = midiTrack({
                followChordTrack: true,
                clips: [midiClip()],
                devices: [{ id: 'dk', type: 'builtin-drum-kit', parameterValues: { kit: 0 } }],
            });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 38, startBeat: 0.5, duration: 0.25, velocity: 90 }] },
            };

            await scheduleMidiNotes(0, 4, 0, -1, new Set<string>(), [], defaultTransportState, 120);

            // Drum kits keep raw pitch; the chord-transpose arm is short-circuited.
            expect(transposeForChordTrack).not.toHaveBeenCalled();
            expect(scheduleKitNote).toHaveBeenCalledTimes(1);
        });
    });
});
