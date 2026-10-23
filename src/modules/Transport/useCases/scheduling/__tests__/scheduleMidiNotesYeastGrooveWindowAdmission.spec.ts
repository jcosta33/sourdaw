import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Clip, trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    defaultGrooveTemplateState,
    grooveTemplateStore,
    midiStore,
    type GrooveTemplateState,
} from '#/modules/MIDI/stores';
import { projectClipMidiEvents, projectCommittedGroove } from '#/modules/MIDI/useCases';
import { scheduleNote } from '#/modules/Synth/useCases';
import { processYeastMidi } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { scheduleMidiNotes } from '../scheduleMidiNotes';

/** Types withheld only inside tests that exercise the generic admission guard. */
const injectedWithheldDeviceTypes = vi.hoisted(() => new Set<string>());

// Both real groove projections, captured by the barrel mock below so a
// beforeEach can point the mocked barrel exports back at them. The window
// admission under test is decided by the production `applyGrooveTemplate`
// math through the real `projectClipMidiEvents` — an identity projection stub
// is what let a groove-displaced start escape the looped phase index (#4657
// finding), and this spec exists because that same math displaces the start
// across the window edge after ownership admitted it (#4910).
const realGrooveProjections = vi.hoisted(() => ({
    projectClipMidiEvents: null as null | (typeof import('#/modules/MIDI/useCases'))['projectClipMidiEvents'],
    projectCommittedGroove: null as null | (typeof import('#/modules/MIDI/useCases'))['projectCommittedGroove'],
}));

// The swept `midiStore` view; the barrel mock below serves this holder so the
// existing per-test writes keep working while the rest of the barrel stays real.
const midiStoreView = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('#/infra/release/deviceReleaseAdmission', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/release/deviceReleaseAdmission')>();
    return {
        ...actual,
        isDeviceReleaseAdmitted: (deviceType: string) =>
            !injectedWithheldDeviceTypes.has(deviceType) && actual.isDeviceReleaseAdmitted(deviceType),
    };
});

const shouldPlayProbability = vi.hoisted(() => vi.fn((_input: { eventId: string }) => true));
const registerScheduledSourceMock = vi.hoisted(() => vi.fn<(node: AudioScheduledSourceNode) => void>());

