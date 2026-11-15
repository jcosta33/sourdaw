import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyUserMock = vi.hoisted(() => vi.fn());
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: notifyUserMock,
}));

// Removing and restoring a track tears down and rebuilds its engine strip;
// jsdom's stubbed AudioContext cannot build one. The subject here is what
// project truth holds through remove, undo and redo, so the engine seam is
// stubbed rather than exercised.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    openCachedAudioBufferHold: vi.fn(() => {
        throw new Error('Unexpected audio buffer residency hold in this fixture');
    }),
    captureOfflineRenderProjectSource: vi.fn(() => {
        throw new Error('Unexpected selection render capture in this fixture');
    }),
    captureOfflineRenderRuntimeInput: vi.fn(() => {
        throw new Error('Unexpected selection render capture in this fixture');
    }),
    builtinSynthVoice: { read: vi.fn() },
    rearmCommittedTrackInputMonitoring: vi.fn(async () => undefined),
    reconcileAutoInputMonitoring: vi.fn(),
    stopTrackInputMonitoring: vi.fn(),

    startFaustNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    projectsToDifferentNativeBank: vi.fn(() => false),
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
    restoreUnpinnedAudioBuffersFromIdb: vi.fn(),
    holdAudioBufferForSession: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getEngineState: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getMasterAnalyser: vi.fn(() => null),
    getRuntimeGraphRevision: vi.fn(),
    getTrackAnalyser: vi.fn(() => null),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeSend: vi.fn(),
    removeTrackStrip: vi.fn(),
    deactivateTrackStrip: vi.fn(),
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
    sendNativeLiveMidiControl: () => Promise.resolve(true),
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
import { LEGACY_MIDI_PROBABILITY_SEED, midiStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function trackLane(laneId: string, trackId: string) {
    return {
        id: laneId,
        trackId,
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

function clipLane(laneId: string, trackId: string, clipId: string) {
    return { ...trackLane(laneId, trackId), clipId };
}

function midiClip(id: string, trackId: string) {
    return ClipDummy.create({ id, trackId, startBeat: 0, endBeat: 4, type: 'midi' });
}

// Track A holds `live` on its main row (alternative 1) and `c` in the inactive
// alternative 2. Clip `x` was moved to B after the last switch, so alternative
// 1's stored copy still names it: that copy is stale and `x` is B's clip.
function trackA() {
    const live = midiClip('live', 'a');
    return TrackDummy.create({
        id: 'a',
        name: 'A',
        kind: 'midi',
        clips: [live],
        activeAlternativeId: 'alt-1',
        alternatives: [
            { id: 'alt-1', name: 'Alternative 1', clips: [live, midiClip('x', 'a')] },
            { id: 'alt-2', name: 'Alternative 2', clips: [midiClip('c', 'a')] },
        ],
    });
}

function trackB() {
    const x = midiClip('x', 'b');
    return TrackDummy.create({
        id: 'b',
        name: 'B',
        kind: 'midi',
        clips: [x],
        activeAlternativeId: 'alt-b',
        alternatives: [{ id: 'alt-b', name: 'Alternative 1', clips: [x] }],
    });
}

function clipMidi(clipId: string, pitch: number) {
    return {
        // Two notes out of pitch order, so a restore that re-sorted them shows.
        notes: [
            { id: `note-${clipId}-2`, pitch: pitch + 7, startBeat: 1, duration: 1, velocity: 90 },
            { id: `note-${clipId}-1`, pitch, startBeat: 0, duration: 1, velocity: 100 },
        ],
        cc: [{ id: `cc-${clipId}`, controller: 1, value: pitch, beat: 0, channel: 0 }],
        bend: [{ id: `bend-${clipId}`, value: pitch, beat: 0, channel: 0 }],
    };
}

const midiByClip = { live: clipMidi('live', 60), c: clipMidi('c', 62), x: clipMidi('x', 64) };
const clipIds = ['live', 'c', 'x'] as const;

function gainEnvelope(clipId: string) {
    return { clipId, points: [{ id: `${clipId}-g1`, beatOffset: 0, gainDb: -6 }], enabled: true };
}

// Retired clip lanes sit between surviving lanes, so a restore that appended
// them instead of putting them back where they were shows in the order.
const seededLanes = [
    trackLane('lane-track', 'a'),
    clipLane('lane-c', 'a', 'c'),
    clipLane('lane-live', 'a', 'live'),
    clipLane('lane-x', 'b', 'x'),
    trackLane('lane-tail', 'a'),
];

let seededTracks: ReturnType<typeof trackA>[] = [];

function seedStores(): void {
    trackStore.set({ tracks: [trackA(), trackB()], selectedTrackId: null, ghostClips: [] });
    // The rows as the store projects them, so a restore is compared against
    // what the store held rather than the fixture's unnormalized shape.
    seededTracks = structuredClone(trackStore.value!.tracks);
    automationStore.set({ lanes: structuredClone(seededLanes) });
    midiStore.set({
        probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
        notesByClipId: Object.fromEntries(clipIds.map((id) => [id, midiByClip[id].notes])),
        ccByClipId: Object.fromEntries(clipIds.map((id) => [id, midiByClip[id].cc])),
        pitchBendByClipId: Object.fromEntries(clipIds.map((id) => [id, midiByClip[id].bend])),
    });
    for (const clipId of clipIds) {
        setEnvelope(clipId, gainEnvelope(clipId));
    }
}

function expectClipDataPresent(clipId: (typeof clipIds)[number]): void {
    const midi = midiStore.value!;
    expect(midi.notesByClipId[clipId]).toEqual(midiByClip[clipId].notes);
    expect(midi.ccByClipId[clipId]).toEqual(midiByClip[clipId].cc);
    expect(midi.pitchBendByClipId[clipId]).toEqual(midiByClip[clipId].bend);
    expect(getEnvelope(clipId)).toEqual(gainEnvelope(clipId));
}

function expectClipDataRetired(clipId: string): void {
    const midi = midiStore.value!;
    expect(automationStore.value!.lanes.filter((candidate) => candidate.clipId === clipId)).toEqual([]);
    expect(midi.notesByClipId[clipId]).toBeUndefined();
    expect(midi.ccByClipId[clipId]).toBeUndefined();
    expect(midi.pitchBendByClipId[clipId]).toBeUndefined();
    expect(getEnvelope(clipId)).toBeUndefined();
}

function laneIds(): string[] {
    return automationStore.value!.lanes.map((candidate) => candidate.id);
}

function expectSeededState(): void {
    expect(trackStore.value!.tracks).toEqual(seededTracks);
    expect(automationStore.value!.lanes).toEqual(seededLanes);
    for (const clipId of clipIds) {
        expectClipDataPresent(clipId);
    }
}

function trackAAlternativeIds(): string[] {
    return trackStore.value!.tracks.find((track) => track.id === 'a')!.alternatives.map((alt) => alt.id);
}

describe('deleteTrackAlternative retires the clips the alternative held (#6633)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('delete track alternative clip satellites integration');
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
        seedStores();
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
        __resetGainEnvelopesForTest();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it("retires an inactive alternative's clip lanes, MIDI and envelope, and undo puts them back exactly", async () => {
        await executeAppAction(
            { type: 'deleteTrackAlternative', payload: { trackId: 'a', alternativeId: 'alt-2' } },
            { source: 'manual' }
        );
        expect(trackAAlternativeIds()).toEqual(['alt-1']);
        expectClipDataRetired('c');
        expectClipDataPresent('live');
        expectClipDataPresent('x');
        expect(laneIds()).toEqual(['lane-track', 'lane-live', 'lane-x', 'lane-tail']);

        await undo();
        expectSeededState();

        await redo();
        expect(trackAAlternativeIds()).toEqual(['alt-1']);
        expectClipDataRetired('c');
        expectClipDataPresent('live');
        expectClipDataPresent('x');

        await undo();
        expectSeededState();
        expect(notifyUserMock).not.toHaveBeenCalled();
    });

    it("retires only the active alternative's live clips, never a clip its stale copy names on another track", async () => {
        await executeAppAction(
            { type: 'deleteTrackAlternative', payload: { trackId: 'a', alternativeId: 'alt-1' } },
            { source: 'manual' }
        );
        const a = trackStore.value!.tracks.find((track) => track.id === 'a')!;
        expect(a.activeAlternativeId).toBe('alt-2');
        expect(a.clips.map((clip) => clip.id)).toEqual(['c']);
        expectClipDataRetired('live');
        expectClipDataPresent('c');
        expectClipDataPresent('x');
        expect(laneIds()).toEqual(['lane-track', 'lane-c', 'lane-x', 'lane-tail']);

        await undo();
        expectSeededState();

        await redo();
        expectClipDataRetired('live');
        expectClipDataPresent('c');
        expectClipDataPresent('x');

        await undo();
        expectSeededState();
        expect(notifyUserMock).not.toHaveBeenCalled();
    });

    it('refuses an undo whose retired lane id a peer re-created, writes nothing, and undoes once the row is gone', async () => {
        await executeAppAction(
            { type: 'deleteTrackAlternative', payload: { trackId: 'a', alternativeId: 'alt-2' } },
            { source: 'manual' }
        );
        expectClipDataRetired('c');
        const peerLane = { ...trackLane('lane-c', 'a'), parameterId: 'pan', parameterName: 'Pan' };
        automationStore.set({ lanes: [...automationStore.value!.lanes, peerLane] });
        const tracksBeforeUndo = structuredClone(trackStore.value!.tracks);
        const lanesBeforeUndo = structuredClone(automationStore.value!.lanes);

        const refused = await undo();
        expect(refused.headConsumed).toBe(false);
        expect(trackStore.value!.tracks).toEqual(tracksBeforeUndo);
        expect(automationStore.value!.lanes).toEqual(lanesBeforeUndo);
        expect(midiStore.value!.notesByClipId.c).toBeUndefined();
        expect(getEnvelope('c')).toBeUndefined();

        await redo();
        expect(trackStore.value!.tracks).toEqual(tracksBeforeUndo);
        expect(automationStore.value!.lanes).toEqual(lanesBeforeUndo);
        expect(midiStore.value!.notesByClipId.c).toBeUndefined();

        automationStore.set({
            lanes: automationStore.value!.lanes.filter((candidate) => candidate.parameterId !== 'pan'),
        });
        const accepted = await undo();
        expect(accepted.headConsumed).toBe(true);
        expectSeededState();

        await redo();
        expectClipDataRetired('c');
        expectClipDataPresent('live');
    });
});
