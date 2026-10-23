import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Clip, trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import {
    applyNoteExpression,
    ensureTrackStrip,
    getCompensationDelay,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { projectClipMidiEvents } from '#/modules/MIDI/useCases';
import { processYeastMidi } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { disposePlayheadScheduler } from '../../playheadScheduler/disposePlayheadScheduler';
import { forgetHeldNoteExpression } from '../forgetHeldNoteExpression';
import { heldNotesByTrack } from '../heldNoteExpressionState';
import { scheduleMidiNotes } from '../scheduleMidiNotes';

// What a stored bend becomes at a frame is the contract under test: the engine's curve projection and
// its dimension registry, and the MIDI module's channel bend projection, are the real ones, and only the
// engine surface around them (the instrument nodes and the audio clock) is doubled.
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: { tracks: [] }, subscribe: () => () => undefined },
}));
vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: { value: null, subscribe: () => () => undefined },
}));
vi.mock('#/modules/Automation/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/stores')>()),
    automationStore: { value: null, subscribe: () => () => undefined },
}));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
}));
vi.mock('#/modules/Toaster/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Toaster/stores')>()),
    toasterStore: { value: null, subscribe: () => () => undefined },
}));
vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: { changes: [] } },
}));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
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
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    applyNoteExpression: vi.fn(),
    registerScheduledSource: vi.fn(),
    getCompensationDelay: vi.fn(() => 0),
    ensureTrackStrip: vi.fn(),
    getCurrentTime: vi.fn(() => 0),
    getAudioContext: vi.fn(() => ({ sampleRate: 48_000, createGain: vi.fn(() => ({ connect: vi.fn() })) })),
    scheduleFaustNote: vi.fn(),
}));
vi.mock('../scheduleFrozenTrack', () => ({ scheduleFrozenTrack: vi.fn(() => true) }));
vi.mock('#/modules/Synth/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Synth/useCases')>()),
    getDrumKitDefByIndex: vi.fn(() => null),
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: vi.fn(),
}));
vi.mock('#/modules/Yeast/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Yeast/useCases')>()),
    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: vi.fn(() => ({ earlyBeats: 0, lateBeats: 0 })),
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    projectClipMidiEvents: vi.fn(),
    projectCommittedGroove: vi.fn(({ events }: { events: readonly unknown[] }) => events),
    shouldPlayMidiEvent: () => true,
}));

/** At 120 BPM and 48 kHz a beat is half a second. */
const FRAMES_PER_BEAT = 24_000;

type InstrumentUnderTest = { type: string; controlsKey: string };

const FERMENTER: InstrumentUnderTest = { type: 'fermenter', controlsKey: 'fermenterControls' };
const LEVAIN: InstrumentUnderTest = { type: 'levain', controlsKey: 'levainControls' };
const GRAND_BOULE: InstrumentUnderTest = { type: 'grand-boule', controlsKey: 'grandBouleControls' };
const CRUMBS: InstrumentUnderTest = { type: 'builtin-crumbs', controlsKey: 'crumbsControls' };

function midiTrack(
    instrument: InstrumentUnderTest,
    clips: Clip[],
    devices?: { id: string; type: string; bypassed?: boolean }[],
    overrides: Record<string, unknown> = {}
) {
    return {
        id: 'track-1',
        kind: 'midi',
        muted: false,
        parentId: null,
        followChordTrack: false,
        devices: devices ?? [{ id: 'device-1', type: instrument.type }],
        clips,
        sends: [],
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
        endBeat: 8,
        gain: 1,
        loopEnabled: false,
        ...overrides,
    } as Clip;
}

/** The strip the engine double hands the scheduler, and the note-on/off its instrument was asked to play. */
function stripFor(instrument: InstrumentUnderTest) {
    const noteOn = vi.fn();
    const noteOff = vi.fn();
    vi.mocked(ensureTrackStrip).mockImplementation(
        () =>
            ({
                gainNode: {},
                preFaderTap: { connect: vi.fn() },
                deviceNodes: [
                    {
                        type: instrument.type,
                        deviceId: 'device-1',
                        [instrument.controlsKey]: { noteOn, noteOff, noteExpression: vi.fn() },
                    },
                ],
            }) as never
    );
    return { noteOn, noteOff };
}

function bend(id: string, beat: number, value: number, channel = 0) {
    return { id, beat, value, channel };
}

function controller(id: string, beat: number, cc: number, value: number, channel = 0) {
    return { id, beat, controller: cc, value, channel };
}

function note(id: string, startBeat: number, duration: number, pitch = 64) {
    return { id, pitch, startBeat, duration, velocity: 100 };
}

function setProject(input: {
    track: unknown;
    notes?: Record<string, unknown[]>;
    bends?: Record<string, unknown[]>;
    controllers?: Record<string, unknown[]>;
}): void {
    (trackStore as { value: unknown }).value = { tracks: [input.track] };
    (midiStore as { value: unknown }).value = {
        notesByClipId: input.notes ?? {},
        ccByClipId: input.controllers ?? {},
        pitchBendByClipId: input.bends ?? {},
    };
}

/** What the engine was asked to apply, as frame, bend and depth, in the order it was asked. */
function appliedBend() {
    return vi.mocked(applyNoteExpression).mock.calls.map(([input]) => ({
        sampleFrame: input.sampleFrame,
        pitchBend: input.expression.pitchBend,
        bendRangeSemitones: input.bendRangeSemitones,
    }));
}

async function play(fromBeat: number, toBeat: number, opensAtRelocation = false): Promise<void> {
    await scheduleMidiNotes(
        fromBeat,
        toBeat,
        fromBeat,
        new Set<string>(),
        [],
        defaultTransportState,
        120,
        undefined,
        opensAtRelocation
    );
}

