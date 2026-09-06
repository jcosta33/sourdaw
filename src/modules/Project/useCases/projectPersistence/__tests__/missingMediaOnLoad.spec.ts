import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The load-side gate for absent audio.
 *
 * `loadProject` is the boot-restore path: it rehydrates the persisted CRDT
 * project and prepares its referenced audio buffers out of IndexedDB. Buffers
 * that fail to resolve are simply absent from the cache — nothing throws, and
 * before this spec nothing counted them either, so a project whose audio had
 * been evicted reopened looking intact and played silence.
 *
 * These tests drive the real `verifyAudioBufferReferences` and the real
 * `missingMediaStore` through `loadProject`. Only the CRDT/engine boundary and
 * `trackStore` are mocked; `projectCrdtToStores` is a mock, so the mocked
 * `trackStore` value stands in for the state hydration would have produced.
 */

const mocks = vi.hoisted(() => {
    const trackStoreValue: { value: unknown } = { value: null };
    return {
        executeAppAction: vi.fn(() => Promise.resolve()),
        getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => AudioBuffer | null>(() => null),
        getCrdtDoc: vi.fn((): { chordTrack?: unknown; tracks: { tracks: unknown[] } } => ({ tracks: { tracks: [] } })),
        loadCrdtProject: vi.fn(() => Promise.resolve(true)),
        notifyUser: vi.fn(),
        persistCrdtProject: vi.fn(() => Promise.resolve()),
        prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ cancel: vi.fn(), publish: vi.fn() })),
        projectCrdtToStores: vi.fn(),
        projectStoreValue: {
            value: {
                identityMigrationPending: false,
                identityPersistencePending: false,
                initialized: true,
                loading: false,
                projectId: '405e744b-dead-843a-9395-86fdcd66368c',
            },
        },
        readLegacyChordTrackMigration: vi.fn(() => null),
        startCrdtAutoSave: vi.fn(() => vi.fn()),
        trackStoreValue,
    };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    cancelPendingAudioBufferImport: vi.fn(),
    getAudioContext: vi.fn(() => ({})),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
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
    createCrdtProject: vi.fn(),
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
    executeAppActionBatch: vi.fn(),
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
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));
vi.mock('../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: vi.fn(),
    },
}));
vi.mock('../helpers/resetModuleStoresToDefault', () => ({ resetModuleStoresToDefault: vi.fn() }));
vi.mock('../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: vi.fn() }));
vi.mock('../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: vi.fn() }));

import { defaultMissingMediaStoreState, missingMediaStore } from '../../../stores/missingMediaStore';
import { loadProject } from '../loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

const STUB_BUFFER = {
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
    duration: 1,
    getChannelData: vi.fn(() => new Float32Array(1)),
    length: 1,
    numberOfChannels: 1,
    sampleRate: 48_000,
} satisfies AudioBuffer;

type ClipSeed = { id: string; name: string; audioBufferId?: string; type?: 'audio' | 'midi' };
type TrackSeed = { id: string; name: string; clips?: ClipSeed[]; frozenBufferId?: string };

function seedTracks(tracks: TrackSeed[]): void {
    mocks.trackStoreValue.value = {
        selectedTrackId: null,
        tracks: tracks.map((track) => ({
            clips: (track.clips ?? []).map((clip) => ({
                audioBufferId: clip.audioBufferId,
                id: clip.id,
                name: clip.name,
                trackId: track.id,
                type: clip.type ?? 'audio',
            })),
            freezeState: track.frozenBufferId
                ? { frozenBufferId: track.frozenBufferId, status: 'frozen' }
                : { status: 'unfrozen' },
            id: track.id,
            name: track.name,
        })),
    };
}

/** Resolve every buffer id except the named ones, so "missing" is a property of
 * the cache rather than of the fixture's shape. */
function resolveAllExcept(absentIds: string[]): void {
    const absent = new Set(absentIds);
    mocks.getCachedAudioBuffer.mockImplementation(({ bufferId }) => (absent.has(bufferId) ? null : STUB_BUFFER));
}

describe('missing media on project load', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loadCrdtProject.mockResolvedValue(true);
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.getCrdtDoc.mockReturnValue({ tracks: { tracks: [] } });
        mocks.prepareCachedAudioBuffersFromIdb.mockResolvedValue({ cancel: vi.fn(), publish: vi.fn() });
        mocks.readLegacyChordTrackMigration.mockReturnValue(null);
        mocks.startCrdtAutoSave.mockReturnValue(vi.fn());
        mocks.trackStoreValue.value = null;
        resolveAllExcept([]);
        missingMediaStore.set(defaultMissingMediaStoreState);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    });

    it('records every unresolved clip and frozen track after a boot restore', async () => {
        seedTracks([
            {
                clips: [
                    { audioBufferId: 'buf-present', id: 'clip-ok', name: 'Kept Vocal' },
                    { audioBufferId: 'buf-gone', id: 'clip-gone', name: 'Lost Guitar' },
                ],
                id: 'track-1',
                name: 'Guitars',
            },
            { frozenBufferId: 'freeze-gone', id: 'track-2', name: 'Frozen Piano' },
        ]);
        resolveAllExcept(['buf-gone', 'freeze-gone']);

        await expect(loadProject()).resolves.toBe(true);

        const recorded = missingMediaStore.value;
        expect(recorded?.items).toEqual([
            {
                bufferId: 'buf-gone',
                clipId: 'clip-gone',
                kind: 'clip',
                label: 'Lost Guitar',
                trackId: 'track-1',
                trackName: 'Guitars',
            },
            {
                bufferId: 'freeze-gone',
                kind: 'frozenTrack',
                label: 'Frozen track Frozen Piano',
                trackId: 'track-2',
                trackName: 'Frozen Piano',
            },
        ]);
    });

    it('leaves no missing-media record when every referenced buffer resolves', async () => {
        seedTracks([
            {
                clips: [
                    { audioBufferId: 'buf-a', id: 'clip-a', name: 'Kick' },
                    { audioBufferId: 'buf-b', id: 'clip-b', name: 'Snare' },
                ],
                id: 'track-1',
                name: 'Drums',
            },
            { frozenBufferId: 'freeze-ok', id: 'track-2', name: 'Pad' },
        ]);
        resolveAllExcept([]);

        await expect(loadProject()).resolves.toBe(true);

        expect(missingMediaStore.value?.items).toEqual([]);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('clears a previous project record when the next load resolves cleanly', async () => {
        seedTracks([{ clips: [{ audioBufferId: 'buf-gone', id: 'clip-gone', name: 'Lost' }], id: 't', name: 'T' }]);
        resolveAllExcept(['buf-gone']);
        await expect(loadProject()).resolves.toBe(true);
        expect(missingMediaStore.value?.items).toHaveLength(1);

        seedTracks([{ clips: [{ audioBufferId: 'buf-ok', id: 'clip-ok', name: 'Found' }], id: 't', name: 'T' }]);
        resolveAllExcept([]);
        await expect(loadProject()).resolves.toBe(true);

        expect(missingMediaStore.value?.items).toEqual([]);
    });

    it('ignores midi clips, which reference no audio buffer', async () => {
        seedTracks([
            {
                clips: [{ id: 'clip-midi', name: 'Melody', type: 'midi' }],
                id: 'track-1',
                name: 'Keys',
            },
        ]);
        resolveAllExcept(['anything']);

        await expect(loadProject()).resolves.toBe(true);

        expect(missingMediaStore.value?.items).toEqual([]);
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });
});