vi.mock('#/modules/Arrangement/stores', () => ({
    activeRecordingRef: { current: [] },
    trackStore: { value: { tracks: [] } },
    // Pulled in transitively: the real MIDI use-case barrel below reaches
    // Levain's param bridge, whose dependency bundle destructures these off
    // this barrel at module scope. A factory that omits them fails the whole
    // file at import, not at a test.
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));
vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/stores')>();
    return {
        ...actual,
        // The scheduler reads notes through this one binding; everything else in
        // the barrel — `grooveTemplateStore` included — stays real so both
        // committed-groove projections below run the production lookup.
        midiStore: {
            get value() {
                return midiStoreView.value;
            },
            set value(next: unknown) {
                midiStoreView.value = next;
            },
        },
    };
});
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
    startNoteExpression: vi.fn(),
    advanceNoteExpression: vi.fn(),
    relocateNoteExpression: vi.fn(),
    registerScheduledSource: registerScheduledSourceMock,
    // The one definition of the MPE member default, as the production barrel
    // exports it (audit MD-8).
    getDefaultBendRangeSemitones: () => 48,
    getNoteExpressionDimensions: () => [],
    getCompensationDelay: vi.fn(() => 0),
    ensureTrackStrip: vi.fn(() => ({ gainNode: {}, preFaderTap: { connect: vi.fn() } })),
    getTrackStrip: vi.fn(),
    getCurrentTime: vi.fn(() => 0),
    getDrumKitByIndex: vi.fn(() => null),
    getAudioContext: vi.fn(() => ({
        sampleRate: 48000,
        createGain: vi.fn(() => ({ connect: vi.fn() })),
    })),
    scheduleFaustNote: vi.fn(),
    // Pulled in transitively by Levain's param bridge and the web-MIDI
    // message-handler bundle through the real MIDI use-case barrel below;
    // omitted members fail the file at import.
    getFactoryDrumKitByIndex: vi.fn(() => null),
    isDeviceCarriedByNativeSession: vi.fn(() => false),
    sendNativeLiveMidiControl: vi.fn(),
    sendNativeLiveMidiNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
}));
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: vi.fn(() => null),
    // Web-MIDI message-handler bundle, via the real MIDI use-case barrel.
    getSynthParamsFromDevices: vi.fn(() => ({})),
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: vi.fn(),
}));
vi.mock('#/modules/Yeast/useCases', () => ({
    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: vi.fn(() => ({ earlyBeats: 0, lateBeats: 0 })),
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/useCases')>();
    // Both projections stay real: `processLiveYeastTrackBlock` owns the note
    // through the clip-groove export, and the dispatch projects the owned note
    // through `projectClipMidiEvents`, whose sequencer-groove application is
    // the displacement that drops it.
    realGrooveProjections.projectClipMidiEvents = actual.projectClipMidiEvents;
    realGrooveProjections.projectCommittedGroove = actual.projectCommittedGroove;
    return {
        ...actual,
        getChordAtBeat: vi.fn(),
        projectClipMidiEvents: vi.fn(),
        projectCommittedGroove: vi.fn(actual.projectCommittedGroove),
        resolveMidiNoteArticulationId: ({ deviceType, articulation }: { deviceType: string; articulation?: string }) =>
            deviceType === 'levain' && articulation === 'staccato' ? 8 : null,
        transposeForChordTrack: vi.fn((param: unknown) => param),
        shouldPlayMidiEvent: shouldPlayProbability,
    };
});
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

// #4910 — `processLiveYeastTrackBlock` admits a live Yeast note-on at its
// audible pre-sequencer-groove beat, but the dispatch then re-tests the start
// `projectClipMidiEvents` produced AFTER applying the sequencer:project groove
// against the same window. A groove displacing that start across a window edge
// dropped a note ownership had already accepted. These cases seed a real
// sequencer groove and sweep the production 10 ms scheduler grain over the
// note, the same harness the content-offset spec uses.
describe('scheduleMidiNotes — Yeast note vs the sequencer groove at the scheduler window edge', () => {
    // 120 BPM at 48 kHz: one beat lasts half a second, so a scheduled time or
    // duration in seconds converts to beats by doubling it.
    const BEATS_PER_SECOND = 2;
    // Production grain: a 10 ms tick is 0.02 beats at 120 BPM.
    const WINDOW_BEATS = 0.02;

    type ScheduledVoice = { beat: number; durationBeats: number; pitch: number };

    /**
     * A 1/8-grid groove: 0.5-beat steps, 8 slots per 4/4 bar, so a note's grid
     * slot is `Math.round(beat / 0.5) % 8` — beat 2.5 sits on slot 5, beat 3 on
     * slot 6, beat 1/32 on slot 0. A `timingOffset` of 0.5 at full amount
     * displaces a note on that slot by ±0.25 beats — the groove's maximum
     * legal reach.
     */
    function sequencerGrooveState(slot: { index: number; timingOffset: number }): GrooveTemplateState {
        return {
            templates: [
                {
                    id: 'groove-window-edge',
                    name: 'Window edge',
                    schemaVersion: 1,
                    subdivision: '1/8',
                    slots: [{ ...slot, dynamicsOffset: 0 }],
                    provenance: { type: 'user', sourceId: 'spec' },
                },
            ],
            assignments: [
                { consumerType: 'sequencer', consumerId: 'project', templateId: 'groove-window-edge', amount: 1 },
            ],
        };
    }

    async function sweepScheduledVoices(options: {
        clip?: Record<string, unknown>;
        note: { startBeat: number; duration: number };
        grooveState: GrooveTemplateState;
        sweepEndBeat?: number;
    }): Promise<ScheduledVoice[]> {
        grooveTemplateStore.set(options.grooveState);
        const track = midiTrack({
            clips: [midiClip(options.clip)],
            devices: [{ id: 'yeast-rack', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [
                    {
                        id: 'n1',
                        pitch: 60,
                        startBeat: options.note.startBeat,
                        duration: options.note.duration,
                        velocity: 100,
                    },
                ],
            },
        };
        vi.mocked(scheduleNote).mockClear();
        const windowCount = Math.round((options.sweepEndBeat ?? 4) / WINDOW_BEATS);
        for (let step = 0; step < windowCount; step++) {
            const fromBeat = step * WINDOW_BEATS;
            // `accumulatedPosition` is anchored at 0, so every scheduled time is
            // the note's absolute position from the transport start and the
            // sweep reads positions, not per-window offsets.
            await scheduleMidiNotes(
                fromBeat,
                fromBeat + WINDOW_BEATS,
                0,
                new Set<string>(),
                [],
                defaultTransportState,
                120
            );
        }
        return vi.mocked(scheduleNote).mock.calls.map((call) => ({
            pitch: call[2],
            beat: call[3] * BEATS_PER_SECOND,
            durationBeats: call[4] * BEATS_PER_SECOND,
        }));
    }

    async function voicesInSingleWindow(options: {
        fromBeat: number;
        toBeat: number;
        clip?: Record<string, unknown>;
        /** The audio clock's beat this window schedules against; defaults to the transport start, 0. */
        clockBeat?: number;
        note: { startBeat: number; duration: number };
        grooveState: GrooveTemplateState;
    }): Promise<ScheduledVoice[]> {
        grooveTemplateStore.set(options.grooveState);
        const track = midiTrack({
            clips: [midiClip(options.clip)],
            devices: [{ id: 'yeast-rack', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [
                    {
                        id: 'n1',
                        pitch: 60,
                        startBeat: options.note.startBeat,
                        duration: options.note.duration,
                        velocity: 100,
                    },
                ],
            },
        };
        vi.mocked(scheduleNote).mockClear();
        await scheduleMidiNotes(
            options.fromBeat,
            options.toBeat,
            options.clockBeat ?? 0,
            new Set<string>(),
            [],
            defaultTransportState,
            120
        );
        return vi.mocked(scheduleNote).mock.calls.map((call) => ({
            pitch: call[2],
            beat: call[3] * BEATS_PER_SECOND,
            durationBeats: call[4] * BEATS_PER_SECOND,
        }));
    }

    beforeEach(() => {
        vi.clearAllMocks();
        injectedWithheldDeviceTypes.clear();
        (trackStore as { value: unknown }).value = { tracks: [] };
        midiStoreView.value = null;
        (automationStore as { value: unknown }).value = null;
        (tempoMapStore as { value: unknown }).value = { changes: [] };
        (timeSignatureMapStore as { value: unknown }).value = { changes: [] };
        grooveTemplateStore.set(defaultGrooveTemplateState);
        vi.mocked(resolveClipsWithComping).mockImplementation((_trackId, clips) =>
            clips.map((clip) => ({
                ...clip,
                regionStartBeat: clip.startBeat,
                regionEndBeat: clip.endBeat,
                sourceStartBeat: clip.startBeat,
            }))
        );
        vi.mocked(processYeastMidi).mockImplementation((input) => Promise.resolve([...input.events]));
        vi.mocked(ensureTrackStrip).mockImplementation(
            () =>
                ({
                    gainNode: {},
                    preFaderTap: { connect: vi.fn() },
                    deviceNodes: [],
                }) as never
        );
        shouldPlayProbability.mockImplementation(() => true);
        // The barrel mock replaces both projections with stubs; each test runs
        // the production math, so every test re-points them here.
        const clipProjection = realGrooveProjections.projectClipMidiEvents;
        const committedProjection = realGrooveProjections.projectCommittedGroove;
        if (!clipProjection || !committedProjection) {
            throw new Error('the groove projections were not captured from the MIDI use-cases barrel');
        }
        vi.mocked(projectClipMidiEvents).mockImplementation((input) => clipProjection(input));
        vi.mocked(projectCommittedGroove).mockImplementation((input) => committedProjection(input));
    });

    it('schedules a note owned at the window start edge when the groove displaces it back across that edge', async () => {
        // The note is owned at beat 2.5 by the sweep window starting there.
        // Slot-5 timingOffset −0.5 at full amount displaces the projected start
        // to 2.25, behind that window's start — the re-test on the projected
        // coordinate dropped a note ownership had already accepted.
        expect(
            await sweepScheduledVoices({
                note: { startBeat: 2.5, duration: 0.5 },
                grooveState: sequencerGrooveState({ index: 5, timingOffset: -0.5 }),
            })
        ).toEqual([{ pitch: 60, beat: 2.25, durationBeats: 0.5 }]);
    });

    it('schedules a note owned at the window end edge when the groove displaces it forward across that edge', async () => {
        // Same owned beat 2.5, displaced the other way: the projected start 2.75
        // lands past the owning window's end, and the re-test dropped it.
        expect(
            await sweepScheduledVoices({
                note: { startBeat: 2.5, duration: 0.5 },
                grooveState: sequencerGrooveState({ index: 5, timingOffset: 0.5 }),
            })
        ).toEqual([{ pitch: 60, beat: 2.75, durationBeats: 0.5 }]);
    });

    it('schedules a note whose groove displacement is exactly zero at its owned beat', async () => {
        // Honest boundary verification: with the groove assigned but this
        // note's slot carrying no timing offset, the projected start equals the
        // owned beat and the note was never dropped. The issue's "drops at
        // offset 0 too" holds only for a note sitting on a grid position whose
        // slot carries an offset — a note at grid offset 0 hits slot 0, covered
        // by the looped case below.
        expect(
            await sweepScheduledVoices({
                note: { startBeat: 2.5, duration: 0.5 },
                grooveState: sequencerGrooveState({ index: 5, timingOffset: 0 }),
            })
        ).toEqual([{ pitch: 60, beat: 2.5, durationBeats: 0.5 }]);
    });

    it('keeps a note beyond the window by more than the groove can reach dropped', async () => {
        // The window is not a free pass: a note owned at beat 3 sits outside
        // [2.5, 2.52) by 0.48 beats — past the 0.25-beat groove reach — so this
        // window must not voice it even with the groove pulling toward the
        // window. Its own window owns and voices it.
        expect(
            await voicesInSingleWindow({
                fromBeat: 2.5,
                toBeat: 2.52,
                note: { startBeat: 3, duration: 0.5 },
                grooveState: sequencerGrooveState({ index: 6, timingOffset: -0.5 }),
            })
        ).toEqual([]);
    });

    it('drops the release a duration wrap re-anchors a full loop behind the owning window', async () => {
        // #4910 admission — content 3.9 with a 0.5-beat duration in a 4-beat
        // loop crosses the iteration end at 4, and the projection re-anchors
        // the release to the iteration head: beat 0, a full loop length
        // behind the window that owns the note at 3.9. No groove is involved
        // — the duration wrap alone produces the segment — and scheduling it
        // computes a start ~1.94 s behind the audio clock, which Web Audio
        // clamps to an immediate fire: a spurious second attack on every
        // pass. Only the in-window heads may sound.
        expect(
            await sweepScheduledVoices({
                clip: { endBeat: 8, loopEnabled: true, loopLength: 4 },
                note: { startBeat: 3.9, duration: 0.5 },
                grooveState: defaultGrooveTemplateState,
                sweepEndBeat: 8,
            })
        ).toEqual([
            { pitch: 60, beat: 3.9, durationBeats: 0.1 },
            { pitch: 60, beat: 7.9, durationBeats: 0.1 },
        ]);
    });

    it('drops the segment a groove displacement re-anchors across the iteration seam', async () => {
        // The same note with slot-0 timingOffset +0.5 displaces its projected
        // start to 4.15, across the iteration end; the projection wraps it to
        // the iteration head at 0.15 — 3.75 beats behind the window that owns
        // the note at 3.9. Every pass would fire that stale start
        // immediately, so the widened admission bound drops it and no voice
        // sounds from either pass.
        expect(
            await sweepScheduledVoices({
                clip: { endBeat: 8, loopEnabled: true, loopLength: 4 },
                note: { startBeat: 3.9, duration: 0.5 },
                grooveState: sequencerGrooveState({ index: 0, timingOffset: 0.5 }),
                sweepEndBeat: 8,
            })
        ).toEqual([]);
    });

    it('schedules a looped note the groove displaces across an iteration head where the twin re-anchors it', async () => {
        // Content 1/32 sits on grid slot 0; timingOffset −0.5 pulls the
        // projected start to −0.21875 inside the iteration, and the projection
        // re-anchors a looped displaced start a full loop away, to
        // `iterationStart + 3.78125`, with the release wrapping to the head.
        // Testing the re-anchored coordinate against the owning window dropped
        // every pass; the owned coordinate is what admits the note, and both
        // projected segments sound where the projection lands them.
        expect(
            await sweepScheduledVoices({
                clip: { endBeat: 8, loopEnabled: true, loopLength: 4 },
                note: { startBeat: 1 / 32, duration: 0.5 },
                grooveState: sequencerGrooveState({ index: 0, timingOffset: -0.5 }),
                sweepEndBeat: 8,
            })
        ).toEqual([
            { pitch: 60, beat: 0, durationBeats: 0.28125 },
            { pitch: 60, beat: 3.78125, durationBeats: 0.21875 },
            { pitch: 60, beat: 4, durationBeats: 0.28125 },
            { pitch: 60, beat: 7.78125, durationBeats: 0.21875 },
        ]);
    });

    // #4924 round two — the grace bound above keeps a wrap tail only while it
    // lands more than one groove stage behind the owning window, but a duration
    // tail is re-anchored to the iteration head at its note's own loop phase —
    // arbitrarily close behind it. The clock, not a window grace, decides
    // staleness: these cases run a single window with `clockBeat` at the window
    // start (the wrap tick where the scheduler sits at the position it
    // re-opened), so a voice's read position is its landing minus the clock —
    // 0 reads "due exactly now", a negative read is a start in the past that
    // Web Audio clamps to an immediate fire.
    describe('when a duration tail is re-anchored behind the audio clock', () => {
        const loopedClip = { endBeat: 8, loopEnabled: true, loopLength: 4 };

        it('drops the stale tail at loop phase 0.1 and still voices the on-time segment', async () => {
            // A 4.05-beat note at phase 0.1 rings 0.1 beats past its iteration;
            // the projection re-anchors that tail to the iteration head: start
            // 0, just 0.1 beats behind the window that owns the note at 0.1 —
            // inside the 0.25 grace, so the landed bound voiced it — yet behind
            // the clock at 0.1. Its time computes to 0.05 s before the audio
            // clock, which clamps it to an immediate fire: a flam on the true
            // onset, every pass. The clock at the window start decides instead:
            // the tail drops and the on-time head sounds at the clock.
            expect(
                await voicesInSingleWindow({
                    fromBeat: 0.1,
                    toBeat: 0.12,
                    clip: loopedClip,
                    clockBeat: 0.1,
                    note: { startBeat: 0.1, duration: 4.05 },
                    grooveState: defaultGrooveTemplateState,
                })
            ).toEqual([{ pitch: 60, beat: 0, durationBeats: 3.9 }]);
        });

        it('drops the same stale tail at loop phase 0.25 where the grace bound ends exactly', async () => {
            // The phase where the landed grace bound ended: the re-anchored
            // tail at 0 sits exactly at `fromBeat − 0.25`, which the strict `<`
            // admitted, while the clock at 0.25 makes it a 0.125 s past start.
            // Same flam, and the same clock bound drops it while the on-time
            // head sounds at the clock.
            expect(
                await voicesInSingleWindow({
                    fromBeat: 0.25,
                    toBeat: 0.27,
                    clip: loopedClip,
                    clockBeat: 0.25,
                    note: { startBeat: 0.25, duration: 4.05 },
                    grooveState: defaultGrooveTemplateState,
                })
            ).toEqual([{ pitch: 60, beat: 0, durationBeats: 3.75 }]);
        });

        it('schedules a landing at the clock position — only a start behind it by more than rounding is stale', async () => {
            // Boundary of the time formula `now + (landing − clock) in seconds`:
            // a landing on the clock computes `now` — the onset is due that
            // instant, so scheduling it is the correct fire, not an early one.
            // The tail-free note at phase 0.1 isolates that landing, and the
            // projection's modulo round-trip really returns it a few ulp below
            // the clock (0.09999999999999964), so this case also pins the
            // rounding tolerance that keeps wrap noise from reading as
            // staleness; any wider grace or a `<=` bound without it fails here.
            expect(
                await voicesInSingleWindow({
                    fromBeat: 0.1,
                    toBeat: 0.12,
                    clip: loopedClip,
                    clockBeat: 0.1,
                    note: { startBeat: 0.1, duration: 0.5 },
                    grooveState: defaultGrooveTemplateState,
                })
            ).toEqual([{ pitch: 60, beat: 0, durationBeats: 0.5 }]);
        });
    });

    // #5198 review — the synth chain's loop-window membership is one figure:
    // the committed clip groove displaces the stored start FIRST and every
    // gate (the generator's admission, the per-note test, the shared
    // projection) windows the GROOVED figure, so a groove carrying a note
    // across a bound flips its admission on the live and offline twins
    // together. These cases run the plain synth path (no Yeast device) over
    // the review's diverging populations.
    describe('the committed clip groove and the anchored loop window read one figure', () => {
        /**
         * A 1/8-grid groove displacing EVERY note +0.25 beats at full amount:
         * all eight slots carry the 0.5-step `timingOffset`, so the
         * displacement never depends on where the note sits on the grid.
         */
        function clipGrooveState(): GrooveTemplateState {
            return {
                templates: [
                    {
                        id: 'groove-clip-push',
                        name: 'Clip push',
                        schemaVersion: 1,
                        subdivision: '1/8',
                        slots: Array.from({ length: 8 }, (_slot, index) => ({
                            index,
                            timingOffset: 0.5,
                            dynamicsOffset: 0,
                        })),
                        provenance: { type: 'user', sourceId: 'spec' },
                    },
                ],
                assignments: [
                    { consumerType: 'clip', consumerId: 'clip-1', templateId: 'groove-clip-push', amount: 1 },
                ],
            };
        }

        // Clip start 2 under anchor 0 is a +2 advance whose window reads
        // [−2, 2); the +1 slip stores offset 3. Both probe figures are dyadic,
        // so every gate compares exact floats.
        function anchoredSlippedClip(): Record<string, unknown> {
            return {
                startBeat: 2,
                endBeat: 10,
                loopEnabled: true,
                loopLength: 4,
                loopOriginBeat: 0,
                midiOffsetBeats: 3,
            };
        }

        const probeNotes = [
            { id: 'n-grooved-in', pitch: 60, startBeat: 0.75, duration: 0.25, velocity: 100 },
            { id: 'n-grooved-out', pitch: 72, startBeat: 4.75, duration: 0.25, velocity: 100 },
        ];

        async function sweepSynthVoices(grooveState: GrooveTemplateState): Promise<ScheduledVoice[]> {
            grooveTemplateStore.set(grooveState);
            const track = midiTrack({ clips: [midiClip(anchoredSlippedClip())] });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = { notesByClipId: { 'clip-1': probeNotes } };
            vi.mocked(scheduleNote).mockClear();
            const windowCount = Math.round(6 / WINDOW_BEATS);
            for (let step = 0; step < windowCount; step++) {
                const fromBeat = step * WINDOW_BEATS;
                await scheduleMidiNotes(
                    fromBeat,
                    fromBeat + WINDOW_BEATS,
                    0,
                    new Set<string>(),
                    [],
                    defaultTransportState,
                    120
                );
            }
            return vi.mocked(scheduleNote).mock.calls.map((call) => ({
                pitch: call[2],
                beat: call[3] * BEATS_PER_SECOND,
                durationBeats: call[4] * BEATS_PER_SECOND,
            }));
        }

        it('sounds the raw-below-floor row the groove pulls inside and silences the raw-inside row it pushes past the ceiling, on both twins', async () => {
            // The row at 0.75 reads raw −2.25 — below the floor, refused by
            // every gate that reads the stored figure — while its grooved
            // figure −2.0 sits exactly on the inclusive floor. The row at 4.75
            // reads raw 1.75 — inside — while its grooved figure 2.0 sits past
            // the exclusive ceiling. The live chain must voice the first at
            // its displaced pass placement (wrapped onto beat 4) and never
            // voice the second; the offline projection over the whole stored
            // set must emit exactly the same single event.
            const voices = await sweepSynthVoices(clipGrooveState());
            expect(voices).toEqual([{ pitch: 60, beat: 4, durationBeats: 0.25 }]);

            expect(
                projectClipMidiEvents({
                    events: probeNotes,
                    clipId: 'clip-1',
                    clipStartBeat: 2,
                    clipEndBeat: 10,
                    iterationStartBeat: 2,
                    loopLengthBeats: 4,
                    midiOffsetBeats: 3,
                    loopEnabled: true,
                    loopOriginBeat: 0,
                }).map((event) => ({ id: event.id, startBeat: event.startBeat, duration: event.duration }))
            ).toEqual([{ id: 'n-grooved-in', startBeat: 4, duration: 0.25 }]);
        });

        it('control: without the groove the same stored rows admit the other way', async () => {
            // The stored figures alone refuse the 0.75 row (raw −2.25, below
            // the floor) and admit the 4.75 row (raw 1.75, inside): the flip
            // above is the groove's doing, and the admitted row places
            // undisplaced at 3.75.
            const voices = await sweepSynthVoices(defaultGrooveTemplateState);
            expect(voices).toEqual([{ pitch: 72, beat: 3.75, durationBeats: 0.25 }]);
        });
    });
});
