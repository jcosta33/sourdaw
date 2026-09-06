import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, getPluginById } from '#/modules/Arrangement/useCases';
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

import {
    CRUMBS_PARAM_TARGETS,
    CRUMBS_PERSISTED_PARAM_IDS,
    type CrumbsPersistedParamId,
} from '../../models/CrumbsParameterMap';
import { crumbsStore, defaultCrumbsState, type CrumbsState } from '../../stores/crumbsStore';
import { hydrateCrumbsStateFromProject } from '../hydrateCrumbsStateFromProject';
import { setCrumbsParamWithAudio } from '../setCrumbsParamWithAudio';

/**
 * The load-bearing guards for Crumbs knob persistence, stated as the user states
 * them: move a knob, reload the project, and the knob is where you left it — and a
 * drag is one undo entry, not ninety.
 *
 * The observable is the value a *reload* produces, not that a setter was called.
 * `hydrateCrumbsStateFromProject` is the function the panel and the engine build
 * both go through on a fresh open, so driving it after wiping the session store is
 * the same read the user's reload performs.
 *
 * Everything below `setCrumbsParamWithAudio` is real: the real Arrangement handler
 * map, the real `executeAppAction`, a real Automerge document, the real undo stack.
 * Only `updateDeviceParam` is stubbed as the engineWrites recorder, because it
 * addresses a live AudioContext that does not exist under Vitest — which is also
 * what lets the drag guard count engine writes and prove the transient half still
 * reaches audio. The other listed AudioEngine keys are unread graph-coverage stubs
 * (`vi.fn()` and `audioEngine: {}`), not live barrel exports.
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

const DEVICE_ID = 'crumbs-1';
const TRACK_ID = 'track-1';

/**
 * A distinct, in-range, non-default value per declared parameter.
 *
 * Three different value sets are in play deliberately — the module default, the
 * value the fixture is *constructed* with, and the value the test *sets*. A guard
 * that sets a parameter to the default cannot tell persistence from a fallback, and
 * one that sets it to the fixture's construction value cannot tell a write that
 * landed from one that never happened.
 */
const COMMITTED: Readonly<Record<CrumbsPersistedParamId, number>> = {
    masterGain: 1.35,
    attack: 0.42,
    hold: 0.77,
    decay: 3.5,
    sustain: 0.36,
    release: 6.25,
    filterCutoff: 640,
    filterResonance: 7.5,
    tune: -9.5,
    pan: 0.62,
    // Voice stack: interior values, so a clamp at either declared end cannot
    // agree with them for the wrong reason. `stackCount` is the one `int` here
    // and 5 is a whole voice count, so the round-trip asserts persistence rather
    // than rounding.
    stackCount: 5,
    detuneSpread: 42.5,
    stackSpread: 0.65,
};

/** What the fixture starts at: not the default, and not what the test writes. */
const CONSTRUCTED: Readonly<Record<CrumbsPersistedParamId, number>> = {
    masterGain: 0.25,
    attack: 1.1,
    hold: 1.4,
    decay: 4.2,
    sustain: 0.81,
    release: 2.5,
    filterCutoff: 3300,
    filterResonance: 14.25,
    tune: 6.5,
    pan: -0.4,
    stackCount: 3,
    detuneSpread: 18.5,
    stackSpread: 0.3,
};

/**
 * Built here rather than imported from Arrangement's `TrackDummy`: a spec in another
 * module may only reach Arrangement through its contract barrels, and `__tests__/`
 * is not one (`deps:validate`, `cross-module-index-only`).
 */
