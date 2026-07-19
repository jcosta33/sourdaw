import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';

import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { configureOfflineMidiEventProjection } from '../../configureOfflineMidiEventProjection';
import { configureOfflinePpqEndpointProjection } from '../../configureOfflinePpqEndpointProjection';
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

type OfflineYeastMidiProcessor = NonNullable<Parameters<typeof scheduleTrackClips>[16]>;

const mocks = vi.hoisted(() => ({
    getCompensationDelay: vi.fn<(trackId: string) => number>(() => 0),
    scheduleTrackAutomation: vi.fn(),
    takeLaneValue: { value: null as unknown },
    automationValue: { value: null as unknown },
    audioBufferCache: { get: vi.fn(() => undefined) },
    projectCommittedGroove: vi.fn(),
    processOfflineYeastMidi: vi.fn<OfflineYeastMidiProcessor>(),
}));

let projectedStartOffset = 0;
let projectedVelocity: number | null = null;
type OfflineMidiEventProjector = ReturnType<
    Parameters<typeof configureOfflineMidiEventProjection>[0]['createProjector']
>;
const projectOfflineMidiEvents: OfflineMidiEventProjector = (input) => {
    mocks.projectCommittedGroove(input);
    return input.events.map((event) => ({
        ...event,
        startBeat: input.iterationStartBeat + event.startBeat - input.midiOffsetBeats + projectedStartOffset,
        velocity: projectedVelocity ?? event.velocity,
    }));
};

const projectPpqEndpoints = ({
    startPpq,
    endPpq,
    defaultTempo,
    sampleRate,
}: {
    startPpq: number;
    endPpq: number;
    defaultTempo: number;
    sampleRate: number;
}) => {
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
};

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

vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: mocks.audioBufferCache,
}));

// Synth note-scheduling helpers are unused on the worklet-instrument path
// (instrumentControls present → events go to pendingWorkletEvents), but the
// module is imported so we stub it to keep it inert.
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: vi.fn(() => null),
    getSynthParamsFromDevices: vi.fn(() => null),
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNoteOffline: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/services/deviceResolution', () => ({
    resolveDrumKit: vi.fn(() => null),
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
        notesByClipId: {
            'clip-1': [{ id: 'note-1', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

async function runSchedule({ withYeast = false }: { withYeast?: boolean } = {}): Promise<PendingWorkletEvent[]> {
    const offlineCtx = makeOfflineCtx();
    const track = makeMidiTrack();
    if (withYeast) {
        track.devices.push({ id: 'yeast-1', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} });
    }
    const entry = makeInstrumentEntry();
    const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>([[track.id, [entry]]]);
    const pendingWorkletEvents: PendingWorkletEvent[] = [];

    const inputNode = {} as GainNode;
    const gainNode = {} as GainNode;
    const panNode = {} as StereoPannerNode;
    const destination = {} as AudioNode;

    await scheduleTrackClips(
        offlineCtx,
        track,
        makeMidi(),
        inputNode,
        gainNode,
        panNode,
        destination,
        /* durationSeconds */ 60,
        /* defaultTempo */ 120,
        /* changes */ [],
        projectOfflineMidiEvents,
        /* onWarning */ undefined,
        pendingWorkletEvents,
        /* allTracks */ [track],
        deviceEntriesByTrack,
        /* regionStartBeat */ 0,
        mocks.processOfflineYeastMidi
    );

    return pendingWorkletEvents;
}

describe('scheduleTrackClips — MIDI plugin-delay compensation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneValue.value = null;
        mocks.automationValue.value = null;
        mocks.getCompensationDelay.mockReturnValue(0);
        projectedStartOffset = 0;
        projectedVelocity = null;
        mocks.processOfflineYeastMidi.mockImplementation((input) =>
            input.events.map((event) => {
                if (event.kind.type !== 'noteOn' && event.kind.type !== 'noteOff') {
                    return event;
                }
                return { ...event, kind: { ...event.kind, note: (event.kind.note ?? 0) + 12 } };
            })
        );
        configureOfflineMidiEventProjection({ createProjector: () => projectOfflineMidiEvents });
        configureOfflinePpqEndpointProjection({ project: projectPpqEndpoints });
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

    it('projects committed clip timing and dynamics before offline scheduling', async () => {
        projectedStartOffset = 0.5;
        projectedVelocity = 40;

        const events = await runSchedule();

        expect(mocks.projectCommittedGroove).toHaveBeenCalledWith({
            events: makeMidi().notesByClipId['clip-1'],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 4,
            iterationStartBeat: 0,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
            loopEnabled: false,
        });
        const onEvt = events.find((event) => event.type === 'on');
        const offEvt = events.find((event) => event.type === 'off');
        expect(onEvt).toMatchObject({ time: 0.75, velocity: 40 });
        expect(offEvt).toMatchObject({ time: 1.25 });
    });

    it('runs the snapshotted Yeast projection before offline instrument scheduling', async () => {
        const events = await runSchedule({ withYeast: true });

        expect(mocks.processOfflineYeastMidi).toHaveBeenCalledTimes(1);
        expect(events.find((event) => event.type === 'on')).toMatchObject({ pitch: 72 });
        expect(events.find((event) => event.type === 'off')).toMatchObject({ pitch: 72 });
    });
});
