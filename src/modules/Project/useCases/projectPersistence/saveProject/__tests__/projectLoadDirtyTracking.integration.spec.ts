/**
 * A project the user just opened must not present itself as having unsaved
 * changes (audit M-011).
 *
 * The wiring under test is the real one: `initProjectDirtyTracking` is the
 * subscription the composition root installs, `replaceProjectData` is the path
 * every open/import takes, and both the project store and the track store are
 * the real singletons. Only the audio graph, CRDT durability and transport
 * edges are stubbed, because they reach IndexedDB and an AudioContext.
 * Five AudioEngine bindings are live: `getAudioContext`, `importCachedAudioBuffers`,
 * `prepareCachedAudioBuffersFromIdb`, and `resetAudioGraph` through hoisted spies,
 * plus `clearRuntimeCachedAudioBuffers` as an inline `vi.fn()`. The other listed
 * AudioEngine keys are unread graph-coverage stubs (`vi.fn()` and `audioEngine: {}`).
 *
 * The defect is an ordering one: `replaceProjectData` hydrates the arrangement
 * and publishes `dirty: false` inside one `batchStoreUpdates`, but that helper
 * defers subscriber notification to the end of the batch — so the dirty
 * subscription runs *after* the clean metadata was already written, and the
 * user sees an unsaved-changes marker on a freshly opened project.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockGetAudioContext,
    mockImportCachedAudioBuffers,
    mockPrepareCachedAudioBuffersFromIdb,
    mockResetAudioGraph,
    mockClearUndoHistory,
    mockCompactProject,
    mockProjectActionHistoryToStore,
    mockResetCrdtProjectAuthority,
    mockStartCrdtAutoSave,
    mockUnloadLoadedExternalPlugins,
    mockEnsureTrackStrips,
    mockStopPlayback,
    mockNotifyUser,
    mockStopActiveAutoSave,
    mockSetAutoSaveHandle,
} = vi.hoisted(() => ({
    mockGetAudioContext: vi.fn(() => ({ sampleRate: 44_100 })),
    mockImportCachedAudioBuffers: vi.fn(() => Promise.resolve({ publish: vi.fn() })),
    mockPrepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ cancel: vi.fn(), publish: vi.fn() })),
    mockResetAudioGraph: vi.fn(),
    mockClearUndoHistory: vi.fn(),
    mockCompactProject: vi.fn(() => Promise.resolve()),
    mockProjectActionHistoryToStore: vi.fn(),
    mockResetCrdtProjectAuthority: vi.fn(),
    mockStartCrdtAutoSave: vi.fn(() => () => {}),
    mockUnloadLoadedExternalPlugins: vi.fn(() => Promise.resolve()),
    mockEnsureTrackStrips: vi.fn(),
    mockStopPlayback: vi.fn(() => Promise.resolve()),
    mockNotifyUser: vi.fn(),
    mockStopActiveAutoSave: vi.fn(),
    mockSetAutoSaveHandle: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    clearRuntimeCachedAudioBuffers: vi.fn(),
    getAudioContext: mockGetAudioContext,
    importCachedAudioBuffers: mockImportCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb: mockPrepareCachedAudioBuffersFromIdb,
    resetAudioGraph: mockResetAudioGraph,
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    cancelPendingAudioBufferImport: vi.fn(),
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    ensureBusStrip: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
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
    setMasterGainValue: vi.fn(),
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
    updateDeviceParam: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    wireSidechainRoute: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    clearUndoHistory: mockClearUndoHistory,
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: vi.fn(),
    compactProject: mockCompactProject,
    createCrdtDoc: vi.fn(),
    DOC_BRANCHES: '__branches__',
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn(),
    hasCrdtDoc: vi.fn(),
    mutateCrdtDoc: vi.fn(),
    persistCrdtProject: vi.fn(),
    preserveBranchStateForSession: vi.fn(),
    projectActionHistoryToStore: mockProjectActionHistoryToStore,
    removeCrdtDoc: vi.fn(),
    replaceBranchState: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    replaceCrdtDocInLineage: vi.fn(),
    resetCrdtProjectAuthority: mockResetCrdtProjectAuthority,
    restoreBranchStateAfterSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    startCrdtAutoSave: mockStartCrdtAutoSave,
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    unloadPlugin: mockUnloadLoadedExternalPlugins,
    activateExternalPlugin: vi.fn(),
    findSupportedPlugin: vi.fn(),
    registerFaustDSP: vi.fn(),
}));
vi.mock('#/modules/Transport/useCases', () => ({
    defaultTransportState: { masterGain: 75, isPlaying: false },
    ensureTrackStrips: mockEnsureTrackStrips,
    stopPlayback: mockStopPlayback,
    restoreTimelineMapSnapshot: vi.fn(),
    restoreTransportSnapshot: vi.fn(),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mockNotifyUser }));
vi.mock('../../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: mockSetAutoSaveHandle }));
vi.mock('../../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: mockStopActiveAutoSave }));

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { replaceProjectData } from '../../helpers/replaceProjectData';
import { initProjectDirtyTracking } from '../initProjectDirtyTracking';

import type { HydratableProjectData } from '../../helpers/isHydratableProjectData';

const LOADED_TRACK_ID = 'track-from-disk';
const LOADED_TRACK_NAME = 'Vocals (from disk)';

function loadedProjectData(): HydratableProjectData {
    return {
        version: 1,
        meta: {
            name: 'Opened From Disk',
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_100_000,
            keyRoot: 5,
            scaleName: 'minor',
            tuning: { name: 'Equal Temperament', frequencies: [440] },
        },
        arrangement: {
            tracks: [
                {
                    id: LOADED_TRACK_ID,
                    name: LOADED_TRACK_NAME,
                    kind: 'audio',
                    clips: [],
                },
            ],
        },
    };
}

function alwaysCurrentTransaction() {
    return {
        prepare: () => Promise.resolve(true),
        activate: () => true,
        canActivate: () => true,
        isCurrent: () => true,
        complete: () => {},
        abandon: () => {},
    } as unknown as Parameters<typeof replaceProjectData>[0]['transaction'];
}

describe('project load dirty tracking (audit M-011)', () => {
    let stopDirtyTracking: () => void = () => {};

    beforeEach(() => {
        vi.clearAllMocks();
        stopDirtyTracking();
        trackStore.set(structuredClone(defaultTrackState));
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            name: 'Previous Project',
            createdAt: 1,
            updatedAt: 2,
            dirty: false,
            loading: false,
            keyRoot: 0,
            scaleName: 'chromatic',
            tuning: { name: 'Equal Temperament', frequencies: [440] },
            initialized: true,
        });
        stopDirtyTracking = initProjectDirtyTracking();
    });

    it('leaves a freshly opened project clean, with the opened arrangement in place', async () => {
        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: loadedProjectData(),
            transaction: alwaysCurrentTransaction(),
        });

        expect(result.status).toBe('committed');
        // The load really happened — otherwise "clean" would be vacuous.
        expect(trackStore.value?.tracks.map((track) => track.name)).toContain(LOADED_TRACK_NAME);
        expect(projectStore.value?.name).toBe('Opened From Disk');
        expect(projectStore.value?.dirty).toBe(false);
    });

    it('still marks the project dirty when the user edits it after the load settles', async () => {
        await replaceProjectData({
            context: 'loadRecentProject',
            data: loadedProjectData(),
            transaction: alwaysCurrentTransaction(),
        });
        expect(projectStore.value?.dirty).toBe(false);

        const current = trackStore.value ?? defaultTrackState;
        trackStore.set({
            ...current,
            tracks: current.tracks.map((track) =>
                track.id === LOADED_TRACK_ID ? { ...track, name: 'Vocals (renamed by user)' } : track
            ),
        });

        expect(projectStore.value?.dirty).toBe(true);
    });
});
