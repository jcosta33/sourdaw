import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type Device, type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import * as Command from '#/modules/Command/useCases';
import {
    clearUndoHistory,
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
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { tempoMapStore } from '../../../../stores/tempoMapStore';
import { defaultTransportState, transportStore } from '../../../../stores/transportStore';
import { applyAutomation } from '../applyAutomation';

// Command, Arrangement, Automerge and history stay real. This is the engine's
// shared Web Audio/native parameter boundary; no live graph exists in Vitest.
const engineWrites: { trackId: string; deviceId: string; paramId: string; value: number }[] = [];
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cancelPendingAudioBufferImport: vi.fn(),
    reconcileAutoInputMonitoring: vi.fn(),
    stopTrackInputMonitoring: vi.fn(),
    rearmCommittedTrackInputMonitoring: vi.fn(),

    startFaustNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    projectsToDifferentNativeBank: vi.fn(() => false),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    updateDeviceParam: (trackId: string, deviceId: string, paramId: string, value: number) => {
        engineWrites.push({ trackId, deviceId, paramId, value });
    },
    updateDevicePatch: vi.fn(),
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    ensureBusStrip: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    getAudioContext: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: () => 0,
    getCurrentTime: () => 5,
    holdWebFallbackDeviceParam: vi.fn(),
    scheduleSendAutomation: vi.fn(),
    scheduleTrackGain: vi.fn(),
    scheduleTrackPan: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getEngineState: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getRuntimeGraphRevision: vi.fn(),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
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
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    wireSidechainRoute: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: () => Promise.resolve(true),
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));

function testTrack(devices: Device[]): Track {
    return {
        id: 'track-1',
        name: 'Guitar',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ff88',
        clips: [],
        devices,
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

const synth: Device = {
    id: 'synth-1',
    name: 'Synth',
    type: 'builtin-synth',
    bypassed: false,
    parameterValues: { detune: 5 },
};
function values(deviceId = synth.id): Record<string, number> {
    const device = trackStore.value?.tracks[0]?.devices.find((candidate) => candidate.id === deviceId);
    if (!device) {
        throw new Error(`Missing fixture device ${deviceId}`);
    }
    return device.parameterValues;
}
function rawValues(deviceId = synth.id): Record<string, number> | undefined {
    return getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.devices.find(
        (device) => device.id === deviceId
    )?.parameterValues;
}
function depth(): number {
    return undoStore.value?.past.length ?? 0;
}
describe('device automation bypasses manual command history', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('automation exclusion');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        trackStore.set({ tracks: [testTrack([structuredClone(synth)])], selectedTrackId: 'track-1', ghostClips: [] });
        automationStore.set({
            lanes: [
                {
                    id: 'automated-detune',
                    trackId: 'track-1',
                    parameterId: 'synth-1:detune',
                    parameterName: 'Detune',
                    points: [
                        { beat: 0, value: 5, curve: 'linear', tension: 0 },
                        { beat: 4, value: 65, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    enabled: true,
                    visible: true,
                    collapsed: false,
                    minValue: -100,
                    maxValue: 100,
                },
            ],
        });
        transportStore.set({ ...defaultTransportState, isPlaying: true });
        tempoMapStore.set({ changes: [] });
        settlePendingProjectWritesAndCaptureRevision();
        engineWrites.length = 0;
    });
    afterEach(() => {
        vi.restoreAllMocks();
        clearUndoHistory();
        clearHandlerRegistry();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('drives the real automation producer without dispatch, device truth or history and keeps manual undo live', async () => {
        // Spies call through; Command, handler, storage and history are not mocked.
        const dispatch = vi.spyOn(Command, 'executeAppAction');
        const revision = settlePendingProjectWritesAndCaptureRevision();
        for (const beat of [0.5, 1, 1.5]) {
            applyAutomation(beat);
        }
        expect(engineWrites.length).toBeGreaterThanOrEqual(3);
        expect(engineWrites.every((write) => write.deviceId === synth.id && write.paramId === 'detune')).toBe(true);
        expect(new Set(engineWrites.map((write) => write.value)).size).toBeGreaterThan(1);
        expect(dispatch).not.toHaveBeenCalled();
        expect(values().detune).toBe(5);
        expect(rawValues()?.detune).toBe(5);
        expect(depth()).toBe(0);
        expect(macroStore.value?.currentRecording).toEqual([]);
        expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);

        await Command.executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: synth.id, paramId: 'detune', value: 65 },
        });
        expect(dispatch).toHaveBeenCalledOnce();
        expect(rawValues()?.detune).toBe(65);
        expect(depth()).toBe(1);
        await undo();
        expect(rawValues()?.detune).toBe(5);
        expect(engineWrites.at(-1)?.value).toBe(5);
    });
});
