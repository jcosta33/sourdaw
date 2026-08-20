import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';

import { buildDeviceChain, type DeviceNodeEntry } from '../../buildDeviceChain';
import { schedulePendingSuspends } from '../schedulePendingSuspends';
import { scheduleTrackClips } from '../scheduleTrackClips';
import { type PendingWorkletEvent } from '../types';

/**
 * A Faust instrument track has to bounce as itself.
 *
 * The offline Faust strategy carried no note surface, so its chain entry had no
 * `instrumentControls`, `scheduleTrackClips` read the track as having no
 * instrument, and every note went to `getSynthParamsFromDevices` — whose builtin
 * default is a sawtooth at 0.3 gain. The part played correctly in the session
 * and bounced as a synth lead.
 */

const FAUST_INSTRUMENT = 'faust-supersaw-unison';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        isFaustModule: vi.fn((type: string) => type.startsWith('faust-')),
        isFaustInstrumentModule: vi.fn((type: string) => type === 'faust-supersaw-unison'),
        createFaustDevice: vi.fn(),
        keyOn: vi.fn(),
        keyOff: vi.fn(),
        scheduleNoteOffline: vi.fn(),
        getSynthParamsFromDevices: vi.fn(() => ({ waveform: 'sawtooth', gain: 0.3 })),
        scheduleTrackAutomation: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    compileFaustDSP: vi.fn(),
    createFaustNode: vi.fn(),
    isFaustModule: mocks.isFaustModule,
    isFaustInstrumentModule: mocks.isFaustInstrumentModule,
}));

vi.mock('../../../repositories/faustDeviceFactory', () => ({
    createFaustDevice: mocks.createFaustDevice,
}));

// Partial: the offline path only calls these five, but the Arrangement barrel
// scheduleTrackClips reads the device-parameter law from also reaches MIDI's
// live-input wiring, which imports other members of this barrel at module load.
vi.mock('#/modules/Synth/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Synth/useCases')>();
    return {
        ...actual,
        getDrumKitDefByIndex: vi.fn(() => null),
        getSynthParamsFromDevices: mocks.getSynthParamsFromDevices,
        scheduleDrumKitNote: vi.fn(),
        scheduleKitNote: vi.fn(),
        scheduleNoteOffline: mocks.scheduleNoteOffline,
    };
});

vi.mock('../../../services/deviceResolution', () => ({
    resolveDrumKit: vi.fn(() => null),
}));

vi.mock('../../../repositories/offlineScheduler/automationScheduling', () => ({
    scheduleTrackAutomation: mocks.scheduleTrackAutomation,
}));

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: vi.fn(() => 0),
}));

const SAMPLE_RATE = 48_000;

function makeAudioNode(): AudioNode {
    return { connect: vi.fn(), disconnect: vi.fn(), numberOfInputs: 0 } as unknown as AudioNode;
}

function makeOfflineCtx(): OfflineAudioContext {
    return { sampleRate: SAMPLE_RATE, currentTime: 0 } as unknown as OfflineAudioContext;
}

function makeTrack(): Track {
    return {
        id: 'track-faust',
        name: 'Supersaw',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [
            {
                id: 'clip-1',
                trackId: 'track-faust',
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
        devices: [
            { id: 'faust-1', name: 'Supersaw Unison', type: FAUST_INSTRUMENT, bypassed: false, parameterValues: {} },
        ],
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
    };
}

function makeMidi(): NonNullable<MidiStoreState> {
    return {
        probabilitySeed: 1,
        notesByClipId: {
            'clip-1': [{ id: 'note-1', pitch: 64, startBeat: 1, duration: 1, velocity: 100 }],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    };
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

async function renderFaustTrack(): Promise<{
    entries: DeviceNodeEntry[];
    pendingWorkletEvents: PendingWorkletEvent[];
}> {
    const offlineCtx = makeOfflineCtx();
    const track = makeTrack();
    const trackInputNode = makeAudioNode() as GainNode;
    const trackPanNode = makeAudioNode() as StereoPannerNode;

    const entries = await buildDeviceChain(offlineCtx, track.devices, trackInputNode, trackPanNode);

    const pendingWorkletEvents: PendingWorkletEvent[] = [];
    await scheduleTrackClips({
        offlineCtx,
        track,
        midi: makeMidi(),
        trackInputNode,
        trackGainNode: makeAudioNode() as GainNode,
        trackPanNode,
        destination: makeAudioNode(),
        durationSeconds: 60,
        defaultTempo: 120,
        changes: [],
        projections: {
            projectMidiEvents: ({ events }) => events,
            projectPpqEndpoints,
            processYeastMidi: null,
            resolveTempoAtBeat: null,
            selectMidiEventProbability: () => true,
            projectChordPitch: ({ pitch }) => pitch,
            evaluateAutomationValue: null,
        },
        pendingWorkletEvents,
        allTracks: [track],
        deviceEntriesByTrack: new Map([[track.id, entries]]),
    });

    return { entries, pendingWorkletEvents };
}

describe('offline render of a Faust instrument track', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('AudioWorkletNode', undefined);
        mocks.isFaustModule.mockImplementation((type: string) => type.startsWith('faust-'));
        mocks.isFaustInstrumentModule.mockImplementation((type: string) => type === FAUST_INSTRUMENT);
        mocks.getSynthParamsFromDevices.mockReturnValue({ waveform: 'sawtooth', gain: 0.3 });
        mocks.createFaustDevice.mockImplementation(() => {
            const faustNode = {
                setParamValue: vi.fn(),
                parameters: new Map<string, AudioParam>(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                numberOfInputs: 0,
            };
            return Promise.resolve({
                inputNode: faustNode as unknown as AudioNode,
                outputNode: faustNode as unknown as AudioNode,
                nodes: [faustNode as unknown as AudioNode],
                wamControls: {
                    setParam: vi.fn(),
                    scheduleParam: vi.fn(),
                    keyOn: mocks.keyOn,
                    keyOff: mocks.keyOff,
                },
            });
        });
    });

    it('voices the note on the Faust instrument instead of the fallback synth', async () => {
        const { pendingWorkletEvents } = await renderFaustTrack();

        // The fallback synth (sawtooth at 0.3) must not have been reached.
        expect(mocks.scheduleNoteOffline).not.toHaveBeenCalled();

        schedulePendingSuspends(makeOfflineCtx(), pendingWorkletEvents, 60);

        // Beat 1 at 120bpm = 0.5s. keyOn(channel, pitch, velocity, time).
        expect(mocks.keyOn).toHaveBeenCalledWith(0, 64, 100, 0.5);
        // Note ends at beat 2 = 1.0s.
        expect(mocks.keyOff).toHaveBeenCalledWith(0, 64, 0, 1);
    });

    it('gives a Faust effect no note surface, so it cannot shadow an instrument', async () => {
        mocks.isFaustInstrumentModule.mockReturnValue(false);

        const { entries } = await renderFaustTrack();

        expect(entries.map((entry) => entry.deviceType)).toEqual([FAUST_INSTRUMENT]);
        expect(entries[0]?.instrumentControls).toBeUndefined();
    });
});
