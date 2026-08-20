import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { type TakeLaneStoreState, type Track } from '#/modules/Arrangement/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';

import { offlineDeviceParameterLawState } from '../../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { type OfflineMidiProbabilitySelector } from '../../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflineYeastMidiProcessor } from '../../../repositories/offlineScheduler/offlineYeastMidiProcessorState';
import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { configureOfflineDeviceParameterLaw } from '../../configureOfflineDeviceParameterLaw';
import { scheduleTrackClips } from '../scheduleTrackClips';
import { type PendingWorkletEvent } from '../types';

// Local, field-identical replica of Arrangement's TrackDummy fixture — foreign
// test fixtures have no compliant cross-module path (models are not re-exported).
const TrackDummy = {
    create: (overrides?: Partial<Track>): Track => ({
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    }),
};

const mocks = vi.hoisted(() => {
    const projection: { startOffset: number; velocity: number | null; yeastTranspose: number } = {
        startOffset: 0,
        velocity: null,
        yeastTranspose: 0,
    };
    return {
        getCompensationDelay: vi.fn<(trackId: string) => number>(() => 0),
        scheduleTrackAutomation: vi.fn(),
        transportValue: { value: null as { scheduleGrainMs: number } | null },
        takeLaneValue: { value: null as TakeLaneStoreState | null },
        automationValue: {
            value: null as {
                lanes: Array<{
                    id: string;
                    trackId: string;
                    parameterId: string;
                    enabled: boolean;
                }>;
            } | null,
        },
        audioBufferCache: { get: vi.fn(() => undefined) },
        projectMidiEvents: vi.fn<(input: unknown) => void>(),
        processYeastMidi: vi.fn<(input: unknown) => void>(),
        projectChordPitch: vi.fn(
            ({ pitch, referenceBeat, targetBeat }: { pitch: number; referenceBeat: number; targetBeat: number }) =>
                pitch + targetBeat - referenceBeat
        ),
        evaluateAutomationValue: vi.fn<(laneId: string, beat: number) => number | null>(() => null),
        resolveArticulationId: vi.fn(({ articulation }: { articulation: string | undefined }) =>
            articulation === 'staccato' ? 8 : null
        ),
        getDrumKitDefByIndex: vi.fn<() => unknown>(() => null),
        getSynthParamsFromDevices: vi.fn<() => unknown>(() => null),
        scheduleDrumKitNote: vi.fn(),
        scheduleKitNote: vi.fn(),
        scheduleNoteOffline: vi.fn(),
        resolveDrumKit: vi.fn<() => unknown>(() => null),
        checkCancel: vi.fn(),
        shouldPlayMidiEvent: vi.fn<OfflineMidiProbabilitySelector>(({ probabilityPercent }) => probabilityPercent > 0),
        projection,
    };
});

type ProjectableMidiEvent = {
    id: string;
    startBeat: number;
    duration: number;
    velocity: number;
};

type ClipMidiEventsInput<Event extends ProjectableMidiEvent> = {
    events: readonly Event[];
    clipId: string;
    clipStartBeat: number;
    clipEndBeat: number;
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
    loopEnabled?: boolean;
    clipGrooveAlreadyApplied?: boolean;
    eventsAreAbsolute?: boolean;
    phase?: 'clip-groove' | 'complete';
};

type SequencerMidiEventsInput<Event extends ProjectableMidiEvent> = {
    events: readonly Event[];
    phase: 'sequencer-groove';
};

function projectMidiEvents<Event extends ProjectableMidiEvent>(
    input: ClipMidiEventsInput<Event> | SequencerMidiEventsInput<Event>
): readonly Event[] {
    mocks.projectMidiEvents(input);
    if (input.phase === 'sequencer-groove') {
        return input.events;
    }
    return input.events.map((event) => {
        let startBeat = event.startBeat + mocks.projection.startOffset;
        if (input.phase !== 'clip-groove' && !input.eventsAreAbsolute) {
            startBeat =
                input.iterationStartBeat + event.startBeat - input.midiOffsetBeats + mocks.projection.startOffset;
        }
        if (mocks.projection.velocity === null) {
            return { ...event, startBeat };
        }
        return { ...event, startBeat, velocity: mocks.projection.velocity };
    });
}

function processYeastMidi(input: Parameters<OfflineYeastMidiProcessor>[0]): ReturnType<OfflineYeastMidiProcessor> {
    mocks.processYeastMidi(input);
    const events = input.events.map((event) => ({
        ...event,
        timePpq: event.timePpq ?? event.timeSamples / 24_000,
    }));
    if (mocks.projection.yeastTranspose === 0) {
        return events;
    }
    return events.map((event) => {
        if (event.kind.type !== 'noteOn' && event.kind.type !== 'noteOff') {
            return event;
        }
        return {
            ...event,
            kind: { ...event.kind, note: event.kind.note + mocks.projection.yeastTranspose },
        };
    });
}

function projectPpqEndpoints({
    startPpq,
    endPpq,
    defaultTempo,
    sampleRate,
}: {
    startPpq: number;
    endPpq: number;
    defaultTempo: number;
    sampleRate: number;
}) {
    const startSamples = Math.round((startPpq / defaultTempo) * 60 * sampleRate);
    const endSamples = Math.round((endPpq / defaultTempo) * 60 * sampleRate);
    return {
        startSamples,
        endSamples,
        durationSamples: endSamples - startSamples,
        startSeconds: startSamples / sampleRate,
        endSeconds: endSamples / sampleRate,
        durationSeconds: (endSamples - startSamples) / sampleRate,
    };
}

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: mocks.getCompensationDelay,
}));

vi.mock('../../../repositories/offlineScheduler/automationScheduling', () => ({
    scheduleTrackAutomation: mocks.scheduleTrackAutomation,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        takeLaneStore: mocks.takeLaneValue,
    };
});

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return {
        ...actual,
        automationStore: mocks.automationValue,
    };
});

// The scheduler grain the offline slew has to read is transport state, so the
// spec has to be able to move it off the shipping default.
vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/stores')>();
    return {
        ...actual,
        transportStore: mocks.transportValue,
    };
});

vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: mocks.audioBufferCache,
}));

