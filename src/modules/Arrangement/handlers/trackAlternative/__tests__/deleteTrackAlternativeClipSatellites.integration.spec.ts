import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyUserMock = vi.hoisted(() => vi.fn());
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: notifyUserMock,
}));

// Removing and restoring a track tears down and rebuilds its engine strip;
// jsdom's stubbed AudioContext cannot build one. The subject here is what
// project truth holds through remove, undo and redo, so the engine seam is
// stubbed rather than exercised.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        findPadOutputHost: actual.findPadOutputHost,
        hasPadOutputHost: actual.hasPadOutputHost,
        hostsPadOutputs: actual.hostsPadOutputs,
        findMidiTransformDevice: actual.findMidiTransformDevice,
        isMidiTransformDevice: actual.isMidiTransformDevice,
        commitPitchEdit: vi.fn(),
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
        isBuiltinSynthDevice: actual.isBuiltinSynthDevice,
        isBypassedNoteReceiver: actual.isBypassedNoteReceiver,
        isDrumDevice: actual.isDrumDevice,
        resolveDrumKitBy: actual.resolveDrumKitBy,
        resolveDrumKitOutputGain: actual.resolveDrumKitOutputGain,
        resolveLiveNoteControls: actual.resolveLiveNoteControls,
        resolveNoteReceivingInstrument: actual.resolveNoteReceivingInstrument,
    };
});

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
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
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { LEGACY_MIDI_PROBABILITY_SEED, midiStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { warpStateStore } from '../../../stores/warpStates';
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

function take(id: string, clipId: string, startBeat: number) {
    return { id, clipId, name: id, startBeat, endBeat: startBeat + 2, selected: false };
}

function takeLane(id: string, trackId: string, takes: ReturnType<typeof take>[]) {
    return {
        id,
        trackId,
        takes,
        activeCompRegions: takes.map((candidate) => ({
            takeId: candidate.id,
            startBeat: candidate.startBeat,
            endBeat: candidate.endBeat,
        })),
    };
}

// A's lane holds only `c`'s take, so retiring `c` drops the whole lane, and it
// sits before B's lane, so a restore that appended it would show in the order.
const seededTakeLanes = [
    takeLane('takes-a', 'a', [take('take-c', 'c', 0)]),
    takeLane('takes-b', 'b', [take('take-x', 'x', 0)]),
];

let seededTracks: ReturnType<typeof trackA>[] = [];
let expectedTakeLanes: ReturnType<typeof takeLane>[] = [];

function seedStores(): void {
    trackStore.set({ tracks: [trackA(), trackB()], selectedTrackId: null, ghostClips: [] });
    // The rows as the store projects them, so a restore is compared against
    // what the store held rather than the fixture's unnormalized shape.
    seededTracks = structuredClone(trackStore.value!.tracks);
    automationStore.set({ lanes: structuredClone(seededLanes) });
    seedTakeLanes(seededTakeLanes);
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

function seedTakeLanes(lanes: ReturnType<typeof takeLane>[]): void {
    takeLaneStore.set({ lanes: structuredClone(lanes) });
    expectedTakeLanes = structuredClone(takeLaneStore.value!.lanes);
}

function takeIdsByLane(): string[][] {
    return takeLaneStore.value!.lanes.map((lane) => [lane.id, ...lane.takes.map((candidate) => candidate.id)]);
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
    expect(takeLaneStore.value!.lanes).toEqual(expectedTakeLanes);
    for (const clipId of clipIds) {
        expectClipDataPresent(clipId);
    }
}

function trackAAlternativeIds(): string[] {
    return trackStore.value!.tracks.find((track) => track.id === 'a')!.alternatives.map((alt) => alt.id);
}

function snapshotRetirementState() {
    return {
        root: JSON.stringify(getCrdtDoc('root')),
        tracks: structuredClone(trackStore.value),
        automation: structuredClone(automationStore.value),
        takes: structuredClone(takeLaneStore.value),
        midi: structuredClone(midiStore.value),
        envelopes: clipIds.map((clipId) => structuredClone(getEnvelope(clipId))),
        warp: structuredClone(warpStateStore.value),
        history: structuredClone(undoHistoryStore.value),
    };
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
        takeLaneStore.set({ lanes: [] });
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
        expect(takeIdsByLane()).toEqual([['takes-b', 'take-x']]);

        await undo();
        expectSeededState();

        await redo();
        expect(trackAAlternativeIds()).toEqual(['alt-1']);
        expectClipDataRetired('c');
        expectClipDataPresent('live');
        expectClipDataPresent('x');
        expect(takeIdsByLane()).toEqual([['takes-b', 'take-x']]);

        await undo();
        expectSeededState();
        expect(notifyUserMock).not.toHaveBeenCalled();
    });

    it("retires only the active alternative's live clips, never a clip its stale copy names on another track", async () => {
        // A take on the moved clip `x` sits in A's lane too: `x` is B's clip now,
        // so its take stays with the lane.
        seedTakeLanes([
            takeLane('takes-a', 'a', [take('take-c', 'c', 0), take('take-live', 'live', 2), take('take-xa', 'x', 4)]),
            seededTakeLanes[1]!,
        ]);
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
        expect(takeIdsByLane()).toEqual([
            ['takes-a', 'take-c', 'take-xa'],
            ['takes-b', 'take-x'],
        ]);
        expect(takeLaneStore.value!.lanes[0]!.activeCompRegions.map((region) => region.takeId)).toEqual([
            'take-c',
            'take-xa',
        ]);

        await undo();
        expectSeededState();

        await redo();
        expectClipDataRetired('live');
        expectClipDataPresent('c');
        expectClipDataPresent('x');
        expect(takeIdsByLane()).toEqual([
            ['takes-a', 'take-c', 'take-xa'],
            ['takes-b', 'take-x'],
        ]);

        await undo();
        expectSeededState();
        expect(notifyUserMock).not.toHaveBeenCalled();
    });

    it.each([
        {
            owner: 'another track’s active alternative',
            trackId: 'b',
            inactive: false,
            activeId: 'alt-b',
            staleName: undefined,
        },
        {
            owner: 'another track’s inactive alternative',
            trackId: 'b',
            inactive: true,
            activeId: 'alt-peer',
            staleName: 'Peer Clip',
        },
        {
            owner: 'the same track’s surviving alternative',
            trackId: 'a',
            inactive: false,
            activeId: 'alt-1',
            staleName: undefined,
        },
    ])('refuses Undo while $owner holds the retired clip id', async ({ trackId, inactive, activeId, staleName }) => {
        await executeAppAction(
            { type: 'deleteTrackAlternative', payload: { trackId: 'a', alternativeId: 'alt-2' } },
            { source: 'manual' }
        );
        expectClipDataRetired('c');

        // Keep the local Undo entry at the head while applying the state a peer left.
        const peerOptions = { source: 'manual', skipUndo: true } as const;
        const createPeerAlternative = (alternativeId: string) =>
            executeAppAction(
                {
                    type: 'createTrackAlternative',
                    payload: { trackId, name: alternativeId, duplicateActive: false, alternativeId },
                },
                peerOptions
            );
        if (inactive) {
            await createPeerAlternative('alt-peer');
        }
        await executeAppAction(
            {
                type: 'addClip',
                payload: { id: 'c', trackId, startBeat: 8, endBeat: 12, name: 'Peer Clip', type: 'midi' },
            },
            peerOptions
        );
        if (inactive) {
            await createPeerAlternative('alt-empty');
        }
        const peerTrack = trackStore.value!.tracks.find((track) => track.id === trackId)!;
        let peerClips = peerTrack.clips;
        if (inactive) {
            peerClips = peerTrack.alternatives.find((alternative) => alternative.id === 'alt-peer')!.clips;
        }
        expect(peerClips.find((clip) => clip.id === 'c')?.name).toBe('Peer Clip');
        const before = snapshotRetirementState();
        expect(before.root).toContain('Peer Clip');

        expect((await undo()).headConsumed).toBe(false);
        expect(snapshotRetirementState()).toEqual(before);

        if (inactive) {
            await executeAppAction(
                { type: 'switchTrackAlternative', payload: { trackId, alternativeId: 'alt-peer' } },
                peerOptions
            );
        }
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'c', ripple: false } }, peerOptions);
        const trackAfterRemoval = trackStore.value!.tracks.find((track) => track.id === trackId)!;
        expect(trackAfterRemoval.clips.some((clip) => clip.id === 'c')).toBe(false);
        expect(trackAfterRemoval.activeAlternativeId).toBe(activeId);
        const staleCopy = trackAfterRemoval.alternatives.find((alternative) => alternative.id === 'alt-peer');
        expect(staleCopy?.clips.find((clip) => clip.id === 'c')?.name).toBe(staleName);

        expect((await undo()).headConsumed).toBe(true);
        expect(trackStore.value!.tracks.find((track) => track.id === 'a')).toEqual(seededTracks[0]);
        expectClipDataPresent('c');
        expect(laneIds()).toEqual(seededLanes.map((lane) => lane.id));
        expect(takeLaneStore.value!.lanes).toEqual(expectedTakeLanes);

        await redo();
        expect(trackAAlternativeIds()).toEqual(['alt-1']);
        expectClipDataRetired('c');
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

    it('refuses an undo once a peer gave the track another take lane, writes nothing, and undoes once it is gone', async () => {
        await executeAppAction(
            { type: 'deleteTrackAlternative', payload: { trackId: 'a', alternativeId: 'alt-2' } },
            { source: 'manual' }
        );
        expect(takeIdsByLane()).toEqual([['takes-b', 'take-x']]);
        const peerTakeLane = takeLane('takes-peer', 'a', [take('take-peer', 'live', 0)]);
        takeLaneStore.set({ lanes: [...takeLaneStore.value!.lanes, peerTakeLane] });
        const tracksBeforeUndo = structuredClone(trackStore.value!.tracks);
        const lanesBeforeUndo = structuredClone(automationStore.value!.lanes);
        const takeLanesBeforeUndo = structuredClone(takeLaneStore.value!.lanes);

        const refused = await undo();
        expect(refused.headConsumed).toBe(false);
        expect(trackStore.value!.tracks).toEqual(tracksBeforeUndo);
        expect(automationStore.value!.lanes).toEqual(lanesBeforeUndo);
        expect(takeLaneStore.value!.lanes).toEqual(takeLanesBeforeUndo);
        expect(midiStore.value!.notesByClipId.c).toBeUndefined();

        await redo();
        expect(trackStore.value!.tracks).toEqual(tracksBeforeUndo);
        expect(takeLaneStore.value!.lanes).toEqual(takeLanesBeforeUndo);

        takeLaneStore.set({ lanes: takeLaneStore.value!.lanes.filter((lane) => lane.id !== 'takes-peer') });
        const accepted = await undo();
        expect(accepted.headConsumed).toBe(true);
        expectSeededState();

        await redo();
        expectClipDataRetired('c');
        expect(takeIdsByLane()).toEqual([['takes-b', 'take-x']]);
    });
});
