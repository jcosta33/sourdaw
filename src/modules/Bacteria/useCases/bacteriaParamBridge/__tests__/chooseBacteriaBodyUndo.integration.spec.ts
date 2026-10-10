import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
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
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { orderDeviceParametersForReplay } from '#/utils/devicePatchPrecedence';

import { bacteriaStore, getBacteriaState } from '../../../stores/bacteriaStore';
import { hydrateBacteriaPatchFromProject } from '../../hydrateBacteriaPatchFromProject';
import { chooseBacteriaBodyWithAudio } from '../chooseBacteriaBodyWithAudio';

/**
 * Choosing a Bacteria body, stated as the musician meets it: pick a body, hear
 * it, press undo and hear the band as it was, reopen the project and find the
 * body still chosen.
 *
 * Everything below `chooseBacteriaBodyWithAudio` is the real thing: the real
 * Arrangement handler map, the real `executeAppAction`, a real Automerge
 * document and the real undo stack. Only `updateDeviceParam` is recorded rather
 * than run, because it addresses a live engine that does not exist under
 * Vitest; it is the one door both the web worklet and the native engine take a
 * live write through. The other listed AudioEngine keys are unread
 * graph-coverage stubs.
 */

const engineWrites: { trackId: string; deviceId: string; paramId: string; value: number }[] = [];

vi.mock('#/modules/AudioEngine/useCases', () => ({
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
    getCompensationDelay: vi.fn(),
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

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const DEVICE_ID = 'bacteria-1';
const TRACK_ID = 'audio-1';
const BODY_PARAM = 'band0_convolutionIr';

/**
 * Built here rather than imported from Arrangement's `TrackDummy`: a spec in
 * another module may only reach Arrangement through its contract barrels.
 */
function bacteriaTrack(parameterValues: Record<string, number>): Track {
    return {
        id: TRACK_ID,
        name: 'Guitar',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ff88',
        clips: [],
        devices: [{ id: DEVICE_ID, name: 'Bacteria', type: 'bacteria', bypassed: false, parameterValues }],
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

function storedParameterValues(): Record<string, number> {
    return (
        trackStore.value?.tracks
            .find((track) => track.id === TRACK_ID)
            ?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues ?? {}
    );
}

function bodyWrites(): number[] {
    return engineWrites.filter((write) => write.paramId === BODY_PARAM).map((write) => write.value);
}

function undoDepth(): number {
    return undoStore.value?.past.length ?? 0;
}

describe('choosing a Bacteria body', () => {
    beforeEach(() => {
        engineWrites.length = 0;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('bacteria body choice');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        // A device saved before bodies could be chosen: its band has never
        // held a body value at all.
        trackStore.set({
            tracks: [bacteriaTrack({ band0_convolutionEnabled: 1 })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        bacteriaStore.set({});
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        bacteriaStore.set({});
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('stores the body, sends it to the engine, and shows it in the panel', async () => {
        chooseBacteriaBodyWithAudio(DEVICE_ID, 0, 'metal');

        await vi.waitFor(() => {
            expect(storedParameterValues()[BODY_PARAM]).toBe(2);
        });
        expect(bodyWrites()).toEqual([2]);
        expect(getBacteriaState(DEVICE_ID).patch.bands[0]?.convolutionIr).toBe('metal');
    });

    // The band's first body is the case with no stored value to return to;
    // undo has to put the band back to no body, in the document and in the
    // engine, rather than leave the body sounding or record no undo at all —
    // and the document goes back to holding no body value, as it did before.
    it('undoes a band’s first body back to no body in one step, and redoes it', async () => {
        const before = undoDepth();
        chooseBacteriaBodyWithAudio(DEVICE_ID, 0, 'wood');
        await vi.waitFor(() => {
            expect(storedParameterValues()[BODY_PARAM]).toBe(1);
        });
        expect(undoDepth()).toBe(before + 1);

        await undo();

        expect(storedParameterValues()).toEqual({ band0_convolutionEnabled: 1 });
        expect(undoDepth()).toBe(before);
        expect(bodyWrites()).toEqual([1, -1]);
        hydrateBacteriaPatchFromProject(DEVICE_ID);
        expect(getBacteriaState(DEVICE_ID).patch.bands[0]?.convolutionIr).toBe('');

        await redo();

        expect(storedParameterValues()[BODY_PARAM]).toBe(1);
        expect(bodyWrites()).toEqual([1, -1, 1]);
        hydrateBacteriaPatchFromProject(DEVICE_ID);
        expect(getBacteriaState(DEVICE_ID).patch.bands[0]?.convolutionIr).toBe('wood');
    });

    // None on a band that has never had a body is no change: the project
    // stays as it was and there is nothing to undo.
    it('leaves the project untouched when None is chosen on a band that never had a body', async () => {
        const before = undoDepth();
        const revisionBefore = settlePendingProjectWritesAndCaptureRevision();

        chooseBacteriaBodyWithAudio(DEVICE_ID, 0, '');

        expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revisionBefore);
        expect(storedParameterValues()).toEqual({ band0_convolutionEnabled: 1 });
        expect(bodyWrites()).toEqual([]);

        // A later pick is the only undo step: one undo returns the band to
        // holding no body value at all.
        chooseBacteriaBodyWithAudio(DEVICE_ID, 0, 'metal');
        await vi.waitFor(() => {
            expect(storedParameterValues()[BODY_PARAM]).toBe(2);
        });
        expect(undoDepth()).toBe(before + 1);

        await undo();

        expect(storedParameterValues()).toEqual({ band0_convolutionEnabled: 1 });
        expect(undoDepth()).toBe(before);
        expect(bodyWrites()).toEqual([2, -1]);
    });

    it('undoes a body change back to the body chosen before it, then to no body', async () => {
        const before = undoDepth();
        chooseBacteriaBodyWithAudio(DEVICE_ID, 0, 'ceramic');
        await vi.waitFor(() => {
            expect(storedParameterValues()[BODY_PARAM]).toBe(0);
        });
        chooseBacteriaBodyWithAudio(DEVICE_ID, 0, 'spring');
        await vi.waitFor(() => {
            expect(storedParameterValues()[BODY_PARAM]).toBe(3);
        });
        expect(undoDepth()).toBe(before + 2);

        await undo();

        expect(storedParameterValues()[BODY_PARAM]).toBe(0);
        expect(bodyWrites().at(-1)).toBe(0);

        await undo();

        expect(storedParameterValues()).toEqual({ band0_convolutionEnabled: 1 });
        expect(undoDepth()).toBe(before);
        expect(bodyWrites()).toEqual([0, 3, 0, -1]);
        hydrateBacteriaPatchFromProject(DEVICE_ID);
        expect(getBacteriaState(DEVICE_ID).patch.bands[0]?.convolutionIr).toBe('');
    });

    // A reopened project starts with an empty session store; the panel shows
    // what the document holds, and every engine build — the live strip, a
    // graph rebuild and the Web Audio export — replays `parameterValues`
    // through `orderDeviceParametersForReplay`, so the stored body reaches it.
    it('survives a reopen: the panel and the engine replay both read the stored body', async () => {
        chooseBacteriaBodyWithAudio(DEVICE_ID, 0, 'metal');
        await vi.waitFor(() => {
            expect(storedParameterValues()[BODY_PARAM]).toBe(2);
        });

        bacteriaStore.set({});
        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(getBacteriaState(DEVICE_ID).patch.bands[0]?.convolutionIr).toBe('metal');
        expect(orderDeviceParametersForReplay('bacteria', storedParameterValues())).toContainEqual([BODY_PARAM, 2]);
    });
});