vi.mock('../checkCancel', () => ({
    checkCancel: mocks.checkCancel,
}));

// Synth note-scheduling helpers are unused on the worklet-instrument path
// (instrumentControls present → events go to pendingWorkletEvents), but the
// module is imported so we stub it to keep it inert.
// Partial: the offline path only calls these five, but the Arrangement barrel
// scheduleTrackClips reads the device-parameter law from also reaches MIDI's
// live-input wiring, which imports other members of this barrel at module load.
vi.mock('#/modules/Synth/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Synth/useCases')>();
    return {
        ...actual,
        getDrumKitDefByIndex: mocks.getDrumKitDefByIndex,
        getSynthParamsFromDevices: mocks.getSynthParamsFromDevices,
        scheduleDrumKitNote: mocks.scheduleDrumKitNote,
        scheduleKitNote: mocks.scheduleKitNote,
        scheduleNoteOffline: mocks.scheduleNoteOffline,
    };
});

vi.mock('#/modules/AudioEngine/services/deviceResolution', () => ({
    resolveDrumKit: mocks.resolveDrumKit,
}));

/** Minimal OfflineAudioContext stub — the instrument path never touches it. */
function makeOfflineCtx(): OfflineAudioContext {
    return { sampleRate: 48_000, currentTime: 0 } as unknown as OfflineAudioContext;
}

function makeInstrumentEntry(): DeviceNodeEntry {
    return {
        deviceId: 'inst-1',
        deviceType: 'fermenter',
        node: {} as DeviceNodeEntry['node'],
        strategy: {} as DeviceNodeEntry['strategy'],
        instrumentControls: {
            noteOn: vi.fn(),
            noteOff: vi.fn(),
        },
    };
}

