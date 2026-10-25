/**
 * `loadProject` runs `migrateTrimmedClipPassTakes()` inside its hydration
 * batch (#4996). The migration's own spec calls the function directly against
 * mocked stores, and every other load-path spec either mocks the hydration or
 * seeds no take lane, so deleting the wiring from `loadProject` left the whole
 * suite green. This spec observes the production wiring: the Arrangement
 * use-case barrel is deliberately left unmocked, so `loadProject`'s own import
 * of the migration is the production one, and the hydration seam
 * (`projectCrdtToStores`) seeds a pre-migration document into the same store
 * singletons the migration reads — spied rather than replaced, because their
 * automerge write path needs a live document this hermetic load spec does not
 * mint. The sibling `loadProjectPreservesSessionUndo.spec.ts` reaches live
 * state through the same public seam.
 */

import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const mocks = vi.hoisted(() => ({
    getCrdtDoc: vi.fn((): { chordTrack?: unknown; tracks: { tracks: never[] } } => ({
        chordTrack: undefined,
        tracks: { tracks: [] },
    })),
    loadCrdtProject: vi.fn(() => Promise.resolve(true)),
    persistCrdtProject: vi.fn(() => Promise.resolve()),
    projectCrdtToStores: vi.fn(),
    captureDurableDocumentWitness: vi.fn(() => ''),
    createCrdtProject: vi.fn(() => Promise.resolve()),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
    prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ cancel: vi.fn(), publish: vi.fn() })),
    resetModuleStores: vi.fn(),
    readLegacyChordTrackMigration: vi.fn(() => undefined),
    stopActiveAutoSave: vi.fn(),
    setAutoSaveHandle: vi.fn(),
    verifyAudioBufferReferences: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    stopTrackInputMonitoring: vi.fn(),

    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    projectsToDifferentNativeBank: vi.fn(() => false),
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
    getRuntimeGraphRevision: vi.fn(),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeSend: vi.fn(),
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
    captureDurableDocumentWitness: mocks.captureDurableDocumentWitness,
    captureProjectRevision: vi.fn(),
    captureProjectRootIdentity: vi.fn<() => string>(() => 'root-identity'),
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
    beginBranchSession: vi.fn(),
    projectCrdtToStores: mocks.projectCrdtToStores,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: vi.fn(() => true),
    removeCrdtDoc: vi.fn(),
    projectBranchSession: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    replaceCrdtDocInLineage: vi.fn(),
    endBranchSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    startCrdtAutoSave: mocks.startCrdtAutoSave,
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
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
    prepareMidiClipFanOutState: vi.fn(),
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

import {
    takeLaneStore,
    trackStore,
    type Clip,
    type TakeLaneStoreState,
    type Track,
    type TrackStoreState,
} from '#/modules/Arrangement/stores';

import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { loadProject } from '../loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

const PROJECT_ID = '405e744b-dead-843a-9395-86fdcd66368c';

type LaneTake = TakeLaneStoreState['lanes'][number]['takes'][number];

const trimmedClip: Clip = {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Trimmed loop take',
    startBeat: 1,
    endBeat: 8,
    type: 'audio',
    audioBufferId: 'buffer-1',
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#ff0000',
    locked: false,
    muted: false,
    audioOffsetBeats: 1,
};

function trackFixture(clips: Clip[]): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips,
        devices: [],
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
        activeAlternativeId: 'track-1-alt',
        alternatives: [{ id: 'track-1-alt', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

/** A loop pass as a pre-#4987 build saved it: a media depth, no placement seconds. */
function passTake(id: string, startBeat: number, endBeat: number, sourceOffsetBeats: number): LaneTake {
    return { id, clipId: 'clip-1', name: id, startBeat, endBeat, selected: false, sourceOffsetBeats };
}

let trackStoreValueSpy: MockInstance<() => TrackStoreState | null>;
let laneStoreValueSpy: MockInstance<() => TakeLaneStoreState | null>;

/**
 * The mocked projection stands in for the hydration write: by the time the
 * batch reaches the migration, the spied singletons hold the loaded document.
 */
function hydrateVia(tracks: TrackStoreState, lanes: TakeLaneStoreState): void {
    mocks.projectCrdtToStores.mockImplementation(() => {
        const current = projectStore.value ?? defaultProjectStoreState;
        projectStore.set({ ...current, projectId: PROJECT_ID });
        trackStoreValueSpy.mockReturnValue(tracks);
        laneStoreValueSpy.mockReturnValue(lanes);
    });
}

describe('loadProject runs the trimmed pass-take migration inside the hydration batch (#4996)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            projectId: undefined,
            loading: true,
            initialized: false,
        });
        trackStoreValueSpy = vi.spyOn(trackStore, 'value', 'get').mockReturnValue(null);
        laneStoreValueSpy = vi.spyOn(takeLaneStore, 'value', 'get').mockReturnValue(null);
        vi.spyOn(takeLaneStore, 'set').mockImplementation(() => {});
        mocks.loadCrdtProject.mockResolvedValue(true);
        mocks.getCrdtDoc.mockReturnValue({ chordTrack: undefined, tracks: { tracks: [] } });
    });

    it('clamps the pass takes a start trim left behind when the loaded document carries them', async () => {
        // Loop [0,4) recorded for two passes, then the clip start trimmed to
        // beat 1 on a build that did not carry takes along (#4996): the saved
        // document hydrates with the stale spans, and the load must write the
        // clamped lane back.
        hydrateVia(
            { tracks: [trackFixture([trimmedClip])], selectedTrackId: 'track-1', ghostClips: [] },
            {
                lanes: [
                    {
                        id: 'lane-1',
                        trackId: 'track-1',
                        takes: [passTake('pass-1', 0, 4, 0), passTake('pass-2', 0, 4, 4)],
                        activeCompRegions: [],
                    },
                ],
            }
        );

        await expect(loadProject()).resolves.toBe(true);

        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const written = vi.mocked(takeLaneStore.set).mock.calls[0]?.[0];
        expect(written?.lanes[0]?.takes).toEqual([passTake('pass-1', 1, 4, 0), passTake('pass-2', 1, 4, 4)]);
    });

    it('round-trips a current document without writing the lane', async () => {
        // Post-#4987 commit of a recording begun inside the loop: nothing for
        // the migration to repair, so the load must not touch the lane store.
        hydrateVia(
            {
                tracks: [trackFixture([{ ...trimmedClip, startBeat: 0, endBeat: 8, audioOffsetBeats: -2 }])],
                selectedTrackId: 'track-1',
                ghostClips: [],
            },
            {
                lanes: [
                    {
                        id: 'lane-1',
                        trackId: 'track-1',
                        takes: [passTake('pass-1', 2, 4, 0), passTake('pass-2', 0, 4, 4)],
                        activeCompRegions: [],
                    },
                ],
            }
        );

        await expect(loadProject()).resolves.toBe(true);

        // The migration writes only when a take moved, so an unchanged load
        // leaves the lane store alone.
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });
});
