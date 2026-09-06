/**
 * The cold-start half of audit M-011: restoring the persisted project at app
 * start must not present it as having unsaved changes.
 *
 * Same mechanism as `saveProject/__tests__/projectLoadDirtyTracking.integration.spec.ts`,
 * different call site. `loadProject` hydrates the stores inside one
 * `batchStoreUpdates` and cleared `loading` inside that same batch, so the
 * composition root's dirty subscription — which only runs when the batch
 * flushes — saw a project that was no longer loading and marked it dirty.
 *
 * The project store, the track store, `batchStoreUpdates` and the dirty
 * subscription are all real. `projectCrdtToStores` stands in for CRDT
 * hydration (it reaches IndexedDB) by writing the track store, which is what
 * the real one does; the ordering under test is `loadProject`'s own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(() => Promise.resolve()),
    getCrdtDoc: vi.fn((): { chordTrack?: unknown; tracks: { tracks: never[] } } => ({
        chordTrack: undefined,
        tracks: { tracks: [] },
    })),
    loadCrdtProject: vi.fn(() => Promise.resolve(true)),
    persistCrdtProject: vi.fn(() => Promise.resolve()),
    projectCrdtToStores: vi.fn(),
    createCrdtProject: vi.fn(() => Promise.resolve()),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
    prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ cancel: vi.fn(), publish: vi.fn() })),
    resetModuleStores: vi.fn(),
    readLegacyChordTrackMigration: vi.fn(() => undefined),
    stopActiveAutoSave: vi.fn(),
    setAutoSaveHandle: vi.fn(),
    verifyAudioBufferReferences: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    cancelPendingAudioBufferImport: vi.fn(),
    getAudioContext: vi.fn(() => ({ sampleRate: 44_100 })),
    prepareCachedAudioBuffersFromIdb: mocks.prepareCachedAudioBuffersFromIdb,
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
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
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getEngineState: vi.fn(),
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
    updateDeviceParam: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    wireSidechainRoute: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureDurableDocumentWitness: vi.fn(),
    captureProjectRevision: vi.fn(),
    createCrdtDoc: vi.fn(),
    createCrdtProject: mocks.createCrdtProject,
    DOC_BRANCHES: '__branches__',
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
    getCrdtDocIds: vi.fn(),
    hasCrdtDoc: vi.fn(),
    loadCrdtProject: mocks.loadCrdtProject,
    mutateCrdtDoc: vi.fn(),
    persistCrdtProject: mocks.persistCrdtProject,
    preserveBranchStateForSession: vi.fn(),
    projectCrdtToStores: mocks.projectCrdtToStores,
    removeCrdtDoc: vi.fn(),
    replaceBranchState: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    replaceCrdtDocInLineage: vi.fn(),
    restoreBranchStateAfterSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    startCrdtAutoSave: mocks.startCrdtAutoSave,
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', () => ({
    reconcileSessionUndoForProject: vi.fn(),
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    appendMidiNotes: vi.fn(),
    arpeggiate: vi.fn(),
    canPrepareMidiClipGlueState: vi.fn(),
    downloadMidiFile: vi.fn(),
    duplicateClipNotes: vi.fn(),
    duplicateMidiClipData: vi.fn(),
    getMidiInputTrack: vi.fn(),
    getMidiInputTrackOwnerId: vi.fn(),
    getMidiInputTrackRevision: vi.fn(),
    getMidiStoreState: vi.fn(),
    hasActiveStepRecordingDependency: vi.fn(),
    mergeImportedMidiClipNotes: vi.fn(),
    migrateAbsoluteMidiNotes: vi.fn(),
    midiClipGlueStateMatches: vi.fn(),
    midiClipSplitStateMatches: vi.fn(),
    prepareMidiClipGlueState: vi.fn(),
    prepareMidiClipSplit: vi.fn(),
    projectMidiNotesByClipIdThroughRestores: vi.fn(() => ({})),
    readLegacyChordTrackMigration: mocks.readLegacyChordTrackMigration,
    readMidiFile: vi.fn(),
    removeMidiClipData: vi.fn(),
    restoreMidiClipData: vi.fn(),
    restoreMidiClipGlueState: vi.fn(),
    restoreMidiClipNotes: vi.fn(),
    restoreMidiClipSplitState: vi.fn(),
    serializeMidiStateForClips: vi.fn(),
    setMidiInputTrack: vi.fn(),
    setNotesForClip: vi.fn(),
    splitMidiNotesAtBeat: vi.fn(),
}));
vi.mock('../helpers/resetModuleStoresToDefault', () => ({ resetModuleStoresToDefault: mocks.resetModuleStores }));
vi.mock('../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: mocks.stopActiveAutoSave }));
vi.mock('../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: mocks.setAutoSaveHandle }));
vi.mock('../helpers/verifyAudioBufferReferences', () => ({
    verifyAudioBufferReferences: mocks.verifyAudioBufferReferences,
}));

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { loadProject } from '../loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';
import { initProjectDirtyTracking } from '../saveProject/initProjectDirtyTracking';

const RESTORED_TRACK_NAME = 'Drums (restored)';

describe('cold-start project restore dirty tracking (audit M-011)', () => {
    let stopDirtyTracking: () => void = () => {};

    beforeEach(() => {
        vi.clearAllMocks();
        stopDirtyTracking();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        trackStore.set(structuredClone(defaultTrackState));
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            name: 'Restored Project',
            createdAt: 1,
            updatedAt: 2,
            dirty: false,
            // What the app starts with: the store's own default is `loading: true`
            // and the boot restore is what clears it.
            loading: true,
            keyRoot: 0,
            scaleName: 'chromatic',
            tuning: { name: 'Equal Temperament', frequencies: [440] },
            initialized: false,
        });
        // CRDT hydration writes the arrangement; that write is what the dirty
        // subscription observes.
        mocks.projectCrdtToStores.mockImplementation(() => {
            trackStore.set({
                tracks: [
                    {
                        id: 'restored-track',
                        name: RESTORED_TRACK_NAME,
                        kind: 'audio',
                    },
                ],
                selectedTrackId: null,
                ghostClips: [],
                // The store's sanitizer fills the rest of the Track shape; this
                // spec only needs an identifiable row to have arrived.
            } as unknown as NonNullable<typeof trackStore.value>);
        });
        stopDirtyTracking = initProjectDirtyTracking();
    });

    it('restores the persisted project without flagging it as edited', async () => {
        const loaded = await loadProject();

        expect(loaded).toBe(true);
        // The restore really happened — otherwise "clean" would be vacuous.
        expect(trackStore.value?.tracks.map((track) => track.name)).toContain(RESTORED_TRACK_NAME);
        expect(projectStore.value?.loading).toBe(false);
        expect(projectStore.value?.dirty).toBe(false);
    });

    it('still marks the restored project dirty on the first edit after the restore', async () => {
        await loadProject();
        expect(projectStore.value?.dirty).toBe(false);

        const current = trackStore.value ?? defaultTrackState;
        trackStore.set({ ...current, selectedTrackId: 'restored-track' });

        expect(projectStore.value?.dirty).toBe(true);
    });
});