function makeMidiTrack(): Track {
    return TrackDummy.create({
        id: 'track-inst',
        name: 'Instrument',
        kind: 'midi',
        devices: [{ id: 'inst-1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} }],
        clips: [
            {
                id: 'clip-1',
                trackId: 'track-inst',
                name: 'MIDI Clip',
                startBeat: 0,
                endBeat: 4,
                type: 'midi',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#fff',
                locked: false,
                muted: false,
            },
        ],
    });
}

function makeMidi(): NonNullable<MidiStoreState> {
    return {
        probabilitySeed: 0xdecafbad,
        notesByClipId: {
            'clip-1': [{ id: 'note-1', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

type RunScheduleInput = {
    withYeast?: boolean;
    withToaster?: boolean;
    followChordTrack?: boolean;
    loopLengthBeats?: number;
    includeSecondClip?: boolean;
    emptyNotes?: boolean;
    removeClips?: boolean;
    probability?: number;
    probabilityCorpus?: boolean;
    regionStartBeat?: number;
    automationMode?: Track['automationMode'];
    instrumentParameterValues?: Record<string, number>;
    clipGain?: number;
    noteExpression?: {
        pressure: number;
        slide: number;
        pitchBend: number;
        pitchBendRangeSemitones: number;
    };
    useLegacyScheduler?: boolean;
    trackDeviceType?: string;
    includeSecondNote?: boolean;
};

async function runSchedule({
    withYeast = false,
    withToaster = false,
    followChordTrack = false,
    loopLengthBeats,
    includeSecondClip = false,
    emptyNotes = false,
    removeClips = false,
    probability,
    probabilityCorpus = false,
    regionStartBeat = 0,
    automationMode,
    instrumentParameterValues,
    clipGain,
    noteExpression,
    useLegacyScheduler = false,
    trackDeviceType,
    includeSecondNote = false,
}: RunScheduleInput = {}): Promise<PendingWorkletEvent[]> {
    const offlineCtx = makeOfflineCtx();
    const track = makeMidiTrack();
    track.followChordTrack = followChordTrack;
    if (automationMode !== undefined) {
        track.automationMode = automationMode;
    }
    if (instrumentParameterValues) {
        track.devices[0]!.parameterValues = instrumentParameterValues;
    }
    if (trackDeviceType !== undefined) {
        track.devices[0]!.type = trackDeviceType;
    }
    if (clipGain !== undefined) {
        track.clips[0]!.gain = clipGain;
    }
    const midi = makeMidi();
    if (noteExpression) {
        Object.assign(midi.notesByClipId['clip-1']![0]!, noteExpression);
    }
    if (includeSecondNote) {
        midi.notesByClipId['clip-1']!.push({ id: 'note-2', pitch: 62, startBeat: 2, duration: 1, velocity: 90 });
    }
    if (probability !== undefined) {
        midi.notesByClipId['clip-1']![0]!.probability = probability;
    }
    if (probabilityCorpus) {
        midi.notesByClipId['clip-1'] = [
            { id: 'event-alpha', pitch: 60, startBeat: 1, duration: 0.25, velocity: 100, probability: 50 },
            { id: 'event-beta', pitch: 61, startBeat: 1, duration: 0.25, velocity: 100, probability: 50 },
        ];
    }
    if (withYeast) {
        track.devices.push({ id: 'yeast-1', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} });
    }
    if (emptyNotes) {
        midi.notesByClipId['clip-1'] = [];
    }
    if (removeClips) {
        track.clips = [];
    }
    if (loopLengthBeats !== undefined) {
        track.clips[0]!.loopEnabled = true;
        track.clips[0]!.loopLength = loopLengthBeats;
    }
    if (includeSecondClip) {
        track.clips.push({
            ...track.clips[0]!,
            id: 'clip-2',
            name: 'Second MIDI Clip',
            startBeat: 4,
            endBeat: 8,
            loopEnabled: false,
            loopLength: undefined,
        });
        midi.notesByClipId['clip-2'] = [{ id: 'note-2', pitch: 64, startBeat: 1, duration: 1, velocity: 90 }];
    }
    const entry = makeInstrumentEntry();
    if (withToaster) {
        entry.deviceType = 'toaster';
    }
    const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>([[track.id, useLegacyScheduler ? [] : [entry]]]);
    const pendingWorkletEvents: PendingWorkletEvent[] = [];

    const inputNode = {} as GainNode;
    const gainNode = {} as GainNode;
    const panNode = {} as StereoPannerNode;
    const destination = {} as AudioNode;

    await scheduleTrackClips({
        offlineCtx,
        track,
        midi,
        trackInputNode: inputNode,
        trackGainNode: gainNode,
        trackPanNode: panNode,
        destination,
        durationSeconds: 60,
        defaultTempo: 120,
        changes: [],
        projections: {
            projectMidiEvents,
            projectPpqEndpoints,
            processYeastMidi,
            // No clip here carries an audioOffsetBeats, so the flat-tempo
            // resolver is unexercised; `null` is the unconfigured case and
            // leaves the projection on the render's default tempo.
            resolveTempoAtBeat: null,
            selectMidiEventProbability: mocks.shouldPlayMidiEvent,
            projectChordPitch: mocks.projectChordPitch,
            evaluateAutomationValue: mocks.evaluateAutomationValue,
            resolveArticulationId: mocks.resolveArticulationId,
        },
        pendingWorkletEvents,
        allTracks: [track],
        deviceEntriesByTrack,
        regionStartBeat,
    });

    return pendingWorkletEvents;
}

describe('scheduleTrackClips — legacy instrument parity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getDrumKitDefByIndex.mockReturnValue(null);
        mocks.getSynthParamsFromDevices.mockReturnValue(null);
        mocks.resolveDrumKit.mockReturnValue(null);
        mocks.checkCancel.mockImplementation(() => {});
    });

    afterEach(() => {
        mocks.getDrumKitDefByIndex.mockReturnValue(null);
        mocks.getSynthParamsFromDevices.mockReturnValue(null);
        mocks.resolveDrumKit.mockReturnValue(null);
        mocks.checkCancel.mockImplementation(() => {});
    });

    it('passes clip gain and recorded MPE expression to the offline built-in synth', async () => {
        const synthParams = { waveform: 'sawtooth' };
        const mpe = {
            pressure: 90,
            slide: 45,
            pitchBend: 4_096,
            pitchBendRangeSemitones: 12,
        };
        mocks.getSynthParamsFromDevices.mockReturnValue(synthParams);

        await runSchedule({ useLegacyScheduler: true, clipGain: 0.25, noteExpression: mpe });

        expect(mocks.scheduleNoteOffline).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            60,
            0.5,
            0.5,
            100,
            synthParams,
            mpe,
            0.25
        );
    });

    it('passes clip gain to the fixed drum-kit scheduler', async () => {
        const kitDefinition = { name: '808' };
        mocks.getDrumKitDefByIndex.mockReturnValue(kitDefinition);

        await runSchedule({ useLegacyScheduler: true, trackDeviceType: 'builtin-drum-kit', clipGain: 0.35 });

        expect(mocks.scheduleDrumKitNote).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            kitDefinition,
            60,
            0.5,
            100,
            0.35
        );
    });

    it('passes clip gain to the resolved drum-kit scheduler', async () => {
        const drumKit = { name: 'Acoustic' };
        mocks.resolveDrumKit.mockReturnValue(drumKit);

        await runSchedule({ useLegacyScheduler: true, clipGain: 0.35 });

        expect(mocks.scheduleKitNote).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            drumKit,
            60,
            0.5,
            0.5,
            100,
            0.35
        );
    });

    it('preserves routed clip expression and gain through Yeast', async () => {
        const synthParams = { waveform: 'sawtooth' };
        const mpe = { pressure: 90, slide: 45, pitchBend: 4_096, pitchBendRangeSemitones: 12 };
        mocks.getSynthParamsFromDevices.mockReturnValue(synthParams);

        await runSchedule({ useLegacyScheduler: true, withYeast: true, clipGain: 0.25, noteExpression: mpe });

        expect(mocks.scheduleNoteOffline.mock.calls[0]?.slice(7)).toEqual([mpe, 0.25]);
    });

    it('normalizes persisted expression before it reaches oscillator math', async () => {
        mocks.getSynthParamsFromDevices.mockReturnValue({ waveform: 'sawtooth' });

        await runSchedule({
            useLegacyScheduler: true,
            noteExpression: { pressure: 999, slide: -4, pitchBend: 90_000, pitchBendRangeSemitones: 999 },
        });

        expect(mocks.scheduleNoteOffline.mock.calls[0]?.[7]).toEqual({
            pressure: 127,
            slide: 0,
            pitchBend: 8_191,
            pitchBendRangeSemitones: 127,
        });
    });

    it('stops a dense note batch as soon as export cancellation is observed', async () => {
        mocks.getSynthParamsFromDevices.mockReturnValue({ waveform: 'sawtooth' });
        mocks.checkCancel
            .mockImplementationOnce(() => {})
            .mockImplementationOnce(() => {
                throw new Error('Export cancelled');
            });

        await expect(runSchedule({ useLegacyScheduler: true, includeSecondNote: true })).rejects.toThrow(
            'Export cancelled'
        );
        expect(mocks.scheduleNoteOffline).toHaveBeenCalledTimes(1);
    });
});

