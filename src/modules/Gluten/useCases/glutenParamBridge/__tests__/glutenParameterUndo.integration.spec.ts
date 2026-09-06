import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
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

import { glutenStore } from '../../../stores/glutenStore';
import { setGlutenParamWithAudio } from '../setGlutenParamWithAudio';

/**
 * The load-bearing guard for device-parameter undo, stated as the user states
 * it: turn a Gluten knob, press undo, and the knob is where it was.
 *
 * The observable is `Device.parameterValues` in `trackStore` — project truth —
 * after `undo()` has actually run, not that a handler was called and not that
 * some entry appeared in a list. Everything below `setGlutenParamWithAudio` is
 * the real thing: the real Arrangement handler map, the real `executeAppAction`,
 * a real Automerge document, the real undo stack.
 *
 * Only `updateDeviceParam` is stubbed as the engineWrites recorder, because it
 * addresses a live AudioContext that does not exist under Vitest. Stubbing it is
 * also what lets the drag guard count engine writes and prove the transient half
 * still reaches audio. The other listed AudioEngine keys are unread graph-coverage
 * stubs (`vi.fn()` and `audioEngine: {}`), not live barrel exports.
 */

const engineWrites: { trackId: string; deviceId: string; paramId: string; value: number }[] = [];

vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    updateDeviceParam: (trackId: string, deviceId: string, paramId: string, value: number) => {
        engineWrites.push({ trackId, deviceId, paramId, value });
    },
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
    getLiveEngineSampleRate: vi.fn(),
    getRuntimeGraphRevision: vi.fn(),
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
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    wireSidechainRoute: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const DEVICE_ID = 'gluten-1';
const TRACK_ID = 'bus-1';

/**
 * Built here rather than imported from Arrangement's `TrackDummy`: a spec in
 * another module may only reach Arrangement through its contract barrels, and
 * `__tests__/` is not one (`deps:validate`, `cross-module-index-only`).
 */
function glutenBus(parameterValues: Record<string, number>): Track {
    return {
        id: TRACK_ID,
        name: 'Drum Bus',
        kind: 'bus',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [{ id: DEVICE_ID, name: 'Gluten', type: 'gluten', bypassed: false, parameterValues }],
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

function storedThreshold(): number | undefined {
    return trackStore.value?.tracks
        .find((track) => track.id === TRACK_ID)
        ?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues.threshold;
}

function undoDepth(): number {
    return undoStore.value?.past.length ?? 0;
}

async function flushRafBatch(): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

describe('Gluten parameter changes are undoable', () => {
    beforeEach(() => {
        engineWrites.length = 0;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('gluten parameter undo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        // Deliberately not the descriptor default of -18. A guard that starts at
        // the default cannot tell "restored the previous value" from "fell back
        // to the default".
        const bus = glutenBus({ threshold: -24, ratio: 4 });
        trackStore.set({ tracks: [bus], selectedTrackId: TRACK_ID, ghostClips: [] });
        glutenStore.set({});
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        glutenStore.set({});
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('restores the previous parameter value after undo', async () => {
        expect(storedThreshold()).toBe(-24);

        setGlutenParamWithAudio(DEVICE_ID, 'threshold', -9);
        await vi.waitFor(() => {
            expect(storedThreshold()).toBe(-9);
        });

        await undo();

        expect(storedThreshold()).toBe(-24);
    });

    it('spends exactly one undo entry on a drag, whatever it passes through on the way', async () => {
        const before = undoDepth();

        // A sweep from -24 to -9. Interior points, not just the endpoints: a
        // guard that only drives the last value cannot tell a coalesced gesture
        // from a reshaped one.
        for (const intermediate of [-22, -19.5, -17, -14.5, -12, -10.5]) {
            setGlutenParamWithAudio(DEVICE_ID, 'threshold', intermediate, true);
            await flushRafBatch();
        }

        // Every interior value reached the engine, so the compressor moved under
        // the user's thumb...
        expect(engineWrites.map((write) => write.value)).toEqual([-22, -19.5, -17, -14.5, -12, -10.5]);
        // ...and none of them reached project truth or the undo stack.
        expect(storedThreshold()).toBe(-24);
        expect(undoDepth()).toBe(before);

        setGlutenParamWithAudio(DEVICE_ID, 'threshold', -9);
        await vi.waitFor(() => {
            expect(storedThreshold()).toBe(-9);
        });

        expect(undoDepth()).toBe(before + 1);

        await undo();

        expect(storedThreshold()).toBe(-24);
        expect(undoDepth()).toBe(before);
    });

    it('gives two parameters two entries, so undo unwinds them one at a time', async () => {
        setGlutenParamWithAudio(DEVICE_ID, 'threshold', -9);
        await vi.waitFor(() => {
            expect(storedThreshold()).toBe(-9);
        });
        setGlutenParamWithAudio(DEVICE_ID, 'ratio', 8);
        await vi.waitFor(() => {
            expect(
                trackStore.value?.tracks
                    .find((track) => track.id === TRACK_ID)
                    ?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues.ratio
            ).toBe(8);
        });

        await undo();

        expect(
            trackStore.value?.tracks
                .find((track) => track.id === TRACK_ID)
                ?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues.ratio
        ).toBe(4);
        expect(storedThreshold()).toBe(-9);

        await undo();

        expect(storedThreshold()).toBe(-24);
    });

    it('clamps the committed value to the declared range before it reaches history', async () => {
        // `threshold` is declared -60..0 (GlutenDescriptor.ts:19). The commit
        // goes through `setDeviceParameter`, which is where the range is held.
        setGlutenParamWithAudio(DEVICE_ID, 'threshold', 42);
        await vi.waitFor(() => {
            expect(storedThreshold()).toBe(0);
        });

        await undo();

        expect(storedThreshold()).toBe(-24);
    });
});
