import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyUserMock = vi.hoisted(() => vi.fn());
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: notifyUserMock,
}));

// `discardCreatedTrack` tears the copy's engine strip down through the deferred
// removal effects; jsdom's stubbed AudioContext cannot build one. The subject
// here is what project truth holds after undo, so the engine seam is stubbed
// rather than exercised.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    soundsNativeNotes: vi.fn(() => false),
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
    ensureBusStrip: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getEngineState: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getLiveEngineSampleRate: vi.fn(),
    getMasterAnalyser: vi.fn(() => null),
    getRuntimeGraphRevision: vi.fn(),
    getTrackAnalyser: vi.fn(() => null),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeSend: vi.fn(),
    removeTrackStrip: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    reportLatency: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSolo: vi.fn(),
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    wireSidechainRoute: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
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
import { LEGACY_MIDI_PROBABILITY_SEED, midiStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function clipScopedLane(laneId: string, trackId: string, clipId: string) {
    return {
        id: laneId,
        trackId,
        clipId,
        parameterId: 'gain',
        parameterName: 'Gain',
        points: [
            { id: `${laneId}-p1`, beat: 0, value: 0.5, curve: 'linear' as const, tension: 0 },
            { id: `${laneId}-p2`, beat: 2, value: 1, curve: 'linear' as const, tension: 0 },
        ],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function sourceTrack() {
    const clip = ClipDummy.create({ id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 4, type: 'midi' });
    return TrackDummy.create({
        id: 'track-1',
        name: 'Source',
        kind: 'midi',
        clips: [clip],
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [clip] }],
        activeAlternativeId: 'alt-1',
    });
}

function copyTrack() {
    return trackStore.value!.tracks.find((track) => track.id !== 'track-1')!;
}

async function duplicateTrack(): Promise<void> {
    await executeAppAction({ type: 'duplicateTrack', payload: { trackId: 'track-1' } }, { source: 'manual' });
    expect(trackStore.value!.tracks).toHaveLength(2);
}

async function expectUndoRefused(): Promise<void> {
    const result = await undo();
    expect(result).toEqual({ headConsumed: false });
    expect(notifyUserMock).toHaveBeenCalledWith('Cannot undo "Duplicate track": project state has changed', 'warning');
}

describe('handleDuplicateTrack atomic integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('duplicate track atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setArrangementEventBus(new NoopArrangementEventBus());
        trackStore.set({ tracks: [sourceTrack()], selectedTrackId: 'track-1', ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        midiStore.set({
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits the duplicate and undo removes the copy', async () => {
        await duplicateTrack();

        await undo();

        expect(trackStore.value!.tracks.map((track) => track.id)).toEqual(['track-1']);
    });

    it('carries the clip-scoped automation lane onto the copy and undoes track and lanes atomically (issue #2920)', async () => {
        automationStore.set({ lanes: [clipScopedLane('lane-1', 'track-1', 'clip-1')] });

        await duplicateTrack();

        const copy = copyTrack();
        const copyClip = copy.clips[0]!;
        // The copy's clip owns one fresh clip-scoped lane, keyed to the copy's
        // clip and track ids, carrying the source's points.
        const copyLanes = automationStore.value!.lanes.filter((lane) => lane.clipId === copyClip.id);
        expect(copyLanes).toHaveLength(1);
        expect(copyLanes[0]!.trackId).toBe(copy.id);
        expect(copyLanes[0]!.points).toEqual(clipScopedLane('lane-1', 'track-1', 'clip-1').points);

        await undo();

        // The copy is gone together with the lane its duplication cloned; the
        // source keeps its clip and its own lane.
        expect(trackStore.value!.tracks.map((track) => track.id)).toEqual(['track-1']);
        expect(trackStore.value!.tracks[0]!.clips.map((clip) => clip.id)).toEqual(['clip-1']);
        expect(automationStore.value!.lanes.map((lane) => lane.id)).toEqual(['lane-1']);
    });

    it('refuses undo after the cloned lane is edited on the copy', async () => {
        automationStore.set({ lanes: [clipScopedLane('lane-1', 'track-1', 'clip-1')] });

        await duplicateTrack();

        const copy = copyTrack();
        const copyClip = copy.clips[0]!;
        const clonedLaneId = automationStore.value!.lanes.find((lane) => lane.clipId === copyClip.id)!.id;
        // An automation edit on the copy — behind the command layer's back,
        // standing in for the same user's later piano-roll-style edit.
        const divergedPoints = [{ id: 'edited-p1', beat: 1, value: 0.9, curve: 'linear' as const, tension: 0 }];
        automationStore.set({
            lanes: automationStore.value!.lanes.map((lane) =>
                lane.id === clonedLaneId ? { ...lane, points: divergedPoints } : lane
            ),
        });

        await expectUndoRefused();

        expect(trackStore.value!.tracks.map((track) => track.id)).toContain(copy.id);
        expect(automationStore.value!.lanes.find((lane) => lane.id === clonedLaneId)!.points).toEqual(divergedPoints);
    });

    it('still refuses undo after the copy track entity diverges', async () => {
        automationStore.set({ lanes: [clipScopedLane('lane-1', 'track-1', 'clip-1')] });

        await duplicateTrack();

        const copy = copyTrack();
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => (track.id === copy.id ? { ...track, name: 'Edited copy' } : track)),
        });

        await expectUndoRefused();

        expect(trackStore.value!.tracks).toHaveLength(2);
    });

    it('still refuses undo after the copy clip MIDI state diverges', async () => {
        automationStore.set({ lanes: [clipScopedLane('lane-1', 'track-1', 'clip-1')] });

        await duplicateTrack();

        const copyClip = copyTrack().clips[0]!;
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                [copyClip.id]: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
        });

        await expectUndoRefused();

        expect(trackStore.value!.tracks).toHaveLength(2);
        expect(midiStore.value!.notesByClipId[copyClip.id]).toHaveLength(1);
    });
});