describe('scheduleTrackClips — MIDI plugin-delay compensation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneValue.value = null;
        mocks.automationValue.value = null;
        mocks.getCompensationDelay.mockReturnValue(0);
        mocks.projection.startOffset = 0;
        mocks.projection.velocity = null;
        mocks.projection.yeastTranspose = 0;
        mocks.evaluateAutomationValue.mockReturnValue(null);
        mocks.shouldPlayMidiEvent.mockImplementation(({ probabilityPercent }) => probabilityPercent > 0);
    });

    it('projects the same canonical Levain articulation into full-mix worklet events without changing note clocks', async () => {
        const offlineCtx = makeOfflineCtx();
        const track = makeMidiTrack();
        track.devices[0] = { id: 'inst-1', name: 'Levain', type: 'levain', bypassed: false, parameterValues: {} };
        const midi = makeMidi();
        midi.notesByClipId['clip-1']![0] = {
            id: 'note-1',
            pitch: 60,
            startBeat: 1,
            duration: 1,
            velocity: 100,
            articulation: 'staccato',
        };
        const entry = makeInstrumentEntry();
        entry.deviceType = 'levain';
        const pendingWorkletEvents: PendingWorkletEvent[] = [];

        await scheduleTrackClips({
            offlineCtx,
            track,
            midi,
            trackInputNode: {} as GainNode,
            trackGainNode: {} as GainNode,
            trackPanNode: {} as StereoPannerNode,
            destination: {} as AudioNode,
            durationSeconds: 60,
            defaultTempo: 120,
            changes: [],
            projections: {
                projectMidiEvents,
                projectPpqEndpoints,
                processYeastMidi,
                // No clip here carries an audioOffsetBeats, so the flat-tempo
                // resolver is unexercised; `null` is the unconfigured case and
                // leaves the projection on the render's default tempo.
                resolveTempoAtBeat: null,
                selectMidiEventProbability: mocks.shouldPlayMidiEvent,
                projectChordPitch: mocks.projectChordPitch,
                evaluateAutomationValue: mocks.evaluateAutomationValue,
                resolveArticulationId: mocks.resolveArticulationId,
            },
            pendingWorkletEvents,
            allTracks: [track],
            deviceEntriesByTrack: new Map([[track.id, [entry]]]),
        });

        expect(pendingWorkletEvents).toEqual([
            expect.objectContaining({ type: 'on', pitch: 60, velocity: 100, time: 0.5, articulationId: 8 }),
            expect.objectContaining({ type: 'off', pitch: 60, velocity: 0, time: 1 }),
        ]);
    });

    it('carries a recorded MPE member channel onto both the note-on and its release', async () => {
        // The release has to name the same member channel the attack did.
        // Without it the engine releases every voice at that pitch, so two
        // notes held at the same pitch on different channels — the thing MPE
        // exists to voice separately — collapse on the first note-off. Live
        // playback passes the channel, so only the bounce was wrong.
        const offlineCtx = makeOfflineCtx();
        const track = makeMidiTrack();
        track.devices[0] = { id: 'inst-1', name: 'Levain', type: 'levain', bypassed: false, parameterValues: {} };
        const midi = makeMidi();
        midi.notesByClipId['clip-1']![0] = {
            id: 'note-1',
            pitch: 60,
            startBeat: 1,
            duration: 1,
            velocity: 100,
            channel: 3,
        };
        const entry = makeInstrumentEntry();
        entry.deviceType = 'levain';
        const pendingWorkletEvents: PendingWorkletEvent[] = [];

        await scheduleTrackClips({
            offlineCtx,
            track,
            midi,
            trackInputNode: {} as GainNode,
            trackGainNode: {} as GainNode,
            trackPanNode: {} as StereoPannerNode,
            destination: {} as AudioNode,
            durationSeconds: 60,
            defaultTempo: 120,
            changes: [],
            projections: {
                projectMidiEvents,
                projectPpqEndpoints,
                processYeastMidi,
                // No clip here carries an audioOffsetBeats, so the flat-tempo
                // resolver is unexercised; `null` is the unconfigured case and
                // leaves the projection on the render's default tempo.
                resolveTempoAtBeat: null,
                selectMidiEventProbability: mocks.shouldPlayMidiEvent,
                projectChordPitch: mocks.projectChordPitch,
                evaluateAutomationValue: mocks.evaluateAutomationValue,
                resolveArticulationId: mocks.resolveArticulationId,
            },
            pendingWorkletEvents,
            allTracks: [track],
            deviceEntriesByTrack: new Map([[track.id, [entry]]]),
        });

        expect(pendingWorkletEvents.map((event) => [event.type, event.channel])).toEqual([
            ['on', 3],
            ['off', 3],
        ]);
    });

    it('addresses a note that carries no channel to the base channel, as playback does', async () => {
        // `scheduleMidiNotes` resolves an absent channel to 0 on both halves.
        // Leaving it unset offline would release every voice at that pitch and
        // so disagree with the session on an overlapping unison.
        const offlineCtx = makeOfflineCtx();
        const track = makeMidiTrack();
        track.devices[0] = { id: 'inst-1', name: 'Levain', type: 'levain', bypassed: false, parameterValues: {} };
        const midi = makeMidi();
        const entry = makeInstrumentEntry();
        entry.deviceType = 'levain';
        const pendingWorkletEvents: PendingWorkletEvent[] = [];

        await scheduleTrackClips({
            offlineCtx,
            track,
            midi,
            trackInputNode: {} as GainNode,
            trackGainNode: {} as GainNode,
            trackPanNode: {} as StereoPannerNode,
            destination: {} as AudioNode,
            durationSeconds: 60,
            defaultTempo: 120,
            changes: [],
            projections: {
                projectMidiEvents,
                projectPpqEndpoints,
                processYeastMidi,
                // No clip here carries an audioOffsetBeats, so the flat-tempo
                // resolver is unexercised; `null` is the unconfigured case and
                // leaves the projection on the render's default tempo.
                resolveTempoAtBeat: null,
                selectMidiEventProbability: mocks.shouldPlayMidiEvent,
                projectChordPitch: mocks.projectChordPitch,
                evaluateAutomationValue: mocks.evaluateAutomationValue,
                resolveArticulationId: mocks.resolveArticulationId,
            },
            pendingWorkletEvents,
            allTracks: [track],
            deviceEntriesByTrack: new Map([[track.id, [entry]]]),
        });

        expect(pendingWorkletEvents.map((event) => event.channel)).toEqual([0, 0]);
    });

    it('threads a nonzero render-region offset into automation scheduling', async () => {
        mocks.getCompensationDelay.mockReturnValue(0.05);

        await runSchedule({ regionStartBeat: 128 });

        const input = mocks.scheduleTrackAutomation.mock.calls.at(-1)?.[0] as
            | {
                  regionStartSeconds: number;
                  projectBeatToSeconds: (beat: number) => number;
                  sampleRate: number;
                  compensationDelaySec: number;
                  clipBoundsById: unknown;
              }
            | undefined;
        expect(input?.regionStartSeconds).toBe(64);
        expect(input?.projectBeatToSeconds(130)).toBe(65);
        expect(input?.sampleRate).toBe(48_000);
        // Automation gets the same latency compensation clip scheduling applies (M-038).
        expect(input?.compensationDelaySec).toBe(0.05);
        // AU-12: clip-scoped automation lanes are gated by clip bounds offline.
        expect(input?.clipBoundsById).toBeInstanceOf(Map);
    });

    it('drops a MIDI note that ends before the render-region start', async () => {
        // regionStartBeat 8 = 4s at 120bpm. The default note (startBeat 1,
        // duration 1) ends at beat 2 = 1s → endSamples (48000) is well below
        // regionStartSec*sampleRate (4*48000) → the note is clipped out and no
        // worklet note-on is scheduled.
        const events = await runSchedule({ regionStartBeat: 8 });
        expect(events.filter((e) => e.type === 'on')).toHaveLength(0);
    });

    it('drops a MIDI note whose start lands at or beyond the render duration', async () => {
        // Default clip 0..4. With a region start of 0 and the note at beat 1
        // (0.5s), it lands inside a normal 60s render. To exercise the
        // `startTime >= durationSeconds` clip, shrink the fixture note's clip
        // window so the note's projected start is huge is not possible here;
        // instead, the second-clip path: place a note that projects past the
        // end. Simpler: rely on a very large regionStartBeat so the projected
        // startTime exceeds durationSeconds (60s). regionStartBeat 256 = 128s.
        const events = await runSchedule({ regionStartBeat: 256 });
        expect(events.filter((e) => e.type === 'on')).toHaveLength(0);
    });

    it('maps direct Toaster-track GM notes to pads with neutral one-shot tuning', async () => {
        const track = makeMidiTrack();
        const midi = makeMidi();
        midi.notesByClipId['clip-1'] = [
            { id: 'low-kick', pitch: 36, startBeat: 1, duration: 0.25, velocity: 100 },
            { id: 'high-kick', pitch: 60, startBeat: 2, duration: 0.25, velocity: 90 },
        ];
        const entry = makeInstrumentEntry();
        entry.deviceType = 'toaster';
        const pendingWorkletEvents: PendingWorkletEvent[] = [];

        await scheduleTrackClips({
            offlineCtx: makeOfflineCtx(),
            track,
            midi,
            trackInputNode: {} as GainNode,
            trackGainNode: {} as GainNode,
            trackPanNode: {} as StereoPannerNode,
            destination: {} as AudioNode,
            durationSeconds: 60,
            defaultTempo: 120,
            changes: [],
            projections: {
                projectMidiEvents,
                projectPpqEndpoints,
                processYeastMidi,
                // No clip here carries an audioOffsetBeats, so the flat-tempo
                // resolver is unexercised; `null` is the unconfigured case and
                // leaves the projection on the render's default tempo.
                resolveTempoAtBeat: null,
                selectMidiEventProbability: mocks.shouldPlayMidiEvent,
                projectChordPitch: mocks.projectChordPitch,
                evaluateAutomationValue: mocks.evaluateAutomationValue,
            },
            pendingWorkletEvents,
            deviceEntriesByTrack: new Map([[track.id, [entry]]]),
        });

        expect(pendingWorkletEvents.map((event) => event.toasterPadIndex)).toEqual([0, 0]);
        expect(pendingWorkletEvents.map((event) => event.pitch)).toEqual([60, 60]);
        expect(pendingWorkletEvents.map((event) => event.type)).toEqual(['on', 'on']);
    });

    it('keeps canonical Toaster pad indexes and neutral tuning while honoring the caller mute policy', async () => {
        const parent = TrackDummy.create({
            id: 'toaster-parent',
            kind: 'midi',
            devices: [{ id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} }],
        });
        const children = ['muted-pad', 'disabled-pad', 'active-pad'].map((id, index) => {
            const child = makeMidiTrack();
            child.id = id;
            child.parentId = parent.id;
            child.muted = index === 0;
            child.disabled = index === 1;
            child.clips[0] = { ...child.clips[0]!, id: `${id}-clip`, trackId: id };
            return child;
        });
        const midi = makeMidi();
        midi.notesByClipId = Object.fromEntries(
            children.map((child, index) => [
                child.clips[0]!.id,
                [{ id: `${child.id}-note`, pitch: 36 + index, startBeat: 1, duration: 1, velocity: 100 }],
            ])
        );
        const entry = makeInstrumentEntry();
        entry.deviceType = 'toaster';
        const pendingWorkletEvents: PendingWorkletEvent[] = [];

        await scheduleTrackClips({
            offlineCtx: makeOfflineCtx(),
            track: parent,
            midi,
            trackInputNode: {} as GainNode,
            trackGainNode: {} as GainNode,
            trackPanNode: {} as StereoPannerNode,
            destination: {} as AudioNode,
            durationSeconds: 60,
            defaultTempo: 120,
            changes: [],
            projections: {
                projectMidiEvents,
                projectPpqEndpoints,
                processYeastMidi,
                // No clip here carries an audioOffsetBeats, so the flat-tempo
                // resolver is unexercised; `null` is the unconfigured case and
                // leaves the projection on the render's default tempo.
                resolveTempoAtBeat: null,
                selectMidiEventProbability: mocks.shouldPlayMidiEvent,
                projectChordPitch: mocks.projectChordPitch,
                evaluateAutomationValue: mocks.evaluateAutomationValue,
            },
            pendingWorkletEvents,
            allTracks: [parent, ...children],
            deviceEntriesByTrack: new Map([[parent.id, [entry]]]),
            honorMuted: false,
        });

        const noteOns = pendingWorkletEvents.filter((event) => event.type === 'on');
        expect(noteOns.map((event) => event.toasterPadIndex)).toEqual([0, 2]);
        expect(noteOns.map((event) => event.pitch)).toEqual([60, 60]);
        expect(pendingWorkletEvents.filter((event) => event.type === 'off')).toHaveLength(0);

        const mixdownEvents: PendingWorkletEvent[] = [];
        await scheduleTrackClips({
            offlineCtx: makeOfflineCtx(),
            track: parent,
            midi,
            trackInputNode: {} as GainNode,
            trackGainNode: {} as GainNode,
            trackPanNode: {} as StereoPannerNode,
            destination: {} as AudioNode,
            durationSeconds: 60,
            defaultTempo: 120,
            changes: [],
            projections: {
                projectMidiEvents,
                projectPpqEndpoints,
                processYeastMidi,
                // No clip here carries an audioOffsetBeats, so the flat-tempo
                // resolver is unexercised; `null` is the unconfigured case and
                // leaves the projection on the render's default tempo.
                resolveTempoAtBeat: null,
                selectMidiEventProbability: mocks.shouldPlayMidiEvent,
                projectChordPitch: mocks.projectChordPitch,
                evaluateAutomationValue: mocks.evaluateAutomationValue,
            },
            pendingWorkletEvents: mixdownEvents,
            allTracks: [parent, ...children],
            deviceEntriesByTrack: new Map([[parent.id, [entry]]]),
        });

        expect(mixdownEvents.filter((event) => event.type === 'on').map((event) => event.toasterPadIndex)).toEqual([2]);
    });

    it('applies the parent Toaster swing lane to the offline one-shot onset without adding a gate release', async () => {
        const parent = TrackDummy.create({
            id: 'toaster-parent',
            kind: 'midi',
            devices: [
                {
                    id: 'toaster-1',
                    name: 'Toaster',
                    type: 'toaster',
                    bypassed: false,
                    parameterValues: {},
                },
                {
                    id: 'toaster-2',
                    name: 'Other Toaster',
                    type: 'toaster',
                    bypassed: false,
                    parameterValues: {},
                },
            ],
        });
        const child = makeMidiTrack();
        child.id = 'active-pad';
        child.parentId = parent.id;
        child.devices.push({ id: 'yeast', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} });
        child.clips[0] = { ...child.clips[0]!, id: 'pad-clip', trackId: child.id };
        const midi = makeMidi();
        midi.notesByClipId = {
            'pad-clip': [{ id: 'pad-note', pitch: 36, startBeat: 1.25, duration: 0.25, velocity: 100 }],
        };
        mocks.automationValue.value = {
            lanes: [
                {
                    id: 'other-swing-lane',
                    trackId: parent.id,
                    parameterId: 'toaster-2:swing',
                    enabled: true,
                },
                {
                    id: 'swing-lane',
                    trackId: parent.id,
                    parameterId: 'toaster-1:swing',
                    enabled: true,
                },
            ],
        };
        mocks.evaluateAutomationValue.mockImplementation((laneId) => (laneId === 'swing-lane' ? 0.4 : 1));
        const entry = makeInstrumentEntry();
        entry.deviceId = 'toaster-1';
        entry.deviceType = 'toaster';
        const pendingWorkletEvents: PendingWorkletEvent[] = [];

        await scheduleTrackClips({
            offlineCtx: makeOfflineCtx(),
            track: parent,
            midi,
            trackInputNode: {} as GainNode,
            trackGainNode: {} as GainNode,
            trackPanNode: {} as StereoPannerNode,
            destination: {} as AudioNode,
            durationSeconds: 60,
            defaultTempo: 120,
            changes: [],
            projections: {
                projectMidiEvents,
                projectPpqEndpoints,
                processYeastMidi,
                // No clip here carries an audioOffsetBeats, so the flat-tempo
                // resolver is unexercised; `null` is the unconfigured case and
                // leaves the projection on the render's default tempo.
                resolveTempoAtBeat: null,
                selectMidiEventProbability: mocks.shouldPlayMidiEvent,
                projectChordPitch: mocks.projectChordPitch,
                evaluateAutomationValue: mocks.evaluateAutomationValue,
            },
            pendingWorkletEvents,
            allTracks: [parent, child],
            deviceEntriesByTrack: new Map([[parent.id, [entry]]]),
        });

        expect(mocks.processYeastMidi).toHaveBeenCalled();
        expect(pendingWorkletEvents.find((event) => event.type === 'on')?.time).toBeCloseTo(0.65, 6);
        expect(pendingWorkletEvents.filter((event) => event.type === 'off')).toHaveLength(0);
    });

    it('shifts instrument note on/off times by the track compensation delay', async () => {
        // Track latency requires +0.05s of compensation delay (e.g. a downstream
        // device adds latency; this track is earlier in the graph).
        mocks.getCompensationDelay.mockReturnValue(0.05);

        const events = await runSchedule();

        // note startBeat 1 at 120bpm = 0.5s; duration 1 beat = 0.5s → end at 1.0s.
        // With +0.05s compensation the on/off must land at 0.55s / 1.05s.
        const onEvt = events.find((evt) => evt.type === 'on');
        const offEvt = events.find((evt) => evt.type === 'off');

        expect(onEvt).toBeDefined();
        expect(offEvt).toBeDefined();
        expect(onEvt!.time).toBeCloseTo(0.55, 6);
        expect(offEvt!.time).toBeCloseTo(1.05, 6);
    });

    it('leaves instrument note times unshifted when there is no compensation delay', async () => {
        mocks.getCompensationDelay.mockReturnValue(0);

        const events = await runSchedule();

        const onEvt = events.find((evt) => evt.type === 'on');
        const offEvt = events.find((evt) => evt.type === 'off');

        expect(onEvt!.time).toBeCloseTo(0.5, 6);
        expect(offEvt!.time).toBeCloseTo(1.0, 6);
    });

    it('omits a zero-probability MIDI event from offline scheduling', async () => {
        const events = await runSchedule({ probability: 0 });

        expect(events).toEqual([]);
    });

    it('routes the fixed probability tuple corpus through offline scheduling', async () => {
        mocks.shouldPlayMidiEvent.mockImplementation(({ eventId }) => eventId === 'event-alpha');

        const events = await runSchedule({ probabilityCorpus: true });

        expect(events.filter((event) => event.type === 'on').map((event) => event.pitch)).toEqual([60]);
        expect(mocks.shouldPlayMidiEvent).toHaveBeenCalledWith({
            projectProbabilitySeed: 0xdecafbad,
            clipId: 'clip-1',
            eventId: 'event-alpha',
            absoluteOccurrenceIndex: 0,
            probabilityPercent: 50,
        });
        expect(mocks.shouldPlayMidiEvent).toHaveBeenCalledWith({
            projectProbabilitySeed: 0xdecafbad,
            clipId: 'clip-1',
            eventId: 'event-beta',
            absoluteOccurrenceIndex: 0,
            probabilityPercent: 50,
        });
    });

    it('keeps probability occurrence anchored to the source loop through comp segments', async () => {
        const track = makeMidiTrack();
        track.clips[0]!.endBeat = 8;
        track.clips[0]!.loopEnabled = true;
        track.clips[0]!.loopLength = 2;
        mocks.takeLaneValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: track.id,
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'clip-1',
                            name: 'Take 1',
                            startBeat: 0,
                            endBeat: 8,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 4, endBeat: 6, takeId: 'take-1' }],
                },
            ],
        };
        const midi = makeMidi();
        const entry = makeInstrumentEntry();

        await scheduleTrackClips({
            offlineCtx: makeOfflineCtx(),
            track,
            midi,
            trackInputNode: {} as GainNode,
            trackGainNode: {} as GainNode,
            trackPanNode: {} as StereoPannerNode,
            destination: {} as AudioNode,
            durationSeconds: 60,
            defaultTempo: 120,
            changes: [],
            projections: {
                projectMidiEvents,
                projectPpqEndpoints,
                processYeastMidi,
                // No clip here carries an audioOffsetBeats, so the flat-tempo
                // resolver is unexercised; `null` is the unconfigured case and
                // leaves the projection on the render's default tempo.
                resolveTempoAtBeat: null,
                selectMidiEventProbability: mocks.shouldPlayMidiEvent,
                projectChordPitch: mocks.projectChordPitch,
                evaluateAutomationValue: mocks.evaluateAutomationValue,
            },
            pendingWorkletEvents: [],
            allTracks: [track],
            deviceEntriesByTrack: new Map([[track.id, [entry]]]),
            regionStartBeat: 0,
        });

        expect(mocks.shouldPlayMidiEvent.mock.calls.map(([input]) => input.absoluteOccurrenceIndex)).toEqual([
            0, 1, 2, 3,
        ]);
    });

    it('should project committed groove timing and dynamics before offline scheduling', async () => {
        mocks.projection.startOffset = 0.5;
        mocks.projection.velocity = 40;

        const events = await runSchedule();

        expect(mocks.projectMidiEvents).toHaveBeenCalledWith({
            events: makeMidi().notesByClipId['clip-1'],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 4,
            iterationStartBeat: 0,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
            loopEnabled: false,
            phase: 'complete',
        });
        expect(events.find((event) => event.type === 'on')).toMatchObject({ time: 0.75, velocity: 40 });
        expect(events.find((event) => event.type === 'off')).toMatchObject({ time: 1.25 });
    });

    it('should run the snapshotted Yeast projection before offline instrument scheduling', async () => {
        mocks.projection.yeastTranspose = 12;

        const events = await runSchedule({ withYeast: true });

        expect(mocks.processYeastMidi).toHaveBeenCalledTimes(1);
        expect(events.find((event) => event.type === 'on')).toMatchObject({ pitch: 72 });
        expect(events.find((event) => event.type === 'off')).toMatchObject({ pitch: 72 });
        expect(mocks.projectMidiEvents).toHaveBeenNthCalledWith(1, expect.objectContaining({ phase: 'clip-groove' }));
        expect(mocks.projectMidiEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ phase: 'complete' }));
    });

    it('applies chord-follow projection to direct and Yeast offline notes', async () => {
        const direct = await runSchedule({ followChordTrack: true });
        const yeast = await runSchedule({ followChordTrack: true, withYeast: true });

        expect(direct.find((event) => event.type === 'on')?.pitch).toBe(61);
        expect(yeast.find((event) => event.type === 'on')?.pitch).toBe(61);
        expect(mocks.projectChordPitch).toHaveBeenCalledWith({ pitch: 60, referenceBeat: 0, targetBeat: 1 });
    });

    it('does not chord-project Toaster percussion notes', async () => {
        await runSchedule({ followChordTrack: true, withToaster: true });

        expect(mocks.projectChordPitch).not.toHaveBeenCalled();
    });

    it('processes all loop iterations and clips through Yeast in one chronological track pass', async () => {
        const events = await runSchedule({ withYeast: true, loopLengthBeats: 2, includeSecondClip: true });

        expect(mocks.processYeastMidi).toHaveBeenCalledTimes(1);
        const processInput = mocks.processYeastMidi.mock.calls[0]?.[0];
        expect(processInput).toMatchObject({
            events: [
                expect.objectContaining({ timePpq: 1 }),
                expect.objectContaining({ timePpq: 2 }),
                expect.objectContaining({ timePpq: 3 }),
                expect.objectContaining({ timePpq: 4 }),
                expect.objectContaining({ timePpq: 5 }),
                expect.objectContaining({ timePpq: 6 }),
            ],
        });
        expect(events.filter((event) => event.type === 'on')).toHaveLength(3);
    });

    it('drives source-free generators for an empty clip but not when no clip is eligible', async () => {
        await runSchedule({ withYeast: true, removeClips: true });
        expect(mocks.processYeastMidi).not.toHaveBeenCalled();

        await runSchedule({ withYeast: true, emptyNotes: true });
        expect(mocks.processYeastMidi).toHaveBeenCalledTimes(1);
    });
});

