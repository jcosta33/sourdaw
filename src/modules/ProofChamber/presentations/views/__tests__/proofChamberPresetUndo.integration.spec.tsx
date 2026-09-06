import { render, fireEvent, screen } from '@testing-library/react';
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

import { ProofChamberPanel } from '../ProofChamberPanel';

/**
 * Loading a space preset is one history step.
 *
 * `selectSpace` expands a space into every field of the engine state and used to
 * dispatch one bare `executeAppAction` per field, so a single click on a space
 * tile left ~20 independent undo entries behind it. The observable here is what
 * a user sees: click a space, press undo **once**, and every parameter the
 * preset moved is back where it was — not one of them.
 *
 * Everything under the click is real: the Arrangement handler map, the real
 * `executeAppActionBatch`, a real Automerge document, the real undo stack.
 * `useStore` and the chamber engine writes are stubbed because they address a
 * live AudioContext and a store this assertion does not read.
 */

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));
// Preset undo assertions read Arrangement store truth, not live engine writes.
// `updateDeviceParam` is the wired stub; every other AudioEngine key in this
// factory is an unread graph-coverage stub (`vi.fn()` and `audioEngine: {}`).
vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    updateDeviceParam: vi.fn(),
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    decodeAudioFileBuffer: vi.fn(),
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
vi.mock('../../../stores/chamberStore', () => ({
    chamberStore: { name: 'chamberStore' },
}));
vi.mock('../../../useCases/proofChamber/registerChamberInstance', () => ({
    registerChamberInstance: vi.fn(),
}));
vi.mock('../../../useCases/proofChamber/updateChamberEngine', () => ({
    updateChamberEngine: vi.fn(),
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const DEVICE_ID = 'dutch-oven-1';
const TRACK_ID = 'reverb-bus';

/**
 * Seeded away from both the descriptor defaults and the `cathedral` preset's
 * values, so "restored" cannot be confused with "fell back to a default" and
 * cannot be satisfied by the preset happening to write the same number.
 * `cathedral` is `{ size: 1.0, decay: 0.85, damping: 0.2, diffusion: 0.9,
 * modDepth: 0.4, predelay: 40 }` (ProofChamberState.ts:92).
 */
const SEEDED: Record<string, number> = {
    size: 0.31,
    decay: 0.42,
    damping: 0.53,
    diffusion: 0.64,
    predelay: 7,
};

/**
 * Built here rather than imported from Arrangement's `TrackDummy`: a spec in
 * another module may only reach Arrangement through its contract barrels, and
 * `__tests__/` is not one (`deps:validate`, `cross-module-index-only`).
 */
function reverbBus(parameterValues: Record<string, number>): Track {
    return {
        id: TRACK_ID,
        name: 'Reverb Bus',
        kind: 'bus',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [{ id: DEVICE_ID, name: 'Dutch Oven', type: 'dutch-oven', bypassed: false, parameterValues }],
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

function storedParams(): Record<string, number> {
    return (
        trackStore.value?.tracks
            .find((track) => track.id === TRACK_ID)
            ?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues ?? {}
    );
}

function seededReadout(): Record<string, number | undefined> {
    const params = storedParams();
    return Object.fromEntries(Object.keys(SEEDED).map((key) => [key, params[key]]));
}

describe('loading a ProofChamber space preset', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('proof chamber preset undo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        trackStore.set({ tracks: [reverbBus({ ...SEEDED })], selectedTrackId: TRACK_ID, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('moves every seeded parameter and takes one undo to put them all back', async () => {
        expect(seededReadout()).toEqual(SEEDED);

        render(<ProofChamberPanel deviceId={DEVICE_ID} />);
        fireEvent.click(screen.getAllByText('Cathedral')[0]!);

        await vi.waitFor(() => {
            expect(storedParams().size).toBe(1);
        });
        // Interior fields, not just the one waited on — a preset that only
        // landed its first action would pass a single-field assertion.
        expect(seededReadout()).toEqual({
            size: 1,
            decay: 0.85,
            damping: 0.2,
            diffusion: 0.9,
            predelay: 40,
        });

        await undo();

        expect(seededReadout()).toEqual(SEEDED);
    });

    it('leaves the preset as one group in history, not one entry per parameter', async () => {
        render(<ProofChamberPanel deviceId={DEVICE_ID} />);
        fireEvent.click(screen.getAllByText('Cathedral')[0]!);

        await vi.waitFor(() => {
            expect(storedParams().size).toBe(1);
        });

        const depthAfterPreset = undoStore.value?.past.length ?? 0;
        expect(depthAfterPreset).toBeGreaterThan(1);

        // One undo consumes the whole preset, not one parameter of it. Asserting
        // the depth returns to zero is what distinguishes a group from a run of
        // independent entries — the value assertions in the test above would
        // also pass if `undo` happened to unwind them one at a time.
        await undo();
        expect(undoStore.value?.past.length).toBe(0);
    });

    it('unfreezes an already frozen tank when Infinite is selected', async () => {
        trackStore.set({
            tracks: [reverbBus({ ...SEEDED, freeze: 1 })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });

        render(<ProofChamberPanel deviceId={DEVICE_ID} />);
        fireEvent.click(screen.getAllByText('Infinite')[0]!);

        await vi.waitFor(() => {
            expect(storedParams().freeze).toBe(0);
        });
    });
});