describe('scheduleMidiNotes with a stored channel pitch bend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        forgetHeldNoteExpression();
        (trackStore as { value: unknown }).value = { tracks: [] };
        (midiStore as { value: unknown }).value = null;
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
                startBeat: input.iterationStartBeat + event.startBeat - input.midiOffsetBeats,
            }))
        );
        vi.mocked(processYeastMidi).mockImplementation((input) => Promise.resolve([...input.events]));
        vi.mocked(getCurrentTime).mockReturnValue(0);
        vi.mocked(getCompensationDelay).mockReturnValue(0);
    });

    it.each([FERMENTER, LEVAIN, GRAND_BOULE])(
        'bends a sounding $type note at the frames a note at the bend beats gets, through the live input surface',
        async (instrument) => {
            stripFor(instrument);
            // The clip sits at 2 and plays from content beat 1, so content beat c lands on c + 1; the tempo
            // halves at beat 4, where the bend returns, so its frame is not a flat-tempo multiple.
            setProject({
                track: midiTrack(instrument, [midiClip({ startBeat: 2, endBeat: 10, midiOffsetBeats: 1 })]),
                notes: { 'clip-1': [note('n0', 1, 4)] },
                bends: { 'clip-1': [bend('out', 2, 8191), bend('return', 3, 0)] },
            });
            (tempoMapStore as { value: unknown }).value = {
                changes: [
                    { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'tempo-1', beat: 3.5, tempo: 60, curve: 'instant' },
                ],
            };

            await play(0, 10);

            // Beat 3 is 3 beats at 120 BPM in; beat 4 adds 1.5 beats at 120 and half a beat at 60.
            const out = 3 * FRAMES_PER_BEAT;
            const back = 3.5 * FRAMES_PER_BEAT + 0.5 * 2 * FRAMES_PER_BEAT;
            expect(appliedBend()).toEqual([
                // The note's own start carries no bend, since none is in force yet.
                { sampleFrame: 2 * FRAMES_PER_BEAT, pitchBend: undefined, bendRangeSemitones: undefined },
                { sampleFrame: out, pitchBend: 8191, bendRangeSemitones: 2 },
                { sampleFrame: back, pitchBend: 0, bendRangeSemitones: 2 },
            ]);
            // Each move addresses the sounding note by pitch and channel, on the track's own instrument.
            expect(
                vi.mocked(applyNoteExpression).mock.calls.map(([input]) => [input.trackId, input.note, input.channel])
            ).toEqual([
                ['track-1', 64, 0],
                ['track-1', 64, 0],
                ['track-1', 64, 0],
            ]);
        }
    );

    it('reads the depth from the RPN 0 the clip stored, the live input state machine', async () => {
        stripFor(FERMENTER);
        setProject({
            track: midiTrack(FERMENTER, [midiClip()]),
            notes: { 'clip-1': [note('n0', 0, 4)] },
            // Select RPN 0, enter 12 semitones, then the Null RPN a controller sends after it.
            controllers: {
                'clip-1': [
                    controller('rpn-msb', 0, 101, 0),
                    controller('rpn-lsb', 0, 100, 0),
                    controller('data', 0, 6, 12),
                    controller('null-msb', 0, 101, 127),
                    controller('null-lsb', 0, 100, 127),
                ],
            },
            bends: { 'clip-1': [bend('out', 1, 4096)] },
        });

        await play(0, 8);

        expect(appliedBend().at(-1)).toEqual({
            sampleFrame: FRAMES_PER_BEAT,
            pitchBend: 4096,
            bendRangeSemitones: 12,
        });
    });

    it('starts a note struck while the bend is out bent, from its first sample', async () => {
        const { noteOn } = stripFor(FERMENTER);
        setProject({
            track: midiTrack(FERMENTER, [midiClip()]),
            notes: { 'clip-1': [note('n0', 2, 1)] },
            bends: { 'clip-1': [bend('out', 1, 8191), bend('return', 4, 0)] },
        });

        await play(0, 8);

        expect(appliedBend()).toEqual([{ sampleFrame: 2 * FRAMES_PER_BEAT, pitchBend: 8191, bendRangeSemitones: 2 }]);
        // The voice exists before the update that bends it, so the update finds it held.
        expect(noteOn.mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(applyNoteExpression).mock.invocationCallOrder[0]!
        );
    });

    it('plays a bend struck on the frame of a note-on as that note-on own bend', async () => {
        const { noteOn } = stripFor(FERMENTER);
        setProject({
            track: midiTrack(FERMENTER, [midiClip()]),
            notes: { 'clip-1': [note('n0', 2, 1)] },
            bends: { 'clip-1': [bend('out', 2, -8192)] },
        });

        await play(0, 8);

        expect(noteOn.mock.calls[0]![2]).toBe(2 * FRAMES_PER_BEAT);
        expect(appliedBend()).toEqual([{ sampleFrame: 2 * FRAMES_PER_BEAT, pitchBend: -8192, bendRangeSemitones: 2 }]);
    });

    it('leaves a note released on the frame a bend moves untouched by it, and bends the note struck there', async () => {
        stripFor(FERMENTER);
        setProject({
            track: midiTrack(FERMENTER, [midiClip()]),
            notes: { 'clip-1': [note('ending', 0, 2, 60), note('striking', 2, 1, 67)] },
            bends: { 'clip-1': [bend('out', 2, 8191)] },
        });

        await play(0, 8);

        const calls = vi
            .mocked(applyNoteExpression)
            .mock.calls.map(([input]) => [input.note, input.expression.pitchBend]);
        expect(calls).toEqual([
            [60, undefined],
            [67, 8191],
        ]);
    });

    it('bends the note after a clip that ended bent, and the clip with no note list bends the notes around it', async () => {
        stripFor(FERMENTER);
        setProject({
            track: midiTrack(FERMENTER, [
                midiClip({ id: 'bend-only', startBeat: 0, endBeat: 2 }),
                midiClip({ id: 'notes-only', startBeat: 4, endBeat: 8 }),
            ]),
            // The first clip has no note list at all and ends with the bend out; nothing resets it.
            notes: { 'notes-only': [note('n0', 1, 1)] },
            bends: { 'bend-only': [bend('out', 1, 8191)] },
        });

        await play(0, 8);

        expect(appliedBend()).toEqual([{ sampleFrame: 5 * FRAMES_PER_BEAT, pitchBend: 8191, bendRangeSemitones: 2 }]);
    });

    it('bends nothing for a muted clip lane', async () => {
        stripFor(FERMENTER);
        setProject({
            track: midiTrack(FERMENTER, [
                midiClip({ id: 'muted', muted: true, startBeat: 0, endBeat: 2 }),
                midiClip({ id: 'notes-only', startBeat: 4, endBeat: 8 }),
            ]),
            notes: { 'notes-only': [note('n0', 1, 1)] },
            bends: { muted: [bend('out', 1, 8191)] },
        });

        await play(0, 8);

        expect(appliedBend().map(({ pitchBend }) => pitchBend)).toEqual([undefined]);
    });

    it('bends nothing for the part of a clip lane a comp region replaces', async () => {
        stripFor(FERMENTER);
        // The comp resolution cuts the bend clip at 4, so its move at 5 lies in the replaced part.
        vi.mocked(resolveClipsWithComping).mockImplementation((_trackId, clips) =>
            clips.map((clip) => {
                const endBeat = clip.id === 'bends' ? 4 : clip.endBeat;
                return {
                    ...clip,
                    endBeat,
                    regionStartBeat: clip.startBeat,
                    regionEndBeat: endBeat,
                    sourceStartBeat: 0,
                };
            })
        );
        setProject({
            track: midiTrack(FERMENTER, [midiClip({ id: 'notes' }), midiClip({ id: 'bends' })]),
            notes: { notes: [note('n0', 0, 7)] },
            bends: { bends: [bend('kept', 2, 4096), bend('replaced', 5, 8191)] },
        });

        await play(0, 8);

        expect(appliedBend()).toEqual([
            { sampleFrame: 0, pitchBend: undefined, bendRangeSemitones: undefined },
            { sampleFrame: 2 * FRAMES_PER_BEAT, pitchBend: 4096, bendRangeSemitones: 2 },
        ]);
    });

    it('bends nothing on a Yeast track, whose notes are the rack', async () => {
        stripFor(FERMENTER);
        setProject({
            track: midiTrack(
                FERMENTER,
                [midiClip()],
                [
                    { id: 'yeast-1', type: 'yeast' },
                    { id: 'device-1', type: 'fermenter' },
                ]
            ),
            notes: { 'clip-1': [note('n0', 2, 1)] },
            bends: { 'clip-1': [bend('out', 1, 8191)] },
        });

        await play(0, 8);

        expect(appliedBend().filter(({ pitchBend }) => pitchBend !== undefined)).toEqual([]);
    });

    it('sends an instrument that does not bend a held voice no bend', async () => {
        const { noteOn } = stripFor(CRUMBS);
        setProject({
            track: midiTrack(CRUMBS, [midiClip()]),
            notes: { 'clip-1': [note('n0', 2, 1)] },
            bends: { 'clip-1': [bend('out', 1, 8191), bend('return', 2.5, 0)] },
        });

        await play(0, 8);

        // The track played, so the silence is the instrument's, not the project's.
        expect(noteOn).toHaveBeenCalledTimes(1);
        expect(appliedBend().filter(({ pitchBend }) => pitchBend !== undefined)).toEqual([]);
    });

    describe('after playback is relocated or stopped', () => {
        it('starts a note struck at a jump destination inside the bend-out span bent, and posts nothing parked from before', async () => {
            stripFor(FERMENTER);
            setProject({
                track: midiTrack(FERMENTER, [midiClip()]),
                notes: { 'clip-1': [note('long', 0, 6), note('landing', 3.5, 1, 67)] },
                bends: { 'clip-1': [bend('out', 3, 8191), bend('return', 4, 0)] },
            });

            // The first window starts the long note and parks its bend changes for the windows that own them.
            await play(0, 1);
            vi.mocked(applyNoteExpression).mockClear();

            // A follow-action jump lands at 3.5, inside the span: the note struck there is bent, and the
            // long note, never started in this window, is not addressed. The scheduler's jump has silenced
            // the notes (`stopAllScheduled`) and forgotten the registry before its window opens.
            forgetHeldNoteExpression();
            await play(3.5, 4, true);

            const calls = vi
                .mocked(applyNoteExpression)
                .mock.calls.map(([input]) => [input.note, input.expression.pitchBend]);
            expect(calls).toEqual([[67, 8191]]);
            expect(appliedBend()[0]).toMatchObject({ sampleFrame: 0, bendRangeSemitones: 2 });
        });

        it('starts a note struck at a destination past the return at centre', async () => {
            stripFor(FERMENTER);
            setProject({
                track: midiTrack(FERMENTER, [midiClip()]),
                notes: { 'clip-1': [note('landing', 5, 1, 67)] },
                bends: { 'clip-1': [bend('out', 3, 8191), bend('return', 4, 0)] },
            });

            await play(5, 6, true);

            expect(appliedBend()).toEqual([{ sampleFrame: 0, pitchBend: 0, bendRangeSemitones: 2 }]);
        });

        it('posts none of a started note’s parked bend changes once playback stops', async () => {
            stripFor(FERMENTER);
            setProject({
                track: midiTrack(FERMENTER, [midiClip()]),
                notes: { 'clip-1': [note('long', 0, 6)] },
                bends: { 'clip-1': [bend('out', 3, 8191), bend('return', 4, 0)] },
            });

            await play(0, 1);
            // The stop door of the scheduler is the one that forgets what a playback parked.
            disposePlayheadScheduler();
            vi.mocked(applyNoteExpression).mockClear();
            await play(1, 5);

            expect(appliedBend()).toEqual([]);
        });
    });

    it('posts each bend move in the window that contains it, not with the note', async () => {
        stripFor(FERMENTER);
        setProject({
            track: midiTrack(FERMENTER, [midiClip()]),
            notes: { 'clip-1': [note('long', 0, 6)] },
            bends: { 'clip-1': [bend('out', 3, 8191), bend('return', 4, 0)] },
        });

        await play(0, 2);
        expect(appliedBend().map(({ pitchBend }) => pitchBend)).toEqual([undefined]);
        await play(2, 3.5);
        expect(appliedBend().map(({ pitchBend }) => pitchBend)).toEqual([undefined, 8191]);
        await play(3.5, 6);
        expect(appliedBend().map(({ pitchBend }) => pitchBend)).toEqual([undefined, 8191, 0]);
    });

    it('reads the depth at the content beat of the bend, not at its place on the timeline', async () => {
        stripFor(FERMENTER);
        // The clip sits at beat 4, so content beat c lands on c + 4. The controller declares ±2 at content
        // beat 0 and ±24 at content beat 3 (timeline beat 7): the bend at timeline beat 6 is content beat 2,
        // still ±2, though a depth read at the timeline beat would already find the second declaration.
        const declare = (beat: number, semitones: number) => [
            controller(`rpn-msb-${beat}`, beat, 101, 0),
            controller(`rpn-lsb-${beat}`, beat, 100, 0),
            controller(`data-${beat}`, beat, 6, semitones),
            controller(`null-msb-${beat}`, beat, 101, 127),
            controller(`null-lsb-${beat}`, beat, 100, 127),
        ];
        setProject({
            track: midiTrack(FERMENTER, [midiClip({ startBeat: 4, endBeat: 12 })]),
            notes: { 'clip-1': [note('n0', 0, 6)] },
            controllers: { 'clip-1': [...declare(0, 2), ...declare(3, 24)] },
            bends: { 'clip-1': [bend('before', 2, 4096), bend('after', 4, 8191)] },
        });

        await play(0, 12);

        expect(appliedBend().slice(1)).toEqual([
            { sampleFrame: 6 * FRAMES_PER_BEAT, pitchBend: 4096, bendRangeSemitones: 2 },
            { sampleFrame: 8 * FRAMES_PER_BEAT, pitchBend: 8191, bendRangeSemitones: 24 },
        ]);
    });

    describe('when the clips change while a note sounds', () => {
        const bendClip = (muted: boolean) => [midiClip({ id: 'notes' }), midiClip({ id: 'bends', muted })];
        const longNote = { notes: [note('n0', 0, 7)] };
        const originalBends = [bend('out', 4, 8191), bend('return', 6, 0)];

        function loadSong(options: { bendsMuted: boolean; bends?: ReturnType<typeof bend>[] }): void {
            setProject({
                track: midiTrack(FERMENTER, bendClip(options.bendsMuted)),
                notes: { notes: longNote.notes },
                bends: { bends: options.bends ?? originalBends },
            });
        }

        /** A window on the timeline's own clock, as a rolling transport gives it: a beat has one frame throughout. */
        async function playOnTheClock(fromBeat: number, toBeat: number): Promise<void> {
            vi.mocked(getCurrentTime).mockReturnValue((fromBeat * FRAMES_PER_BEAT) / 48_000);
            await play(fromBeat, toBeat);
        }

        beforeEach(() => {
            stripFor(FERMENTER);
        });

        it('posts no bend to a note once the clip that holds it is muted, though the note started before the mute', async () => {
            loadSong({ bendsMuted: false });
            await playOnTheClock(0, 1);
            loadSong({ bendsMuted: true });
            await playOnTheClock(1, 8);

            // Only the note-on's own expression: the moves at 4 and 6 are the muted clip's.
            expect(appliedBend().map(({ pitchBend }) => pitchBend)).toEqual([undefined]);
        });

        it('bends a note that started while the clip was muted once the clip is unmuted', async () => {
            loadSong({ bendsMuted: true });
            await playOnTheClock(0, 1);
            loadSong({ bendsMuted: false });
            await playOnTheClock(1, 8);

            expect(appliedBend()).toEqual([
                { sampleFrame: 0, pitchBend: undefined, bendRangeSemitones: undefined },
                { sampleFrame: 4 * FRAMES_PER_BEAT, pitchBend: 8191, bendRangeSemitones: 2 },
                { sampleFrame: 6 * FRAMES_PER_BEAT, pitchBend: 0, bendRangeSemitones: 2 },
            ]);
        });

        it('gives a note the bend in force when the window that unmutes the clip opens, then the moves of the window', async () => {
            loadSong({ bendsMuted: false });
            await playOnTheClock(0, 1);
            loadSong({ bendsMuted: true });
            await playOnTheClock(1, 5);
            loadSong({ bendsMuted: false });
            await playOnTheClock(5, 8);

            // The move at 4 fell in the muted span and was never posted at its own frame; the instrument is
            // told what it left in force when the unmuting window opens, ahead of the move at 6.
            expect(appliedBend()).toEqual([
                { sampleFrame: 0, pitchBend: undefined, bendRangeSemitones: undefined },
                { sampleFrame: 5 * FRAMES_PER_BEAT, pitchBend: 8191, bendRangeSemitones: 2 },
                { sampleFrame: 6 * FRAMES_PER_BEAT, pitchBend: 0, bendRangeSemitones: 2 },
            ]);
        });

        it('plays the moves the clip holds when a window comes, not the ones it held when the note started', async () => {
            loadSong({ bendsMuted: false });
            await playOnTheClock(0, 1);
            // The bend lane is edited while the note sounds: the move at 4 moves to 3, and the one at 6 is gone.
            loadSong({ bendsMuted: false, bends: [bend('out', 3, 4096)] });
            await playOnTheClock(1, 8);

            expect(appliedBend()).toEqual([
                { sampleFrame: 0, pitchBend: undefined, bendRangeSemitones: undefined },
                { sampleFrame: 3 * FRAMES_PER_BEAT, pitchBend: 4096, bendRangeSemitones: 2 },
            ]);
        });

        it('lets a move of the clip override the bend the note itself holds, and the note’s next bend point override the move', async () => {
            loadSong({ bendsMuted: false });
            setProject({
                track: midiTrack(FERMENTER, bendClip(false)),
                notes: {
                    notes: [
                        {
                            ...note('n0', 0, 7),
                            pitchBend: 1000,
                            pitchBendRangeSemitones: 48,
                            expression: { pitchBend: [{ offsetBeats: 5, value: -1000 }] },
                        },
                    ],
                },
                bends: { bends: originalBends },
            });

            await playOnTheClock(0, 1);
            await playOnTheClock(1, 8);

            // The note-on keeps its own bend; the move at 4 takes the bend at the move's depth, the note's own
            // point at 5 takes it back at the note's, and the move at 6 takes it again.
            expect(appliedBend()).toEqual([
                { sampleFrame: 0, pitchBend: 1000, bendRangeSemitones: 48 },
                { sampleFrame: 4 * FRAMES_PER_BEAT, pitchBend: 8191, bendRangeSemitones: 2 },
                { sampleFrame: 5 * FRAMES_PER_BEAT, pitchBend: -1000, bendRangeSemitones: 48 },
                { sampleFrame: 6 * FRAMES_PER_BEAT, pitchBend: 0, bendRangeSemitones: 2 },
            ]);
        });
    });

    describe('when a scheduled loop seam opens the next pass while a note rings across it', () => {
        // The loop is [0, 4) at 120 BPM, so the first pass ends 2 s in and the next opens there. The clip
        // spans [0, 8), the bend is centred at beat 0 and out at beat 3, and the long note starts on beat 2
        // and lasts 4 beats: it is still sounding when the pass ends, and its release lands 2 beats into
        // the next pass.
        const SEAM_SECONDS = 2;
        const SEAM_FRAME = SEAM_SECONDS * 48_000;
        const LONG_NOTE_PITCH = 64;
        const DOWNBEAT_PITCH = 60;

        /** A window of one pass on the audio clock, as a rolling transport gives it. */
        async function playOnPass(
            passStartSeconds: number,
            fromBeat: number,
            toBeat: number,
            opensAtRelocation = false
        ): Promise<void> {
            vi.mocked(getCurrentTime).mockReturnValue(passStartSeconds + fromBeat / 2);
            await play(fromBeat, toBeat, opensAtRelocation);
        }

        function loadSeamSong(options: {
            notes?: Record<string, unknown>[];
            bends?: ReturnType<typeof bend>[];
            devices?: { id: string; type: string }[];
        }): void {
            setProject({
                track: midiTrack(FERMENTER, [midiClip()], options.devices),
                notes: {
                    'clip-1': options.notes ?? [
                        note('downbeat', 0, 1, DOWNBEAT_PITCH),
                        note('long', 2, 4, LONG_NOTE_PITCH),
                    ],
                },
                bends: { 'clip-1': options.bends ?? [bend('centre', 0, 0), bend('out', 3, 8191)] },
            });
        }

        /** What the engine was asked to apply to one pitch, in the order it was asked. */
        function appliedTo(pitch: number) {
            return vi
                .mocked(applyNoteExpression)
                .mock.calls.filter(([input]) => input.note === pitch)
                .map(([input]) => ({
                    sampleFrame: input.sampleFrame,
                    pitchBend: input.expression.pitchBend,
                    bendRangeSemitones: input.bendRangeSemitones,
                }));
        }

        beforeEach(() => {
            stripFor(FERMENTER);
        });

        it('gives the ringing note the bend in force at the loop start, at the frame the seam window opens on', async () => {
            loadSeamSong({});
            await playOnPass(0, 2, 4);
            // The long note took the bend out at beat 3 before the pass ended.
            expect(appliedTo(LONG_NOTE_PITCH).at(-1)).toEqual({
                sampleFrame: 72_000,
                pitchBend: 8191,
                bendRangeSemitones: 2,
            });
            vi.mocked(applyNoteExpression).mockClear();

            await playOnPass(SEAM_SECONDS, 0, 1, true);
            await playOnPass(SEAM_SECONDS, 1, 2);

            expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
            ]);
            // The note struck on the loop start meanwhile starts under the same bend.
            expect(appliedTo(DOWNBEAT_PITCH)).toEqual([
                { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
            ]);
        });

        it('moves the ringing note with the later moves of the new pass, and none past its release', async () => {
            loadSeamSong({
                bends: [bend('centre', 0, 0), bend('early', 1, 4096), bend('out', 3, 8191)],
            });
            await playOnPass(0, 2, 4);
            vi.mocked(applyNoteExpression).mockClear();

            await playOnPass(SEAM_SECONDS, 0, 2, true);
            // The note was struck on beat 2 for 4 beats, so it is released 2 beats into the new pass: the
            // move at beat 3 of the new pass lands after that and never reaches it. The window starts past
            // beat 2, where the new pass strikes its own note.
            await playOnPass(SEAM_SECONDS, 2.25, 4);

            expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                { sampleFrame: SEAM_FRAME + FRAMES_PER_BEAT, pitchBend: 4096, bendRangeSemitones: 2 },
            ]);
        });

        it('keeps the ringing note’s moves on the clock the seam window opened on, however the clock drifts later', async () => {
            loadSeamSong({ bends: [bend('centre', 0, 0), bend('mid', 1.5, 4096)] });
            await playOnPass(0, 2, 4);
            vi.mocked(applyNoteExpression).mockClear();

            await playOnPass(SEAM_SECONDS, 0, 1, true);
            // The window comes 0.3 s late on the audio clock: the move at beat 1.5 is still 0.75 s into the
            // pass the seam opened, 0.5 s before the release, and must not slide past it.
            vi.mocked(getCurrentTime).mockReturnValue(SEAM_SECONDS + 1 / 2 + 0.3);
            await play(1, 2);

            expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                { sampleFrame: SEAM_FRAME + 1.5 * FRAMES_PER_BEAT, pitchBend: 4096, bendRangeSemitones: 2 },
            ]);
        });

        it('holds the ringing note until its release, in the beats of the loop that starts later and under a compensation delay', async () => {
            vi.mocked(getCompensationDelay).mockReturnValue(0.1);
            loadSeamSong({});
            await playOnPass(0, 2, 4);

            // The loop is [1, 4): the pass opens on beat 1, 2 s in, and the note is released 2 beats later.
            await playOnPass(1.5, 1, 2, true);

            const [carried] = heldNotesByTrack.get('track-1') ?? [];
            expect(carried?.releaseBeat).toBeCloseTo(3, 6);
            // A window past that beat finds it over and takes it out of the registry.
            await playOnPass(1.5, 3, 3.5);
            expect(heldNotesByTrack.get('track-1') ?? []).toEqual([]);
        });

        it('does not play the ringing note’s own curve points of the pass it left', async () => {
            loadSeamSong({
                notes: [
                    {
                        // Released 4 beats into the next pass, so the point at 2.5 would still sound there.
                        ...note('long', 2, 6, LONG_NOTE_PITCH),
                        expression: { pressure: [{ offsetBeats: 0.5, value: 90 }] },
                    },
                ],
                // The note starts bent, and no bend is in force at the loop start: it returns to centre.
                bends: [bend('out', 1, 8191)],
            });
            // The pressure point at beat 2.5 is parked with the note, and the pass ends before it plays.
            await playOnPass(0, 2, 2.25);
            vi.mocked(applyNoteExpression).mockClear();

            await playOnPass(SEAM_SECONDS, 0, 1, true);
            await playOnPass(SEAM_SECONDS, 2.25, 3);

            const applied = vi.mocked(applyNoteExpression).mock.calls.map(([input]) => ({
                note: input.note,
                sampleFrame: input.sampleFrame,
                pressure: input.expression.pressure,
                pitchBend: input.expression.pitchBend,
            }));
            expect(applied).toEqual([
                { note: LONG_NOTE_PITCH, sampleFrame: SEAM_FRAME, pressure: undefined, pitchBend: 0 },
            ]);
        });

        it('updates the ringing note ahead of a note struck on the loop start at the same pitch, which keeps its own bend', async () => {
            loadSeamSong({
                notes: [
                    { ...note('again', 0, 1, LONG_NOTE_PITCH), pitchBend: 1000, pitchBendRangeSemitones: 48 },
                    note('long', 2, 4, LONG_NOTE_PITCH),
                ],
                bends: [bend('mid', 0, 4096), bend('out', 3, 8191)],
            });
            await playOnPass(0, 2, 4);
            vi.mocked(applyNoteExpression).mockClear();

            await playOnPass(SEAM_SECONDS, 0, 1, true);

            // The note the pass strikes is addressed last, so its own bend is the one the voice ends on.
            expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                { sampleFrame: SEAM_FRAME, pitchBend: 4096, bendRangeSemitones: 2 },
                { sampleFrame: SEAM_FRAME, pitchBend: 1000, bendRangeSemitones: 48 },
            ]);
        });

        it('posts nothing to the ringing note when the bend in force at the loop start is the one it holds', async () => {
            loadSeamSong({ bends: [bend('centre', 0, 0)] });
            await playOnPass(0, 2, 4);
            vi.mocked(applyNoteExpression).mockClear();

            await playOnPass(SEAM_SECONDS, 0, 1, true);

            expect(appliedTo(LONG_NOTE_PITCH)).toEqual([]);
        });

        it('returns the ringing note to centre when no bend is in force at the loop start', async () => {
            loadSeamSong({ bends: [bend('out', 3, 8191)] });
            await playOnPass(0, 2, 4);
            expect(appliedTo(LONG_NOTE_PITCH).at(-1)?.pitchBend).toBe(8191);
            vi.mocked(applyNoteExpression).mockClear();

            await playOnPass(SEAM_SECONDS, 0, 1, true);

            expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
            ]);
        });

        it('leaves a note alone that is released before the seam frame or on it', async () => {
            loadSeamSong({
                notes: [note('ends-before', 1, 2, 62), note('ends-on', 1, 3, 66), note('rings', 2, 4, LONG_NOTE_PITCH)],
                bends: [bend('out', 1, 8191)],
            });
            await playOnPass(0, 0, 4);
            vi.mocked(applyNoteExpression).mockClear();

            await playOnPass(SEAM_SECONDS, 0, 1, true);

            expect(appliedTo(62)).toEqual([]);
            expect(appliedTo(66)).toEqual([]);
            expect(appliedTo(LONG_NOTE_PITCH)).toHaveLength(1);
        });

        it('leaves a ringing note alone once the instrument that voiced it is not the track’s', async () => {
            loadSeamSong({});
            await playOnPass(0, 2, 4);
            vi.mocked(applyNoteExpression).mockClear();
            loadSeamSong({ devices: [{ id: 'device-2', type: FERMENTER.type }] });

            await playOnPass(SEAM_SECONDS, 0, 1, true);

            expect(appliedTo(LONG_NOTE_PITCH)).toEqual([]);
        });

        it('forgets a ringing note when playback stops before the seam window', async () => {
            loadSeamSong({});
            await playOnPass(0, 2, 4);
            disposePlayheadScheduler();
            vi.mocked(applyNoteExpression).mockClear();

            await playOnPass(SEAM_SECONDS, 0, 1, true);

            expect(appliedTo(LONG_NOTE_PITCH)).toEqual([]);
        });

        describe('on a track whose own window does not start any note at the seam', () => {
            /** The clip starts on beat 1, so the loop start (beat 0) falls in a gap of the track. */
            function loadGapSong(options: { devices?: { id: string; type: string; bypassed?: boolean }[] } = {}): void {
                setProject({
                    track: midiTrack(FERMENTER, [midiClip({ startBeat: 1, endBeat: 8 })], options.devices),
                    notes: { 'clip-1': [note('long', 1, 4, LONG_NOTE_PITCH)] },
                    bends: { 'clip-1': [bend('early', 0.5, 4096), bend('out', 2, 8191)] },
                });
            }

            it('gives the ringing note the bend in force at a loop start that falls in a gap, then the moves of the new pass', async () => {
                setProject({
                    track: midiTrack(FERMENTER, [midiClip({ startBeat: 1, endBeat: 8 })]),
                    notes: { 'clip-1': [note('long', 1, 4, LONG_NOTE_PITCH)] },
                    bends: { 'clip-1': [bend('out', 2, 8191)] },
                });
                await playOnPass(0, 2, 4);
                expect(appliedTo(LONG_NOTE_PITCH).at(-1)).toEqual({
                    sampleFrame: 72_000,
                    pitchBend: 8191,
                    bendRangeSemitones: 2,
                });
                vi.mocked(applyNoteExpression).mockClear();

                await playOnPass(SEAM_SECONDS, 0, 1, true);
                await playOnPass(SEAM_SECONDS, 1, 2);

                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                    { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                ]);
            });

            it('keeps moving a note carried over a gap with the moves of the clip that starts later in the new pass', async () => {
                loadGapSong();
                await playOnPass(0, 2, 4);
                vi.mocked(applyNoteExpression).mockClear();

                await playOnPass(SEAM_SECONDS, 0, 1, true);
                // The move at content beat 0.5 lands on beat 1.5 of the new pass, 0.5 beats before the release.
                await playOnPass(SEAM_SECONDS, 1, 2);

                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                    { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                    { sampleFrame: SEAM_FRAME + 1.5 * FRAMES_PER_BEAT, pitchBend: 4096, bendRangeSemitones: 2 },
                ]);
            });

            it('leaves the ringing note alone in the gap once the instrument that voiced it is not the track’s', async () => {
                loadGapSong();
                await playOnPass(0, 2, 4);
                vi.mocked(applyNoteExpression).mockClear();
                loadGapSong({ devices: [{ id: 'device-2', type: FERMENTER.type }] });

                await playOnPass(SEAM_SECONDS, 0, 1, true);

                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([]);
                expect(heldNotesByTrack.get('track-1') ?? []).toEqual([]);
            });

            it('returns the ringing note to centre when every clip at the loop start is muted', async () => {
                loadSeamSong({});
                await playOnPass(0, 2, 4);
                expect(appliedTo(LONG_NOTE_PITCH).at(-1)?.pitchBend).toBe(8191);
                vi.mocked(applyNoteExpression).mockClear();
                setProject({
                    track: midiTrack(FERMENTER, [midiClip({ muted: true })]),
                    notes: { 'clip-1': [note('long', 2, 4, LONG_NOTE_PITCH)] },
                    bends: { 'clip-1': [bend('centre', 0, 4096), bend('out', 3, 8191)] },
                });

                await playOnPass(SEAM_SECONDS, 0, 1, true);

                // The muted clip's own bend at the loop start is not in force, so the bend the note held is undone.
                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                    { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                ]);
            });

            it('moves a note carried over a muted clip once the clip is unmuted while the note still rings', async () => {
                const song = {
                    notes: { 'clip-1': [note('long', 2, 4, LONG_NOTE_PITCH)] },
                    bends: { 'clip-1': [bend('centre', 0, 0), bend('mid', 1.5, 4096), bend('out', 3, 8191)] },
                };
                setProject({ track: midiTrack(FERMENTER, [midiClip()]), ...song });
                await playOnPass(0, 2, 4);
                vi.mocked(applyNoteExpression).mockClear();
                setProject({ track: midiTrack(FERMENTER, [midiClip({ muted: true })]), ...song });

                await playOnPass(SEAM_SECONDS, 0, 1, true);
                setProject({ track: midiTrack(FERMENTER, [midiClip()]), ...song });
                await playOnPass(SEAM_SECONDS, 1.75, 1.9);

                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                    { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                    { sampleFrame: SEAM_FRAME + 1.75 * FRAMES_PER_BEAT, pitchBend: 4096, bendRangeSemitones: 2 },
                ]);
            });

            it('carries a note of a track that is muted at the seam, and moves it when the mute ends while it still rings', async () => {
                loadSeamSong({ bends: [bend('centre', 0, 0), bend('mid', 1.5, 4096), bend('out', 3, 8191)] });
                await playOnPass(0, 2, 4);
                vi.mocked(applyNoteExpression).mockClear();
                const song = {
                    notes: { 'clip-1': [note('long', 2, 4, LONG_NOTE_PITCH)] },
                    bends: { 'clip-1': [bend('centre', 0, 0), bend('mid', 1.5, 4096), bend('out', 3, 8191)] },
                };
                setProject({ track: midiTrack(FERMENTER, [midiClip()], undefined, { muted: true }), ...song });

                await playOnPass(SEAM_SECONDS, 0, 1, true);
                // The mute keeps the note registered, with its release placed in the new pass's beats.
                expect(heldNotesByTrack.get('track-1')?.map((held) => held.pitch)).toEqual([LONG_NOTE_PITCH]);
                expect(heldNotesByTrack.get('track-1')?.[0]?.releaseBeat).toBeCloseTo(2, 6);
                // The windows the mute keeps from the track post nothing, at their own frames or later.
                await playOnPass(SEAM_SECONDS, 1, 1.5);
                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                    { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                ]);

                setProject({ track: midiTrack(FERMENTER, [midiClip()]), ...song });
                await playOnPass(SEAM_SECONDS, 1.75, 1.9);

                // The move at beat 1.5 fell in the muted span; the window that ends the mute tells the note.
                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                    { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                    { sampleFrame: SEAM_FRAME + 1.75 * FRAMES_PER_BEAT, pitchBend: 4096, bendRangeSemitones: 2 },
                ]);
            });

            describe('when the window that ends a mute falls in a gap', () => {
                /**
                 * Clip B plays [0, 1.6) with a centre at 0 and a bend out at 1.5, clip A plays [2, 8) and holds the
                 * long note: the bend out falls in the muted span and the window after the mute has no clip.
                 */
                const twoClipSong = (overrides: { trackMuted?: boolean; clipBMuted?: boolean } = {}) => ({
                    track: midiTrack(
                        FERMENTER,
                        [
                            midiClip({
                                id: 'clip-b',
                                startBeat: 0,
                                endBeat: 1.6,
                                muted: overrides.clipBMuted ?? false,
                            }),
                            midiClip({ id: 'clip-a', startBeat: 2, endBeat: 8 }),
                        ],
                        undefined,
                        { muted: overrides.trackMuted ?? false }
                    ),
                    // The note sits at the head of clip A, so it sounds on [2, 6) of the timeline.
                    notes: { 'clip-a': [note('long', 0, 4, LONG_NOTE_PITCH)] },
                    bends: { 'clip-b': [bend('centre', 0, 0), bend('out', 1.5, 4096)] },
                });

                it('gives a note carried across the seam while the track was muted the bend in force', async () => {
                    setProject(twoClipSong());
                    await playOnPass(0, 2, 4);
                    vi.mocked(applyNoteExpression).mockClear();
                    setProject(twoClipSong({ trackMuted: true }));

                    await playOnPass(SEAM_SECONDS, 0, 1, true);
                    await playOnPass(SEAM_SECONDS, 1, 1.5);
                    setProject(twoClipSong());
                    await playOnPass(SEAM_SECONDS, 1.75, 1.9);
                    await playOnPass(SEAM_SECONDS, 1.9, 2);

                    // The bend out at 1.5 fell in the muted span, and clip B has ended by the window after it.
                    expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                        { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                        { sampleFrame: SEAM_FRAME + 1.75 * FRAMES_PER_BEAT, pitchBend: 4096, bendRangeSemitones: 2 },
                    ]);
                });

                it('gives a note carried across the seam while the clip holding the bend was muted the bend in force', async () => {
                    setProject(twoClipSong());
                    await playOnPass(0, 2, 4);
                    vi.mocked(applyNoteExpression).mockClear();
                    setProject(twoClipSong({ clipBMuted: true }));

                    await playOnPass(SEAM_SECONDS, 0, 1, true);
                    await playOnPass(SEAM_SECONDS, 1, 1.5);
                    setProject(twoClipSong());
                    await playOnPass(SEAM_SECONDS, 1.75, 1.9);
                    await playOnPass(SEAM_SECONDS, 1.9, 2);

                    expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                        { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                        { sampleFrame: SEAM_FRAME + 1.75 * FRAMES_PER_BEAT, pitchBend: 4096, bendRangeSemitones: 2 },
                    ]);
                });
            });

            it('carries a note of a track that still names the buffer of an earlier freeze but is not frozen', async () => {
                loadSeamSong({});
                await playOnPass(0, 2, 4);
                vi.mocked(applyNoteExpression).mockClear();
                setProject({
                    track: midiTrack(FERMENTER, [midiClip()], undefined, {
                        freezeState: { status: 'unfrozen', frozenBufferId: 'earlier-freeze' },
                    }),
                    notes: { 'clip-1': [note('long', 2, 4, LONG_NOTE_PITCH)] },
                    bends: { 'clip-1': [bend('centre', 0, 0)] },
                });

                await playOnPass(SEAM_SECONDS, 0, 1, true);

                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([
                    { sampleFrame: SEAM_FRAME, pitchBend: 0, bendRangeSemitones: 2 },
                ]);
            });

            it('leaves a ringing note alone once the instrument that voiced it is bypassed, and forgets it', async () => {
                loadGapSong();
                await playOnPass(0, 2, 4);
                vi.mocked(applyNoteExpression).mockClear();
                loadGapSong({ devices: [{ id: 'device-1', type: FERMENTER.type, bypassed: true }] });

                await playOnPass(SEAM_SECONDS, 0, 1, true);

                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([]);
                expect(heldNotesByTrack.get('track-1') ?? []).toEqual([]);
            });

            it('posts and registers nothing for a window that is no longer current when the seam opens', async () => {
                loadGapSong();
                await playOnPass(0, 2, 4);
                vi.mocked(applyNoteExpression).mockClear();
                vi.mocked(getCurrentTime).mockReturnValue(SEAM_SECONDS);

                await scheduleMidiNotes(
                    0,
                    1,
                    0,
                    new Set<string>(),
                    [],
                    defaultTransportState,
                    120,
                    { generation: 1, discontinuityEpoch: 1, isCurrent: () => false, yeastRouteLineage: new Map() },
                    true
                );

                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([]);
                expect(heldNotesByTrack.get('track-1') ?? []).toEqual([]);
            });

            it('forgets a ringing note of a track that is frozen at the seam, which plays its buffer and not its instrument', async () => {
                loadSeamSong({});
                await playOnPass(0, 2, 4);
                vi.mocked(applyNoteExpression).mockClear();
                setProject({
                    track: midiTrack(FERMENTER, [midiClip()], undefined, {
                        freezeState: { status: 'frozen', frozenBufferId: 'frozen-buffer' },
                    }),
                    notes: { 'clip-1': [note('long', 2, 4, LONG_NOTE_PITCH)] },
                    bends: { 'clip-1': [bend('centre', 0, 0)] },
                });

                await playOnPass(SEAM_SECONDS, 0, 1, true);

                expect(appliedTo(LONG_NOTE_PITCH)).toEqual([]);
                expect(heldNotesByTrack.get('track-1') ?? []).toEqual([]);
            });

            it('carries the ringing notes of every track at once, whichever of them has a window that runs', async () => {
                const secondTrack = {
                    ...(midiTrack(FERMENTER, [midiClip({ id: 'clip-2', startBeat: 1, endBeat: 8 })]) as object),
                    id: 'track-2',
                } as never;
                (trackStore as { value: unknown }).value = {
                    tracks: [midiTrack(FERMENTER, [midiClip()]), secondTrack],
                };
                (midiStore as { value: unknown }).value = {
                    notesByClipId: {
                        'clip-1': [note('long', 2, 4, LONG_NOTE_PITCH)],
                        'clip-2': [note('long-2', 1, 4, 65)],
                    },
                    ccByClipId: {},
                    pitchBendByClipId: {
                        'clip-1': [bend('centre', 0, 0), bend('out', 3, 8191)],
                        'clip-2': [bend('out-2', 2, 8191)],
                    },
                };
                await playOnPass(0, 2, 4);
                vi.mocked(applyNoteExpression).mockClear();

                await playOnPass(SEAM_SECONDS, 0, 1, true);

                expect(
                    vi
                        .mocked(applyNoteExpression)
                        .mock.calls.map(([input]) => [
                            input.trackId,
                            input.note,
                            input.sampleFrame,
                            input.expression.pitchBend,
                        ])
                ).toEqual(
                    expect.arrayContaining([
                        ['track-1', LONG_NOTE_PITCH, SEAM_FRAME, 0],
                        ['track-2', 65, SEAM_FRAME, 0],
                    ])
                );
            });
        });
    });
});