describe('scheduleTrackClips — offline slew grain follows live transport state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneValue.value = null;
        mocks.automationValue.value = null;
        mocks.transportValue.value = null;
        mocks.getCompensationDelay.mockReturnValue(0);
    });

    async function slewTickSecondsFor(scheduleGrainMs: number | null): Promise<number> {
        mocks.transportValue.value = scheduleGrainMs === null ? null : { scheduleGrainMs };
        await runSchedule();
        const input = mocks.scheduleTrackAutomation.mock.calls.at(-1)?.[0] as { slewTickSeconds: number } | undefined;
        expect(input, 'scheduleTrackAutomation was never called').toBeDefined();
        return input!.slewTickSeconds;
    }

    // The live slew runs one step per scheduler tick and the scheduler ticks
    // every `scheduleGrainMs`, so the bounce has to read that state — not the
    // shipping default, which is the single grain where a constant agrees.
    it.each([
        [2.5, 0.0025],
        [10, 0.01],
        [25, 0.025],
        [50, 0.05],
    ])('passes the %sms scheduler grain through as %ss of slew tick', async (scheduleGrainMs, expected) => {
        expect(await slewTickSecondsFor(scheduleGrainMs)).toBeCloseTo(expected, 12);
    });

    it('falls back to the default transport grain when no transport state exists yet', async () => {
        expect(await slewTickSecondsFor(null)).toBeCloseTo(0.01, 12);
    });
});

