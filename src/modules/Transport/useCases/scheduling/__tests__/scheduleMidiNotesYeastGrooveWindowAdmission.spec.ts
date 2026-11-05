import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Clip, trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip, projectOfflineYeastTrackNotes } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    defaultGrooveTemplateState,
    grooveTemplateStore,
    midiStore,
    type GrooveTemplateState,
} from '#/modules/MIDI/stores';
import { createGrooveMidiEventProjector, projectClipMidiEvents, projectCommittedGroove } from '#/modules/MIDI/useCases';
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
    // The AudioEngine use-case double loads the real bounce projection with
    // `vi.importActual`, which the barrel-mock coverage check reads as loading
    // that whole barrel; these are what its offline render reads from here.
    addWarpMarker: vi.fn(),
    adjustmentLayerStore: { value: null },
    clampDeviceParamWrite: vi.fn(),
    clipHasActiveGainEnvelope: vi.fn(() => false),
    deriveEffectiveAudibility: vi.fn(),
    deriveVcaMultiplier: vi.fn(() => 1),
    gainEnvelopeStore: { value: null },
    getGainEnvelopeSeries: vi.fn(),
    getStoredWarpState: vi.fn(),
    getTrackEligibility: vi.fn(),
    getVcaGroupsState: vi.fn(),
    getWarpState: vi.fn(),
    setWarpState: vi.fn(),
    shouldCreateLiveTrackStrip: vi.fn(),
    soloModeStore: { value: null },
    takeLaneStore: { value: null },
    vcaGroupStore: { value: null },
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
    // Read by the AudioEngine offline render (see the Arrangement stores double).
    modulationStore: { value: null },
}));
vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
    // Read by the AudioEngine offline render (see the Arrangement stores double).
    buildOfflineModulatorPlans: vi.fn(),
    getAutomationLaneCeiling: vi.fn(),
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
vi.mock('#/modules/AudioEngine/useCases', async () => ({
    // The bounce's own Yeast projection: what the export renders is what the
    // live windows are compared against, so the barrel serves the real one.
    projectOfflineYeastTrackNotes: (
        await vi.importActual<Pick<typeof import('#/modules/AudioEngine/useCases'), 'projectOfflineYeastTrackNotes'>>(
            '#/modules/AudioEngine/useCases/offlineRender/projectOfflineYeastTrackNotes'
        )
    ).projectOfflineYeastTrackNotes,
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
    // Read by the AudioEngine offline render (see the Arrangement stores double).
    scheduleNoteOffline: vi.fn(),
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
        opensAtRelocation?: boolean;
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
            120,
            undefined,
            options.opensAtRelocation ?? false
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

    it('strikes the part of a note past its pass end on the head of the same pass, from the window holding the head', async () => {
        // #4910 admission — content 3.9 with a 0.5-beat duration in a 4-beat
        // loop crosses the pass end at 4. The pass releases it there and
        // strikes the remaining 0.4 beats on its own head, as the synth route
        // does. The rack must be handed that tail as its own note: wrapped
        // onto the head after the rack, it was due a full loop behind the
        // window that owns the note at 3.9 — a start ~1.94 s behind the audio
        // clock, which Web Audio clamps to an immediate fire. As its own
        // note-on it is owned by the window holding the head and sounds there.
        expect(
            await sweepScheduledVoices({
                clip: { endBeat: 8, loopEnabled: true, loopLength: 4 },
                note: { startBeat: 3.9, duration: 0.5 },
                grooveState: defaultGrooveTemplateState,
                sweepEndBeat: 8,
            })
        ).toEqual([
            { pitch: 60, beat: 0, durationBeats: 0.4 },
            { pitch: 60, beat: 3.9, durationBeats: 0.1 },
            { pitch: 60, beat: 4, durationBeats: 0.4 },
            { pitch: 60, beat: 7.9, durationBeats: 0.1 },
        ]);
    });

    it('sounds only the in-pass part of the length a rack adds past the pass end', async () => {
        // A rack that lengthens every note fourfold turns the 0.25-beat note
        // at 3.5 into one running to 4.5, past the pass end. A head re-strike
        // of the added length would be due at the pass head, which the windows
        // playing this pass have long passed: the projection ends it at the
        // pass end, and the clock floor would drop a stale head segment
        // anyway, so this pins the live output only. The bounce, which has no
        // clock floor, pins the cut itself (projectOfflineYeastTrackNotes).
        function lengthenFourfold<Event extends { durationSamples?: number }>(event: Event): Event {
            if (event.durationSamples === undefined) {
                return event;
            }
            return { ...event, durationSamples: event.durationSamples * 4 };
        }
        vi.mocked(processYeastMidi).mockImplementation((input) => Promise.resolve(input.events.map(lengthenFourfold)));
        expect(
            await sweepScheduledVoices({
                clip: { endBeat: 8, loopEnabled: true, loopLength: 4 },
                note: { startBeat: 3.5, duration: 0.25 },
                grooveState: defaultGrooveTemplateState,
                sweepEndBeat: 8,
            })
        ).toEqual([
            { pitch: 60, beat: 3.5, durationBeats: 0.5 },
            { pitch: 60, beat: 7.5, durationBeats: 0.5 },
        ]);
    });

    it('strikes the segment a sequencer push carries past the pass end on the head of the same pass, from the window holding the head', async () => {
        // The same note under slot-0 timingOffset +0.5: its in-pass segment at
        // 3.9 and its head tail at the pass head both sit on slot 0. The groove
        // pushes the head tail 0.25 inside its own pass, and the in-pass
        // segment to 4.15, past the pass end, which the loop law puts on the
        // head of the same pass at 0.15. Pushed after the rack, that landing
        // was 3.75 beats behind the window owning the note at 3.9 and dropped
        // as stale. The push is placed before the rack instead, so the window
        // holding the head owns it and every pass sounds it there. Voices list
        // in posting order: the head tail is owned at the head and pushed
        // after the rack, the push is owned where it lands.
        expect(
            await sweepScheduledVoices({
                clip: { endBeat: 8, loopEnabled: true, loopLength: 4 },
                note: { startBeat: 3.9, duration: 0.5 },
                grooveState: sequencerGrooveState({ index: 0, timingOffset: 0.5 }),
                sweepEndBeat: 8,
            })
        ).toEqual([
            { pitch: 60, beat: 0.25, durationBeats: 0.4 },
            { pitch: 60, beat: expect.closeTo(0.15, 9), durationBeats: expect.closeTo(0.1, 9) },
            { pitch: 60, beat: 4.25, durationBeats: 0.4 },
            { pitch: 60, beat: expect.closeTo(4.15, 9), durationBeats: expect.closeTo(0.1, 9) },
        ]);
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

    // #4924 round two — a duration tail sounds on the pass head, at its note's
    // own loop phase behind the window that owns the note: arbitrarily close
    // behind it. Wrapped onto the head after the rack, that window scheduled
    // it behind the clock. The tail is its own note-on at the head now, owned
    // by the window holding the head, never by the window holding its note.
    // These cases run a single window with `clockBeat` at the window start
    // (the wrap tick where the scheduler sits at the position it re-opened),
    // so a voice's read position is its landing minus the clock — 0 reads
    // "due exactly now", a negative read is a start in the past that Web Audio
    // clamps to an immediate fire.
    describe('when the window owning a note opens after its pass head', () => {
        const loopedClip = { endBeat: 8, loopEnabled: true, loopLength: 4 };

        it('leaves the head tail at loop phase 0.1 to the head window and voices the on-time segment', async () => {
            // A 4.05-beat note at phase 0.1 keeps one loop of its length and
            // runs 0.1 beats past its pass end; the pass strikes that tail on
            // its head at 0, just 0.1 beats behind the window that owns the
            // note at 0.1 and behind the clock there. Scheduled from this
            // window it computes 0.05 s before the audio clock, which clamps it
            // to an immediate fire: a flam on the true onset, every pass. Only
            // the on-time segment, released at the pass end, sounds here.
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

        it('leaves the same head tail at loop phase 0.25 to the head window, one groove stage behind', async () => {
            // The phase where the landed grace bound ended: the head tail at 0
            // sits exactly at `fromBeat − 0.25`, one groove stage behind, which
            // the strict `<` admitted, while the clock at 0.25 makes it a
            // 0.125 s past start. Same flam, so this window voices only the
            // on-time segment at the clock.
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

    // A tick that arrives late by less than one look-ahead keeps its window
    // continuing from the high-water mark, so the audio clock stands past the
    // window start and the window's first notes are due in the past. Plain
    // MIDI, clicks and audio play them late; an owned Yeast note must too.
    // These cases put the clock 0.04 beats (20 ms) past the window start, so
    // a note owned at the window start reads −0.04: scheduled 20 ms late.
    describe('when a continuing window opens behind the audio clock', () => {
        const loopedClip = { endBeat: 8, loopEnabled: true, loopLength: 4 };

        it('plays the note owned at the window start late', async () => {
            const voices = await voicesInSingleWindow({
                fromBeat: 1,
                toBeat: 1.2,
                clockBeat: 1.04,
                note: { startBeat: 1, duration: 0.5 },
                grooveState: defaultGrooveTemplateState,
            });
            expect(voices).toHaveLength(1);
            expect(voices[0]?.beat).toBeCloseTo(-0.04, 9);
            expect(voices[0]?.durationBeats).toBeCloseTo(0.5, 9);
        });

        it('voices no head tail behind the window start', async () => {
            // The note at phase 0.1 strikes its 0.1-beat tail on the pass head
            // at 0, behind the window start the scheduler continues from:
            // the window holding the head owned it, and this one must not
            // fire it again. Only the segment owned at the window start
            // sounds, late.
            const voices = await voicesInSingleWindow({
                fromBeat: 0.1,
                toBeat: 0.3,
                clip: loopedClip,
                clockBeat: 0.14,
                note: { startBeat: 0.1, duration: 4.05 },
                grooveState: defaultGrooveTemplateState,
            });
            expect(voices).toHaveLength(1);
            expect(voices[0]?.beat).toBeCloseTo(-0.04, 9);
            expect(voices[0]?.durationBeats).toBeCloseTo(3.9, 9);
        });

        it('keeps the clock floor in a relocating window', async () => {
            // A relocation opens at its destination; content behind the
            // clock there was never this pass's to play.
            expect(
                await voicesInSingleWindow({
                    fromBeat: 1,
                    toBeat: 1.2,
                    clockBeat: 1.04,
                    opensAtRelocation: true,
                    note: { startBeat: 1, duration: 0.5 },
                    grooveState: defaultGrooveTemplateState,
                })
            ).toEqual([]);
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
            // set must emit exactly the same single event — on the pass the
            // anchor's grid opens at the seam 4, half a loop past the head.
            const voices = await sweepSynthVoices(clipGrooveState());
            expect(voices).toEqual([{ pitch: 60, beat: 4, durationBeats: 0.25 }]);

            expect(
                projectClipMidiEvents({
                    events: probeNotes,
                    clipId: 'clip-1',
                    clipStartBeat: 2,
                    clipEndBeat: 10,
                    iterationStartBeat: 4,
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

    // Live playback hands the rack one look-ahead window at a time; the bounce
    // hands it the whole render. A looping clip must sound the same notes at
    // the same beats on both, wherever the windows fall. Each case sweeps a
    // three-pass clip under irregular partitions that straddle the seams and
    // the pass heads, and compares the voices with the offline projection of
    // the same clip through the same identity rack. A realistic clock stands
    // at each window's start, so a voice landing before the window that
    // posted it would be a note scheduled in the past.
    describe('live windows sound what the bounce renders', () => {
        const PASS_COUNT = 3;
        const LOOP_BEATS = 4;
        const CLIP_END_BEAT = PASS_COUNT * LOOP_BEATS;

        type Row = { id: string; startBeat: number; duration: number };
        /** The looped clip both routes play: its end and loop, and its anchor when it carries one. */
        type LoopedClip = { endBeat: number; loopEnabled: boolean; loopLength: number; loopOriginBeat?: number };
        type Voice = { beat: number; durationBeats: number };

        function windowEdges(widths: readonly number[], lastEdge = CLIP_END_BEAT): number[] {
            const edges = [0];
            for (let index = 0; edges.at(-1)! < lastEdge; index++) {
                edges.push(Math.min(lastEdge, edges.at(-1)! + widths[index % widths.length]!));
            }
            return edges;
        }

        const PARTITIONS = [
            { partition: 'the production grain', widths: [WINDOW_BEATS] },
            { partition: 'irregular windows straddling the seams', widths: [0.3, 0.7, 0.13] },
            { partition: 'wide and narrow windows', widths: [1.1, 0.05, 0.9, 0.37] },
        ];

        function rounded(voice: Voice): Voice {
            return {
                beat: Math.round(voice.beat * 1e6) / 1e6,
                durationBeats: Math.round(voice.durationBeats * 1e6) / 1e6,
            };
        }

        function inBeatOrder(voices: readonly Voice[]): Voice[] {
            return voices
                .map(rounded)
                .sort((left, right) => left.beat - right.beat || left.durationBeats - right.durationBeats);
        }

        async function liveVoices(
            clip: LoopedClip,
            rows: readonly Row[],
            grooveState: GrooveTemplateState,
            edges: readonly number[],
            route: 'yeast' | 'synth' = 'yeast'
        ): Promise<{ voices: Voice[]; postedBehindWindow: Voice[] }> {
            grooveTemplateStore.set(grooveState);
            const devices = route === 'yeast' ? [{ id: 'yeast-rack', type: 'yeast' }] : [];
            const track = midiTrack({ clips: [midiClip(clip)], devices });
            (trackStore as { value: unknown }).value = { tracks: [track] };
            (midiStore as { value: unknown }).value = {
                notesByClipId: { 'clip-1': rows.map((row) => ({ ...row, pitch: 60, velocity: 100 })) },
            };
            vi.mocked(scheduleNote).mockClear();
            vi.mocked(processYeastMidi).mockClear();
            const voices: Voice[] = [];
            const postedBehindWindow: Voice[] = [];
            for (let index = 1; index < edges.length; index++) {
                const fromBeat = edges[index - 1]!;
                const callsBefore = vi.mocked(scheduleNote).mock.calls.length;
                await scheduleMidiNotes(fromBeat, edges[index]!, 0, new Set<string>(), [], defaultTransportState, 120);
                for (const call of vi.mocked(scheduleNote).mock.calls.slice(callsBefore)) {
                    const voice = { beat: call[3] * BEATS_PER_SECOND, durationBeats: call[4] * BEATS_PER_SECOND };
                    voices.push(voice);
                    if (voice.beat < fromBeat - 1e-9) {
                        postedBehindWindow.push(rounded(voice));
                    }
                }
            }
            return { voices: inBeatOrder(voices), postedBehindWindow };
        }

        type RackInputEvent = { kind: { type: string }; noteInstanceId?: string; timePpq?: number };
        type RackNoteOff = { instance: string; beat: number };

        /** The note-offs a rack was handed, by the instance suffix after the row id and the beat. */
        function rackNoteOffs(events: readonly RackInputEvent[], rowId: string): RackNoteOff[] {
            const noteOffs = events.filter((event) => event.kind.type === 'noteOff');
            const placed = noteOffs.map((event) => {
                const instanceId = event.noteInstanceId ?? '';
                return {
                    instance: instanceId.slice(instanceId.indexOf(rowId)),
                    beat: Math.round((event.timePpq ?? Number.NaN) * 1e6) / 1e6,
                };
            });
            return placed.sort((left, right) => left.beat - right.beat || left.instance.localeCompare(right.instance));
        }

        function liveRackInput(): RackInputEvent[] {
            return vi.mocked(processYeastMidi).mock.calls.flatMap(([input]) => input.events);
        }

        function offlineVoices(
            clip: LoopedClip,
            rows: readonly Row[],
            grooveState: GrooveTemplateState,
            rackInput: RackInputEvent[] = []
        ): Voice[] {
            // A clip that does not loop plays once, its one pass as long as the clip.
            const passBeats = clip.loopEnabled ? LOOP_BEATS : clip.endBeat;
            const notes = projectOfflineYeastTrackNotes({
                trackId: 'track-1',
                iterations: Array.from({ length: clip.loopEnabled ? PASS_COUNT : 1 }, (_pass, pass) => ({
                    sourceNotes: rows.map((row) => ({ ...row, pitch: 60, velocity: 100 })),
                    clipId: 'clip-1',
                    clipStartBeat: 0,
                    clipEndBeat: clip.endBeat,
                    iterationStartBeat: pass * passBeats,
                    loopLengthBeats: passBeats,
                    midiOffsetBeats: 0,
                    loopEnabled: clip.loopEnabled,
                    loopOriginBeat: clip.loopOriginBeat,
                })),
                sampleRate: 48_000,
                blockStartSamples: 0,
                blockEndSamples: CLIP_END_BEAT * 48_000,
                defaultTempo: 120,
                changes: [],
                projectMidiEvents: createGrooveMidiEventProjector(grooveState),
                projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => ({
                    startSamples: startPpq * sampleRate,
                    endSamples: endPpq * sampleRate,
                    durationSamples: (endPpq - startPpq) * sampleRate,
                    startSeconds: startPpq,
                    endSeconds: endPpq,
                    durationSeconds: endPpq - startPpq,
                }),
                processYeastMidi: (input) => {
                    rackInput.push(...input.events);
                    return input.events.map((event) => ({
                        ...event,
                        timePpq: event.timePpq ?? event.timeSamples / 24_000,
                    }));
                },
                projectPitch: ({ pitch }) => pitch,
            });
            return inBeatOrder(
                notes.map((note) => ({ beat: note.startBeat, durationBeats: note.endBeat - note.startBeat }))
            );
        }

        describe('a row an anchorless loop stores past its loop length', () => {
            // Loop 4 with no anchor: content outside the loop region does not
            // play while the loop is on, so the row at relative beat 5 is
            // silent on every route — the synth route, the Yeast rack live and
            // the bounce — while the row inside the loop sounds on all three.
            const clip = { endBeat: CLIP_END_BEAT, loopEnabled: true, loopLength: LOOP_BEATS };
            const rows = [
                { id: 'past-loop-length', startBeat: 5, duration: 0.5 },
                { id: 'inside', startBeat: 2, duration: 0.5 },
            ];
            const IN_LOOP_VOICES = [2, 6, 10].map((beat) => ({ beat, durationBeats: 0.5 }));

            it('renders only the in-loop row in the bounce', () => {
                expect(offlineVoices(clip, rows, defaultGrooveTemplateState)).toEqual(IN_LOOP_VOICES);
            });

            it.each(PARTITIONS)(
                'plays only the in-loop row live on the Yeast and synth routes under $partition',
                async ({ widths }) => {
                    const edges = windowEdges(widths);
                    const yeast = await liveVoices(clip, rows, defaultGrooveTemplateState, edges);
                    const synth = await liveVoices(clip, rows, defaultGrooveTemplateState, edges, 'synth');
                    expect(yeast).toEqual({ voices: IN_LOOP_VOICES, postedBehindWindow: [] });
                    expect(synth).toEqual({ voices: IN_LOOP_VOICES, postedBehindWindow: [] });
                }
            );
        });

        describe('a segment the sequencer groove pushes across the pass end', () => {
            // The note at 3.9 crosses the pass end: the rack is handed its
            // in-pass segment [3.9, 4) and its tail [0, 0.4) on the pass head,
            // both on slot 0. Slot-0 timingOffset +0.5 pushes each 0.25 later:
            // the tail to 0.25 inside its pass, and the in-pass segment to
            // 4.15, past the pass end, which the loop law re-anchors to the
            // head of the same pass at 0.15, as the synth route places it.
            const clip = { endBeat: CLIP_END_BEAT, loopEnabled: true, loopLength: LOOP_BEATS };
            const rows = [{ id: 'crossing', startBeat: 3.9, duration: 0.5 }];
            const pushState = sequencerGrooveState({ index: 0, timingOffset: 0.5 });

            it('renders on the head of every pass in the bounce', () => {
                expect(offlineVoices(clip, rows, pushState)).toEqual(
                    [0, 4, 8].flatMap((passStart) => [
                        { beat: passStart + 0.15, durationBeats: 0.1 },
                        { beat: passStart + 0.25, durationBeats: 0.4 },
                    ])
                );
            });

            it.each(PARTITIONS)('plays there live under $partition', async ({ widths }) => {
                const live = await liveVoices(clip, rows, pushState, windowEdges(widths));
                expect(live.voices).toEqual(offlineVoices(clip, rows, pushState));
                expect(live.postedBehindWindow).toEqual([]);
            });
        });

        describe('a segment the sequencer groove pulls back across the pass head', () => {
            // The note at 1/32 sits on slot 0; timingOffset −0.5 pulls it to
            // −0.21875, before the pass head. The loop law re-anchors it to
            // 3.78125, ends it on the pass end, and strikes the 0.28125 beats
            // left on the head of the same pass at 0. Pulled after the rack,
            // that head strike was posted by the window owning the note at
            // 1/32, which opens after it: a note scheduled in the past.
            const clip = { endBeat: CLIP_END_BEAT, loopEnabled: true, loopLength: LOOP_BEATS };
            const rows = [{ id: 'pulled', startBeat: 1 / 32, duration: 0.5 }];
            const pullState = sequencerGrooveState({ index: 0, timingOffset: -0.5 });

            it('renders on the pass end and the head of every pass in the bounce', () => {
                expect(offlineVoices(clip, rows, pullState)).toEqual(
                    [0, 4, 8].flatMap((passStart) => [
                        { beat: passStart, durationBeats: 0.28125 },
                        { beat: passStart + 3.78125, durationBeats: 0.21875 },
                    ])
                );
            });

            it.each(PARTITIONS)('plays there live under $partition', async ({ widths }) => {
                const live = await liveVoices(clip, rows, pullState, windowEdges(widths));
                expect(live).toEqual({ voices: offlineVoices(clip, rows, pullState), postedBehindWindow: [] });
            });
        });

        describe('a note the clip groove and then the sequencer groove pull back across the pass head', () => {
            // The row at 0.3 starts inside its pass, more than one groove stage
            // after the head. The clip groove (slot 1 −0.5) moves it to 0.05,
            // onto slot 0, which the sequencer groove (−0.5) pulls to −0.2,
            // before the pass head: the pass plays its 0.2 beats on the pass
            // end at 3.8 and strikes the 0.3 beats left on its head. Two
            // groove stages after the head, it reaches the window holding the
            // pass end only if the phase index offers it there.
            const clip = { endBeat: CLIP_END_BEAT, loopEnabled: true, loopLength: LOOP_BEATS };
            const rows = [{ id: 'twice-pulled', startBeat: 0.3, duration: 0.5 }];
            const slotGroove = (id: string, index: number): GrooveTemplateState['templates'][number] => ({
                id,
                name: id,
                schemaVersion: 1,
                subdivision: '1/8',
                slots: [{ index, timingOffset: -0.5, dynamicsOffset: 0 }],
                provenance: { type: 'user', sourceId: 'spec' },
            });
            const twoStageState: GrooveTemplateState = {
                templates: [slotGroove('clip-pull', 1), slotGroove('sequencer-pull', 0)],
                assignments: [
                    { consumerType: 'clip', consumerId: 'clip-1', templateId: 'clip-pull', amount: 1 },
                    { consumerType: 'sequencer', consumerId: 'project', templateId: 'sequencer-pull', amount: 1 },
                ],
            };

            it('renders on the pass end and the head of every pass in the bounce', () => {
                expect(offlineVoices(clip, rows, twoStageState)).toEqual(
                    [0, 4, 8].flatMap((passStart) => [
                        { beat: passStart, durationBeats: 0.3 },
                        { beat: passStart + 3.8, durationBeats: 0.2 },
                    ])
                );
            });

            it.each(PARTITIONS)('plays there live under $partition', async ({ widths }) => {
                const live = await liveVoices(clip, rows, twoStageState, windowEdges(widths));
                expect(live).toEqual({ voices: offlineVoices(clip, rows, twoStageState), postedBehindWindow: [] });
            });
        });

        describe('a long note the clip groove pulls across the head and the sequencer groove pulls again', () => {
            // The row at 0.1 lasts 2 beats. The clip groove (slot 0 −0.5)
            // pulls it to −0.15, which the loop re-anchors to 3.85: its 0.15
            // in-pass beats end on the pass end and its 1.85-beat tail is
            // struck on the head. The sequencer groove (slot 0 −0.5) then pulls
            // both by 0.25: the in-pass segment, after the rack, to 3.6; the
            // tail, before the rack, back across the head onto 3.75, with the
            // 1.6 beats left struck on the head again and released at 1.6.
            const clip = { endBeat: CLIP_END_BEAT, loopEnabled: true, loopLength: LOOP_BEATS };
            const rows = [{ id: 'long-pulled', startBeat: 0.1, duration: 2 }];
            const slotGroove = (id: string): GrooveTemplateState['templates'][number] => ({
                id,
                name: id,
                schemaVersion: 1,
                subdivision: '1/8',
                slots: [{ index: 0, timingOffset: -0.5, dynamicsOffset: 0 }],
                provenance: { type: 'user', sourceId: 'spec' },
            });
            const twoStageState: GrooveTemplateState = {
                templates: [slotGroove('clip-pull'), slotGroove('sequencer-pull')],
                assignments: [
                    { consumerType: 'clip', consumerId: 'clip-1', templateId: 'clip-pull', amount: 1 },
                    { consumerType: 'sequencer', consumerId: 'project', templateId: 'sequencer-pull', amount: 1 },
                ],
            };
            // Two full pulls release the tail a whole two stages early: at 1.6
            // for the row below and at 1.4 for the crossing row, each exactly
            // one stage from the entry that must reach it, so windows that
            // close on those releases pin that edge for both classes.
            const LONG_PULL_PARTITIONS = [
                ...PARTITIONS,
                { partition: 'tenth-beat windows', widths: [0.1] },
                { partition: 'windows closing on the two-pull releases', widths: [1.4, 0.2, 2.4] },
            ];

            it('renders the pulled segment, the pulled tail and its head strike on every pass in the bounce', () => {
                expect(offlineVoices(clip, rows, twoStageState)).toEqual(
                    [0, 4, 8].flatMap((passStart) => [
                        { beat: passStart, durationBeats: 1.6 },
                        { beat: passStart + 3.6, durationBeats: 0.15 },
                        { beat: passStart + 3.75, durationBeats: 0.25 },
                    ])
                );
            });

            it.each(LONG_PULL_PARTITIONS)(
                'plays there live and hands the rack every release the bounce does under $partition',
                async ({ widths }) => {
                    const live = await liveVoices(clip, rows, twoStageState, windowEdges(widths));
                    const offlineRackInput: RackInputEvent[] = [];
                    const bounced = offlineVoices(clip, rows, twoStageState, offlineRackInput);
                    expect(live.voices).toEqual(bounced);
                    // Only the in-pass segment the sequencer groove pulls after
                    // the rack may land behind the window that owns it, by at
                    // most one stage: every Yeast note the project groove pulls
                    // does (#4910), and the clock floor admits it. Everything
                    // placed before the rack is posted from its own window.
                    const pulledAfterRack = [3.6, 7.6, 11.6].map((beat) => ({ beat, durationBeats: 0.15 }));
                    for (const behind of live.postedBehindWindow) {
                        expect(pulledAfterRack).toContainEqual(behind);
                    }
                    expect(rackNoteOffs(liveRackInput(), 'long-pulled')).toEqual(
                        rackNoteOffs(offlineRackInput, 'long-pulled')
                    );
                }
            );

            describe('when the note already crosses the pass end', () => {
                // The row at 3.9 lasts 2 beats. The clip groove (slot 0 −0.5)
                // pulls it to 3.65, still in its pass: 0.35 beats end on the
                // pass end and a 1.65-beat tail is struck on the head. The
                // sequencer groove leaves the in-pass segment (slot 7) where it
                // is and pulls the tail (slot 0) back across the head onto
                // 3.75, its 1.4 beats left struck on the head again and
                // released at 1.4, two stages before the 1.9 the uncut row
                // would release its tail at.
                const crossingRows = [{ id: 'twice-pulled-crossing', startBeat: 3.9, duration: 2 }];

                it('renders the segment, the pulled tail and its head strike on every pass in the bounce', () => {
                    expect(offlineVoices(clip, crossingRows, twoStageState)).toEqual(
                        [0, 4, 8].flatMap((passStart) => [
                            { beat: passStart, durationBeats: 1.4 },
                            { beat: passStart + 3.65, durationBeats: 0.35 },
                            { beat: passStart + 3.75, durationBeats: 0.25 },
                        ])
                    );
                });

                it.each(LONG_PULL_PARTITIONS)(
                    'plays there live and hands the rack every release the bounce does under $partition',
                    async ({ widths }) => {
                        const live = await liveVoices(clip, crossingRows, twoStageState, windowEdges(widths));
                        const offlineRackInput: RackInputEvent[] = [];
                        const bounced = offlineVoices(clip, crossingRows, twoStageState, offlineRackInput);
                        expect(live.voices).toEqual(bounced);
                        expect(rackNoteOffs(liveRackInput(), 'twice-pulled-crossing')).toEqual(
                            rackNoteOffs(offlineRackInput, 'twice-pulled-crossing')
                        );
                    }
                );
            });
        });

        describe('a note the clip groove and then the sequencer groove push across the pass end', () => {
            // The row at 3.6 ends well inside its pass. The clip groove (slot 7
            // +0.5) moves it to 3.85, onto slot 0 of the next bar, which the
            // sequencer groove (+0.5) pushes to 4.1, past the pass end: the
            // pass strikes it on its head at 0.1. Two groove stages from the
            // pass end, it reaches the head window only if the phase index
            // offers it there.
            const clip = { endBeat: CLIP_END_BEAT, loopEnabled: true, loopLength: LOOP_BEATS };
            const rows = [{ id: 'twice-pushed', startBeat: 3.6, duration: 0.05 }];
            const slotGroove = (id: string, index: number): GrooveTemplateState['templates'][number] => ({
                id,
                name: id,
                schemaVersion: 1,
                subdivision: '1/8',
                slots: [{ index, timingOffset: 0.5, dynamicsOffset: 0 }],
                provenance: { type: 'user', sourceId: 'spec' },
            });
            const twoStageState: GrooveTemplateState = {
                templates: [slotGroove('clip-push', 7), slotGroove('sequencer-push', 0)],
                assignments: [
                    { consumerType: 'clip', consumerId: 'clip-1', templateId: 'clip-push', amount: 1 },
                    { consumerType: 'sequencer', consumerId: 'project', templateId: 'sequencer-push', amount: 1 },
                ],
            };

            it('renders on the head of every pass in the bounce', () => {
                expect(offlineVoices(clip, rows, twoStageState)).toEqual(
                    [0, 4, 8].map((passStart) => ({ beat: passStart + 0.1, durationBeats: 0.05 }))
                );
            });

            it.each(PARTITIONS)('plays there live under $partition', async ({ widths }) => {
                const live = await liveVoices(clip, rows, twoStageState, windowEdges(widths));
                expect(live.voices).toEqual(offlineVoices(clip, rows, twoStageState));
                expect(live.postedBehindWindow).toEqual([]);
            });
        });

        describe('a release on the clip end', () => {
            // A rack device that holds a note until its note-off (the
            // arpeggiator's held pool) keeps a note whose release was never
            // posted. The bounce hands the rack the release on the clip end;
            // live playback must hand it exactly once, whichever window
            // closes on, opens on or straddles the clip end. The sweep runs a
            // beat past the clip end so a window opening on it runs too.
            const SWEEP_END_BEAT = CLIP_END_BEAT + 1;
            const CLIP_END_PARTITIONS = [
                { partition: 'the production grain', widths: [WINDOW_BEATS] },
                { partition: 'whole-beat windows, one opening on the clip end', widths: [1] },
                { partition: 'windows one of which straddles the clip end', widths: [0.7] },
                { partition: 'irregular windows straddling the seams', widths: [0.3, 0.7, 0.13] },
            ];
            const plainClip = { endBeat: CLIP_END_BEAT, loopEnabled: false, loopLength: CLIP_END_BEAT };
            const loopedClip = { endBeat: CLIP_END_BEAT, loopEnabled: true, loopLength: LOOP_BEATS };
            const CASES = [
                {
                    clipKind: 'a plain clip whose last note ends on the clip end',
                    clip: plainClip,
                    row: { id: 'last-note', startBeat: 11, duration: 1 },
                },
                {
                    clipKind: 'a looping clip whose final pass ends a note on the clip end',
                    clip: loopedClip,
                    row: { id: 'pass-end-note', startBeat: 3, duration: 1 },
                },
            ];

            it.each(CASES)('releases on the clip end in the bounce for $clipKind', ({ clip, row }) => {
                const offlineRackInput: RackInputEvent[] = [];
                offlineVoices(clip, [row], defaultGrooveTemplateState, offlineRackInput);
                expect(rackNoteOffs(offlineRackInput, row.id).at(-1)).toEqual({
                    instance: row.id,
                    beat: CLIP_END_BEAT,
                });
            });

            describe.each(CASES)('for $clipKind', ({ clip, row }) => {
                it.each(CLIP_END_PARTITIONS)(
                    'hands the live rack every release the bounce does under $partition',
                    async ({ widths }) => {
                        const live = await liveVoices(
                            clip,
                            [row],
                            defaultGrooveTemplateState,
                            windowEdges(widths, SWEEP_END_BEAT)
                        );
                        const offlineRackInput: RackInputEvent[] = [];
                        const bounced = offlineVoices(clip, [row], defaultGrooveTemplateState, offlineRackInput);
                        expect(live.voices).toEqual(bounced);
                        expect(rackNoteOffs(liveRackInput(), row.id)).toEqual(rackNoteOffs(offlineRackInput, row.id));
                    }
                );

                it('hands the live rack the release once when a tempo change on the clip end splits the straddling window', async () => {
                    (tempoMapStore as { value: unknown }).value = {
                        changes: [
                            {
                                id: 'on-clip-end',
                                beat: CLIP_END_BEAT,
                                tempo: defaultTransportState.tempo,
                                curve: 'instant',
                            },
                        ],
                    };
                    await liveVoices(clip, [row], defaultGrooveTemplateState, windowEdges([0.7], SWEEP_END_BEAT));
                    const offlineRackInput: RackInputEvent[] = [];
                    offlineVoices(clip, [row], defaultGrooveTemplateState, offlineRackInput);
                    expect(rackNoteOffs(liveRackInput(), row.id)).toEqual(rackNoteOffs(offlineRackInput, row.id));
                });
            });
        });
    });
});
