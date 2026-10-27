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
    stageRecordingTake,
    startRecording,
    stopRecording,
    admitRecordingMidiExpression,
    admitRecordingMidiNoteOff,
    admitRecordingMidiNoteOn,
    findOpenRecordingMidiAdmission,
    findOpenRecordingMidiMemberAdmission,
    getRecordingMidiAdmission,
    retireRecordingMidiAdmission,
    takeOwnsRecordingRoot,
    recordingMidiSourceBeatAt,
} from '#/modules/Arrangement/useCases';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
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
    captureEventPositionAt,
    destroyWebMidi,
    initWebMidi,
    projectClipControllerEvents,
    setMidiInputTrack,
    setRecordingMidiAdmissionPort,
    setWebMidiRuntimeEventBus,
} from '#/modules/MIDI/useCases';
import { playheadClockRef, playheadWrapCountRef, transportStore } from '#/modules/Transport/stores';
import { projectPpqEndpoints } from '#/modules/Transport/useCases';

import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { schedulePendingSuspends } from '../schedulePendingSuspends';
import { scheduleTrackClips } from '../scheduleTrackClips';
import { type PendingWorkletEvent } from '../types';

const TRACK_ID = 'track-midi';
const DEVICE_ID = 'gb-1';
/** At 120 BPM and 48 kHz a beat is 24 000 frames. */
const BEAT_FRAMES = 24_000;
let disposeRecordingAdmission = (): void => {};

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
        disposeRecordingAdmission = setRecordingMidiAdmissionPort({
            admitRecordingMidiNoteOn,
            admitRecordingMidiNoteOff,
            admitRecordingMidiExpression,
            findOpenRecordingMidiAdmission,
            findOpenRecordingMidiMemberAdmission,
            getRecordingMidiAdmission,
            retireRecordingMidiAdmission,
            takeOwnsRecordingRoot,
            recordingMidiSourceBeatAt,
        });
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
        disposeRecordingAdmission();
        playheadClockRef.hold = null;
        playheadWrapCountRef.current = 0;
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

    it('exports only the selected recorded pass after the live controller and bend cross two wraps', async () => {
        setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
        await initWebMidi();
        setMidiInputTrack(TRACK_ID);
        playheadWrapCountRef.current = 0;
        transportStore.set({
            ...transportStore.value!,
            isLooping: true,
            loopStart: 4,
            loopEnd: 8,
            playheadPosition: 4,
        });
        const [clip] = startRecording(4);
        expect(clip).toBeDefined();
        transportStore.set({ ...transportStore.value!, isRecording: true, isPlaying: true });

        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: clip!.id,
            name: 'first pass',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 0,
            recordingPassIndex: 0,
        });
        playheadWrapCountRef.current = 1;
        const send = (beat: number, ...bytes: number[]): void => {
            playheadClockRef.hold = { generation: 123, beat };
            expect(captureEventPositionAt({ audioTime: audioEngine.context.currentTime })).toEqual({
                beat,
                passIndex: 1,
            });
            liveMidi.input.dispatchEvent(Object.assign(new Event('midimessage'), { data: Uint8Array.from(bytes) }));
        };
        send(4.5, 0xb0, 64, 127);
        send(4.75, 0xe0, 127, 127);
        send(5.5, 0xb0, 64, 0);
        send(5.75, 0xe0, 0, 64);
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: clip!.id,
            name: 'second pass',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 4,
            recordingPassIndex: 1,
        });
        playheadWrapCountRef.current = 2;
        playheadClockRef.hold = { generation: 123, beat: 4.25 };
        await stopRecording(4.25);
        transportStore.set({ ...transportStore.value!, isRecording: false, isPlaying: false });
        flushAutomergeStorageWrites();

        expect(
            midiStore.value?.ccByClipId[clip!.id]?.map(({ controller, value, beat }) => [controller, value, beat])
        ).toEqual([
            [64, 127, 4.5],
            [64, 0, 5.5],
        ]);
        expect(midiStore.value?.pitchBendByClipId[clip!.id]?.map(({ value, beat }) => [value, beat])).toEqual([
            [8191, 4.75],
            [0, 5.75],
        ]);
        expect(
            undoHistoryStore.value?.past.filter(
                (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
            )
        ).toHaveLength(1);

        const lane = takeLaneStore.value!.lanes.find((candidate) => candidate.trackId === TRACK_ID)!;
        const selectPass = (index: number): void => {
            const take = lane.takes.find((candidate) => candidate.recordingPassIndex === index)!;
            takeLaneStore.set({
                lanes: [{ ...lane, activeCompRegions: [{ startBeat: 4, endBeat: 8, takeId: take.id }] }],
            });
        };
        selectPass(0);
        expect(await exportArrivals()).toEqual([]);
        selectPass(1);
        expect(await exportArrivals()).toEqual([
            `control 64=127 @${4.5 * BEAT_FRAMES}`,
            `control 64=0 @${5.5 * BEAT_FRAMES}`,
        ]);
        selectPass(2);
        // The preceding pass's released pedal is carried as a neutral value at the next head.
        expect(await exportArrivals()).toEqual([`control 64=0 @${4 * BEAT_FRAMES}`]);

        await undo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.ccByClipId[clip!.id]).toBeUndefined();
        expect(midiStore.value?.pitchBendByClipId[clip!.id]).toBeUndefined();
        await redo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.ccByClipId[clip!.id]?.map(({ beat }) => beat)).toEqual([4.5, 5.5]);
        expect(midiStore.value?.pitchBendByClipId[clip!.id]?.map(({ beat }) => beat)).toEqual([4.75, 5.75]);
    });
});
