import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Web MIDI input the take's live route listens on. Stubbed before the MIDI
 * module loads, because its supported-platform check reads `navigator` once at
 * import.
 */
const liveMidi = vi.hoisted(() => {
    const input = Object.assign(new EventTarget(), { id: 'live-input', name: 'Live input', manufacturer: 'Test' });
    const access = { inputs: new Map([[input.id, input]]), outputs: new Map(), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: () => Promise.resolve(access),
    });
    return { input };
});

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import {
    createTrack,
    duplicateClip,
    getArrangementHandlers,
    startRecording,
    stopRecording,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    destroyWebMidi,
    initWebMidi,
    projectClipControllerEvents,
    setMidiInputTrack,
    setWebMidiRuntimeEventBus,
} from '#/modules/MIDI/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { projectPpqEndpoints } from '#/modules/Transport/useCases';

import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { schedulePendingSuspends } from '../schedulePendingSuspends';
import { scheduleTrackClips } from '../scheduleTrackClips';
import { type PendingWorkletEvent } from '../types';

const TRACK_ID = 'track-midi';
const DEVICE_ID = 'gb-1';
/** At 120 BPM and 48 kHz a beat is 24 000 frames. */
const BEAT_FRAMES = 24_000;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

/**
 * A controller-only take, recorded through the Web MIDI input route into the
 * real stores, rendered by the real export scheduler: its stored pedal reaches
 * the instrument although the take never wrote a note list. The scheduler and
 * the controller projection are production code; the offline context and the
 * instrument entry are doubled.
 */
describe('a recorded controller-only take, rendered by the offline export scheduler', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('controller take export integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: TRACK_ID, name: 'Piano', kind: 'midi', withoutDefaultDevice: true }),
                    armed: true,
                    devices: [
                        {
                            id: DEVICE_ID,
                            name: 'Grand Boule',
                            type: 'grand-boule',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                },
            ],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        transportStore.set({
            ...transportStore.value!,
            isRecording: false,
            overdubEnabled: false,
            isLooping: false,
            playheadPosition: 4,
        });
    });

    afterEach(() => {
        transportStore.set({ ...transportStore.value!, isRecording: false, overdubEnabled: false });
        destroyWebMidi();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    /** Record a sustain press at beat 4.5 and release at 5.5 on the live input into a clip spanning beats 4 to 8. */
    async function recordPedalOnlyTake(): Promise<string> {
        setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
        await initWebMidi();
        setMidiInputTrack(TRACK_ID);
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        transportStore.set({ ...transportStore.value!, isRecording: true });
        const send = (beat: number, ...bytes: number[]): void => {
            transportStore.set({ ...transportStore.value!, playheadPosition: beat });
            liveMidi.input.dispatchEvent(Object.assign(new Event('midimessage'), { data: Uint8Array.from(bytes) }));
        };
        send(4.5, 0xb0, 64, 127);
        send(5.5, 0xb0, 64, 0);
        await stopRecording(8);
        transportStore.set({ ...transportStore.value!, isRecording: false });
        flushAutomergeStorageWrites();
        return provisional.id;
    }

    /** What the Grand Boule instrument receives from an export of the whole project, in arrival order. */
    async function exportArrivals(): Promise<string[]> {
        const arrivals: string[] = [];
        const strategy: DeviceNodeEntry['strategy'] = {
            node: { inputNode: {} as AudioNode, outputNode: {} as AudioNode, nodes: [] },
            acceptsNotes: true,
            setParam: () => {},
            resolveOfflineAutomation: () => null,
            controlChange: ({ controller, value, sampleFrame }) =>
                arrivals.push(`control ${controller}=${value} @${sampleFrame}`),
        };
        const entry: DeviceNodeEntry = {
            deviceId: DEVICE_ID,
            deviceType: 'grand-boule',
            contributesAudio: true,
            node: strategy.node,
            strategy,
            instrumentControls: {
                noteOn: ({ sampleFrame }) => arrivals.push(`noteOn @${sampleFrame}`),
                noteOff: ({ sampleFrame }) => arrivals.push(`noteOff @${sampleFrame}`),
            },
        };
        const track = trackStore.value!.tracks.find(({ id }) => id === TRACK_ID)!;
        const midi = midiStore.value!;
        const events: PendingWorkletEvent[] = [];
        const offlineCtx = { sampleRate: 48_000, currentTime: 0 } as unknown as OfflineAudioContext;

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
                projectMidiEvents: ({ events: notes }) => notes,
                projectPpqEndpoints,
                processYeastMidi: () => [],
                resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
                selectMidiEventProbability: () => true,
                projectChordPitch: ({ pitch }) => pitch,
                evaluateAutomationValue: () => null,
                projectClipControllers: projectClipControllerEvents,
            },
            pendingWorkletEvents: events,
            allTracks: [track],
            deviceEntriesByTrack: new Map([[track.id, [entry]]]),
            regionStartBeat: 0,
        });

        schedulePendingSuspends(offlineCtx, events, 60);
        return arrivals;
    }

    it('renders the stored pedal without a note list, and undo and redo take it away and give it back', async () => {
        const clipId = await recordPedalOnlyTake();
        expect(midiStore.value?.notesByClipId[clipId]).toBeUndefined();
        const pedal = [`control 64=127 @${4.5 * BEAT_FRAMES}`, `control 64=0 @${5.5 * BEAT_FRAMES}`];

        expect(await exportArrivals()).toEqual(pedal);

        await undo();
        flushAutomergeStorageWrites();
        expect(await exportArrivals()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(await exportArrivals()).toEqual(pedal);
        expect(midiStore.value?.notesByClipId[clipId]).toBeUndefined();
    });

    it('renders the stored pedal of a duplicate of the take, which copies the rows and no note list', async () => {
        const clipId = await recordPedalOnlyTake();
        expect(duplicateClip(clipId)).toBe(true);
        const copy = trackStore.value!.tracks.flatMap((track) => track.clips).find(({ id }) => id !== clipId)!;
        expect(midiStore.value?.ccByClipId[copy.id]).toHaveLength(2);
        expect(midiStore.value?.notesByClipId[copy.id]).toBeUndefined();

        expect(await exportArrivals()).toEqual([
            `control 64=127 @${4.5 * BEAT_FRAMES}`,
            `control 64=0 @${5.5 * BEAT_FRAMES}`,
            `control 64=127 @${8.5 * BEAT_FRAMES}`,
            `control 64=0 @${9.5 * BEAT_FRAMES}`,
        ]);
    });
});
