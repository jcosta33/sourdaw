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

function midiClip(id: string, trackId: string) {
    return ClipDummy.create({ id, trackId, startBeat: 0, endBeat: 4, type: 'midi' });
}

// Track A after moving clip `x` to B: A's active alternative's stored copy is
// refreshed only by a switch or a create, so it still names `x`.
function trackA() {
    const held = midiClip('held', 'a');
    return TrackDummy.create({
        id: 'a',
        name: 'A',
        kind: 'midi',
        clips: [held],
        activeAlternativeId: 'alt-1',
        alternatives: [
            { id: 'alt-1', name: 'Alternative 1', clips: [held, midiClip('x', 'a')] },
            { id: 'alt-2', name: 'Alternative 2', clips: [midiClip('inactive', 'a')] },
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
        notes: [{ id: `note-${clipId}`, pitch, startBeat: 0, duration: 1, velocity: 100 }],
        cc: [{ id: `cc-${clipId}`, controller: 1, value: pitch, beat: 0, channel: 0 }],
        bend: [{ id: `bend-${clipId}`, value: pitch, beat: 0, channel: 0 }],
    };
}

let seededTracks: ReturnType<typeof trackA>[] = [];

const midiByClip = { held: clipMidi('held', 60), inactive: clipMidi('inactive', 62), x: clipMidi('x', 64) };

function gainEnvelope(clipId: string) {
    return { clipId, points: [{ id: `${clipId}-g1`, beatOffset: 0, gainDb: -6 }], enabled: true };
}

function seedMidi(): void {
    midiStore.set({
        probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
        notesByClipId: {
            held: midiByClip.held.notes,
            inactive: midiByClip.inactive.notes,
            x: midiByClip.x.notes,
        },
        ccByClipId: { held: midiByClip.held.cc, inactive: midiByClip.inactive.cc, x: midiByClip.x.cc },
        pitchBendByClipId: {
            held: midiByClip.held.bend,
            inactive: midiByClip.inactive.bend,
            x: midiByClip.x.bend,
        },
    });
}

function expectMovedClipIntact(): void {
    const midi = midiStore.value!;
    expect(midi.notesByClipId.x).toEqual(midiByClip.x.notes);
    expect(midi.ccByClipId.x).toEqual(midiByClip.x.cc);
    expect(midi.pitchBendByClipId.x).toEqual(midiByClip.x.bend);
    expect(getEnvelope('x')).toEqual(gainEnvelope('x'));
    expect(automationStore.value!.lanes.filter((lane) => lane.clipId === 'x')).toEqual([
        clipScopedLane('lane-x', 'b', 'x'),
    ]);
    expect(trackStore.value!.tracks.find((track) => track.id === 'b')).toEqual(seededTracks[1]);
}

function expectARemoved(): void {
    const midi = midiStore.value!;
    expect(trackStore.value!.tracks.map((track) => track.id)).toEqual(['b']);
    for (const clipId of ['held', 'inactive']) {
        expect(midi.notesByClipId[clipId]).toBeUndefined();
        expect(midi.ccByClipId[clipId]).toBeUndefined();
        expect(midi.pitchBendByClipId[clipId]).toBeUndefined();
    }
    expect(getEnvelope('held')).toBeUndefined();
}

function expectARestored(): void {
    const midi = midiStore.value!;
    expect(trackStore.value!.tracks).toEqual(seededTracks);
    for (const clipId of ['held', 'inactive'] as const) {
        expect(midi.notesByClipId[clipId]).toEqual(midiByClip[clipId].notes);
        expect(midi.ccByClipId[clipId]).toEqual(midiByClip[clipId].cc);
        expect(midi.pitchBendByClipId[clipId]).toEqual(midiByClip[clipId].bend);
    }
    expect(getEnvelope('held')).toEqual(gainEnvelope('held'));
}

describe('removeTrack beside a clip its stale active alternative copy names (#6613)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('remove track held clips integration');
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
        trackStore.set({ tracks: [trackA(), trackB()], selectedTrackId: null, ghostClips: [] });
        // The rows as the store projects them, so a restore is compared against
        // what the store held rather than the fixture's unnormalized shape.
        seededTracks = structuredClone(trackStore.value!.tracks);
        automationStore.set({ lanes: [clipScopedLane('lane-x', 'b', 'x')] });
        seedMidi();
        setEnvelope('held', gainEnvelope('held'));
        setEnvelope('x', gainEnvelope('x'));
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

    it("never touches the survivor's moved clip through remove, undo, redo and undo, and restores A exactly", async () => {
        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } }, { source: 'manual' });
        expectARemoved();
        expectMovedClipIntact();

        await undo();
        expectARestored();
        expectMovedClipIntact();

        await redo();
        expectARemoved();
        expectMovedClipIntact();

        await undo();
        expectARestored();
        expectMovedClipIntact();
        expect(notifyUserMock).not.toHaveBeenCalled();
    });
});