describe('scheduleTrackClips — offline automation reads the same laws live does', () => {
    /** Stands in for the composition root's wiring of Arrangement's real law. */
    const injectedLaw = {
        isAutomatable: ({ paramId }: { deviceType: string; paramId: string }) => paramId === 'filterCutoff',
        clampValue: ({ value }: { deviceType: string; paramId: string; value: number }) =>
            Math.min(20_000, Math.max(20, value)),
        quantiseValue: ({ value }: { deviceType: string; paramId: string; value: number }) => Math.round(value),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneValue.value = null;
        mocks.automationValue.value = null;
        mocks.transportValue.value = null;
        mocks.getCompensationDelay.mockReturnValue(0);
        offlineDeviceParameterLawState.isAutomatable = null;
        offlineDeviceParameterLawState.clampValue = null;
        offlineDeviceParameterLawState.quantiseValue = null;
    });

    /**
     * The instrument carries both parameters in `parameterValues`, so the
     * presence half of the live gate passes for each and whatever the law
     * refuses is refused by the predicate alone.
     */
    async function lastAutomationLaw() {
        await runSchedule({ instrumentParameterValues: { filterCutoff: 0.5, oscShape: 0.2 } });
        const input = mocks.scheduleTrackAutomation.mock.calls.at(-1)?.[0] as
            | {
                  deviceParameterLaw: {
                      acceptsAutomation: (input: {
                          deviceId: string;
                          deviceType: string;
                          parameterId: string;
                      }) => boolean;
                      clampValue: (input: { deviceType: string; paramId: string; value: number }) => number;
                      quantiseValue: (input: { deviceType: string; paramId: string; value: number }) => number;
                  };
              }
            | undefined;
        expect(input, 'scheduleTrackAutomation was never called').toBeDefined();
        return input!.deviceParameterLaw;
    }

    it("schedules no automation at all for a track whose automationMode is 'off'", async () => {
        // Live `applyAutomation` drops every lane on the track before gain, pan
        // or device params when the mode is 'off'. Offline read no mode at all,
        // so a track the monitor plays flat bounced fully automated.
        await runSchedule({ automationMode: 'off' });
        expect(mocks.scheduleTrackAutomation).not.toHaveBeenCalled();

        await runSchedule({ automationMode: 'read' });
        expect(mocks.scheduleTrackAutomation).toHaveBeenCalledTimes(1);
    });

    it('applies the injected automatable predicate on top of the live parameterValues gate', async () => {
        configureOfflineDeviceParameterLaw(injectedLaw);
        const law = await lastAutomationLaw();

        // Both halves of the live gate have to hold: the device carries the key
        // AND the law declares it automatable. `oscShape` is present but not
        // declared automatable, so only the predicate can refuse it — offline
        // used to accept anything present, which is how a lane the monitor
        // refuses to run still drove the bounce.
        expect(
            law.acceptsAutomation({ deviceId: 'inst-1', deviceType: 'fermenter', parameterId: 'filterCutoff' })
        ).toBe(true);
        expect(law.acceptsAutomation({ deviceId: 'inst-1', deviceType: 'fermenter', parameterId: 'oscShape' })).toBe(
            false
        );
        // Present in the law but absent from the device: the presence half fails.
        expect(
            law.acceptsAutomation({
                deviceId: 'not-on-this-track',
                deviceType: 'fermenter',
                parameterId: 'filterCutoff',
            })
        ).toBe(false);
        expect(law.acceptsAutomation({ deviceId: 'inst-1', deviceType: 'fermenter', parameterId: 'unwritten' })).toBe(
            false
        );
    });

    it('routes device writes through the injected declared-range clamp', async () => {
        configureOfflineDeviceParameterLaw(injectedLaw);
        const law = await lastAutomationLaw();

        expect(law.clampValue({ deviceType: 'fermenter', paramId: 'filterCutoff', value: 1e9 })).toBe(20_000);
        expect(law.clampValue({ deviceType: 'fermenter', paramId: 'filterCutoff', value: -1e9 })).toBe(20);
    });

    it('routes device writes through the injected declared-type quantiser', async () => {
        // The clamp alone let the bounce render the slew's continuous filter
        // state for a parameter the monitor delivers as an integer. The composition
        // root has to hand the render both halves of the law, not one — and the
        // quantiser has to arrive as its own member, because it is applied at a
        // different point in the recurrence than the clamp (emitted value only,
        // never fed back), which a single composed function could not express.
        configureOfflineDeviceParameterLaw(injectedLaw);
        const law = await lastAutomationLaw();

        expect(law.quantiseValue({ deviceType: 'fermenter', paramId: 'filterCutoff', value: 12.59 })).toBe(13);
        expect(law.quantiseValue({ deviceType: 'fermenter', paramId: 'filterCutoff', value: 14.4 })).toBe(14);
    });

    it('refuses device automation outright when no law has been injected', async () => {
        // Unset is not "anything goes": with no law the render cannot tell an
        // automatable parameter from one live would refuse, and substituting a
        // looser rule is how the bounce diverged from the monitor in the first
        // place. With nothing resolving, the clamp has nothing to narrow.
        const law = await lastAutomationLaw();

        // Same parameter the injected law accepts above — with nothing injected
        // it is refused rather than waved through.
        expect(
            law.acceptsAutomation({ deviceId: 'inst-1', deviceType: 'fermenter', parameterId: 'filterCutoff' })
        ).toBe(false);
        expect(law.clampValue({ deviceType: 'fermenter', paramId: 'filterCutoff', value: 1e9 })).toBe(1e9);
        // And nothing is rounded either: with no law the render has no basis to
        // call a parameter stepped, and inventing one is the same substitution
        // the clamp fallback refuses.
        expect(law.quantiseValue({ deviceType: 'fermenter', paramId: 'filterCutoff', value: 12.59 })).toBe(12.59);
    });
});