function crumbsTrack(parameterValues: Record<string, number>): Track {
    return {
        id: TRACK_ID,
        name: 'Sampler',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ff00',
        clips: [],
        devices: [{ id: DEVICE_ID, name: 'Crumbs', type: 'builtin-crumbs', bypassed: false, parameterValues }],
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

function stored(paramId: string): number | undefined {
    return trackStore.value?.tracks
        .find((track) => track.id === TRACK_ID)
        ?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues[paramId];
}

/** Read a parameter out of a session state through the same target table the code uses. */
function readParam(state: CrumbsState, paramId: CrumbsPersistedParamId): number {
    const target = CRUMBS_PARAM_TARGETS[paramId];
    if (target.kind === 'envelope') {
        return state.envelope[target.key];
    }
    if (target.kind === 'voiceStack') {
        return state.voiceStack[target.key];
    }
    return state[target.key];
}

function undoDepth(): number {
    return undoStore.value?.past.length ?? 0;
}

async function flushRafBatch(): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

/** Wipe the session store the way a project load does, leaving only project truth. */
function simulateReload(): CrumbsState | null {
    crumbsStore.set({});
    return hydrateCrumbsStateFromProject(DEVICE_ID);
}

describe('Crumbs knob values survive a reload', () => {
    beforeEach(() => {
        engineWrites.length = 0;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('crumbs parameter persistence');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        trackStore.set({
            tracks: [crumbsTrack({ ...CONSTRUCTED })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        crumbsStore.set({ [DEVICE_ID]: { ...defaultCrumbsState } });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        crumbsStore.set({});
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('persists and restores every parameter the registry declares', async () => {
        // The population is read from the descriptor, not from a list maintained
        // here: a parameter added to `CRUMBS_DESCRIPTOR` and forgotten everywhere
        // else fails this test rather than shipping unpersisted.
        const declared = getPluginById('builtin-crumbs')?.parameters ?? [];
        expect(declared.length).toBeGreaterThan(0);

        for (const parameter of declared) {
            const paramId = parameter.id;
            expect(CRUMBS_PERSISTED_PARAM_IDS).toContain(paramId);
            const value = COMMITTED[paramId as CrumbsPersistedParamId];
            // Every declared parameter must have a committed test value that is
            // inside its declared range — otherwise the clamp would rewrite it and
            // the round-trip below would be asserting the clamp, not persistence.
            expect(value).toBeGreaterThanOrEqual(parameter.minValue);
            expect(value).toBeLessThanOrEqual(parameter.maxValue);

            setCrumbsParamWithAudio(DEVICE_ID, paramId as CrumbsPersistedParamId, value);
            await vi.waitFor(() => {
                expect(stored(paramId)).toBe(value);
            });
        }

        const reloaded = simulateReload();
        expect(reloaded).not.toBeNull();

        for (const parameter of declared) {
            const paramId = parameter.id as CrumbsPersistedParamId;
            expect(readParam(reloaded!, paramId)).toBe(COMMITTED[paramId]);
            // Not the default, and not what the fixture was built with — so a
            // fallback or a no-op write cannot pass this.
            expect(readParam(reloaded!, paramId)).not.toBe(readParam(defaultCrumbsState, paramId));
            expect(readParam(reloaded!, paramId)).not.toBe(CONSTRUCTED[paramId]);
        }
    });

    it('restores knob values on reload even when the device has no sample chunk', () => {
        // `fromCrumbsDeviceState` returns null for a device that was never given a
        // sample. Hydration used to return null with it, so a sampler whose knobs
        // were set but whose sample was not yet loaded came back on the defaults.
        trackStore.set({
            tracks: [crumbsTrack({ filterCutoff: 512, masterGain: 1.75 })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });

        const reloaded = simulateReload();

        expect(reloaded).not.toBeNull();
        expect(reloaded!.filterCutoff).toBe(512);
        expect(reloaded!.masterGain).toBe(1.75);
        // Untouched parameters keep the module default rather than being zeroed.
        expect(reloaded!.envelope.decay).toBe(defaultCrumbsState.envelope.decay);
    });

    it('reports no stored state for a device project truth holds nothing for', () => {
        trackStore.set({ tracks: [crumbsTrack({})], selectedTrackId: TRACK_ID, ghostClips: [] });

        expect(simulateReload()).toBeNull();
    });

    it('spends exactly one undo entry on a drag, whatever it passes through on the way', async () => {
        const before = undoDepth();

        // A cutoff sweep. Interior points, not just the endpoints: a guard that
        // only drives the last value cannot tell a coalesced gesture from a
        // reshaped one.
        const sweep = [2900, 2350, 1800, 1300, 900, 700];
        for (const intermediate of sweep) {
            setCrumbsParamWithAudio(DEVICE_ID, 'filterCutoff', intermediate, true);
            await flushRafBatch();
        }

        // Every interior value reached the engine, so the filter moved under the
        // user's thumb...
        expect(engineWrites.filter((write) => write.paramId === 'filterCutoff').map((write) => write.value)).toEqual(
            sweep
        );
        // ...and none of them reached project truth or the undo stack.
        expect(stored('filterCutoff')).toBe(CONSTRUCTED.filterCutoff);
        expect(undoDepth()).toBe(before);

        setCrumbsParamWithAudio(DEVICE_ID, 'filterCutoff', 640);
        await vi.waitFor(() => {
            expect(stored('filterCutoff')).toBe(640);
        });

        expect(undoDepth()).toBe(before + 1);

        await undo();

        expect(stored('filterCutoff')).toBe(CONSTRUCTED.filterCutoff);
        expect(undoDepth()).toBe(before);
    });

    it('moves the session store on every transient step so the knob tracks the pointer', async () => {
        const sweep = [0.2, 0.45, 0.7];
        const seen: number[] = [];
        for (const intermediate of sweep) {
            setCrumbsParamWithAudio(DEVICE_ID, 'sustain', intermediate, true);
            seen.push(crumbsStore.value?.[DEVICE_ID]?.envelope.sustain ?? Number.NaN);
            await flushRafBatch();
        }

        expect(seen).toEqual(sweep);
        // Still nothing in project truth — the preview is the store and the engine.
        expect(stored('sustain')).toBe(CONSTRUCTED.sustain);
    });

    it('gives two parameters two entries, so undo unwinds them one at a time', async () => {
        setCrumbsParamWithAudio(DEVICE_ID, 'tune', -9.5);
        await vi.waitFor(() => {
            expect(stored('tune')).toBe(-9.5);
        });
        setCrumbsParamWithAudio(DEVICE_ID, 'pan', 0.62);
        await vi.waitFor(() => {
            expect(stored('pan')).toBe(0.62);
        });

        await undo();

        expect(stored('pan')).toBe(CONSTRUCTED.pan);
        expect(stored('tune')).toBe(-9.5);

        await undo();

        expect(stored('tune')).toBe(CONSTRUCTED.tune);
    });

    it('clamps the committed value to the declared range before it reaches history', async () => {
        // `tune` is declared -24..24 (`CrumbsDescriptor.ts`). The commit goes
        // through `setDeviceParameter`, which is where the range is held.
        setCrumbsParamWithAudio(DEVICE_ID, 'tune', 400);
        await vi.waitFor(() => {
            expect(stored('tune')).toBe(24);
        });

        await undo();

        expect(stored('tune')).toBe(CONSTRUCTED.tune);
    });

    it('accepts the full travel of the knobs whose declared ceiling was raised', async () => {
        // Gain, Decay and Release declared ceilings below the travel their knobs
        // have always offered (1 vs 2, 2 s vs 5 s, 5 s vs 10 s). Nothing clamped
        // against the declaration before, so the mismatch was invisible; routing
        // the commit through `setDeviceParameter` would have truncated each knob
        // mid-sweep.
        for (const [paramId, top] of [
            ['masterGain', 2],
            ['decay', 5],
            ['release', 10],
        ] as const) {
            setCrumbsParamWithAudio(DEVICE_ID, paramId, top);
            await vi.waitFor(() => {
                expect(stored(paramId)).toBe(top);
            });
        }
    });
});
