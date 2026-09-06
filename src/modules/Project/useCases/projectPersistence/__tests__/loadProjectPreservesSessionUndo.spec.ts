/**
 * Issue #3331: `loadProject` used to call `clearUndoHistory()` unconditionally
 * inside its hydration batch. The undo store's own flush-to-sessionStorage
 * subscriber then overwrote the boot-restored session mirror with the emptied
 * stacks on the very next microtask, so Ctrl+Z undid nothing after any reload
 * of a stored project. `reconcileSessionUndoForProject` replaces that
 * unconditional clear with an identity check against the project
 * `projectCrdtToStores` just hydrated.
 *
 * A matching project id alone is not proof the restored document is the one
 * the stacks invert: the mirror flushes a microtask after every push, while
 * document autosave is debounced and best-effort on unload, so a reload can
 * restore a stale document under the same project id. `reconcileSessionUndoForProject`
 * therefore also compares a durable document witness (see `CrdtDocument`'s
 * `captureDurableDocumentWitness`), injected here as `captureWitness` because
 * Command must not import CrdtDocument.
 *
 * `#/modules/Command/useCases` is deliberately left unmocked here (unlike the
 * sibling `loadProject.spec.ts`): the behaviour under test is the real
 * identity comparison living in Command's own undo store, and a hand-rolled
 * mock could only assert that `loadProject` calls the reconciliation, not
 * that the reconciliation itself keeps or clears correctly. Boot's own
 * `hydrateUndoStoreFromSession` is Command-private and unreachable across the
 * module boundary even from a test, so "as bootstrap hydration would" is
 * reproduced through the same public seam `loadProject` itself uses:
 * `reconcileSessionUndoForProject({ projectId, captureWitness })` first tags
 * the live stacks to project X and witness W exactly as a boot hydration
 * reading a mirror written for X/W would, then `pushUndoEntry` deposits the
 * entry that hydration would have restored. What matters for this spec is the
 * state that results, not the mechanism that produced it — the sessionStorage
 * wire format and the hydrate-time identity parsing are covered directly in
 * `Command/stores/__tests__/undoStore.spec.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    captureDurableDocumentWitness: mocks.captureDurableDocumentWitness,
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

import { undoStore } from '#/modules/Command/stores';
import { pushUndoEntry, reconcileSessionUndoForProject } from '#/modules/Command/useCases';

import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { loadProject } from '../loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

const RESTORED_PROJECT_ID = 'project-x';
const OTHER_PROJECT_ID = 'project-y';
const SEEDED_ENTRY_LABEL = 'Seeded tempo change';
const HYDRATED_WITNESS = 'witness-hydrated';
const DIVERGED_WITNESS = 'witness-diverged';

function seedHydratedUndoEntryFor(projectId: string, witness: string): void {
    // See the file header: this reaches the same live state a boot hydration
    // for `projectId`/`witness` would, through the same public seam
    // `loadProject` calls.
    reconcileSessionUndoForProject({ projectId, captureWitness: () => witness });
    pushUndoEntry(
        SEEDED_ENTRY_LABEL,
        () => {},
        () => {}
    );
}

function restoreProjectVia(projectCrdtToStoresImpl: () => void): void {
    mocks.projectCrdtToStores.mockImplementation(projectCrdtToStoresImpl);
}

describe('loadProject preserves session undo history for the same project (#3331)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // `#/modules/Command/useCases` is intentionally unmocked (see file
        // header), so its undo store is a real singleton that otherwise
        // carries state across `it()` blocks in this file. `undefined` never
        // matches a real project id, so this both empties the stacks and
        // resets the tracked owner to unknown; the witness function is never
        // invoked in that path.
        reconcileSessionUndoForProject({ projectId: undefined, captureWitness: () => '' });
        mocks.captureDurableDocumentWitness.mockReturnValue(HYDRATED_WITNESS);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            projectId: undefined,
            loading: true,
            initialized: false,
        });
        mocks.loadCrdtProject.mockResolvedValue(true);
        mocks.getCrdtDoc.mockReturnValue({ chordTrack: undefined, tracks: { tracks: [] } });
    });

    it('keeps the hydrated undo history when the reload restores the same project and document', async () => {
        seedHydratedUndoEntryFor(RESTORED_PROJECT_ID, HYDRATED_WITNESS);
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual([SEEDED_ENTRY_LABEL]);

        restoreProjectVia(() => {
            const current = projectStore.value ?? defaultProjectStoreState;
            projectStore.set({ ...current, projectId: RESTORED_PROJECT_ID });
        });
        // `captureDurableDocumentWitness` already reports HYDRATED_WITNESS via
        // the `beforeEach` default, matching what was seeded above.

        await expect(loadProject()).resolves.toBe(true);

        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual([SEEDED_ENTRY_LABEL]);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('clears the hydrated undo history when the reload restores a different project', async () => {
        seedHydratedUndoEntryFor(RESTORED_PROJECT_ID, HYDRATED_WITNESS);
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual([SEEDED_ENTRY_LABEL]);

        restoreProjectVia(() => {
            const current = projectStore.value ?? defaultProjectStoreState;
            projectStore.set({ ...current, projectId: OTHER_PROJECT_ID });
        });

        await expect(loadProject()).resolves.toBe(true);

        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('clears the hydrated undo history when the reload restores the same project but a divergent document', async () => {
        seedHydratedUndoEntryFor(RESTORED_PROJECT_ID, HYDRATED_WITNESS);
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual([SEEDED_ENTRY_LABEL]);

        restoreProjectVia(() => {
            const current = projectStore.value ?? defaultProjectStoreState;
            projectStore.set({ ...current, projectId: RESTORED_PROJECT_ID });
        });
        // Same project id as the mirror, but the reloaded document's witness
        // no longer matches — a stale restore, or edits the mirror never saw.
        mocks.captureDurableDocumentWitness.mockReturnValue(DIVERGED_WITNESS);

        await expect(loadProject()).resolves.toBe(true);

        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toEqual([]);
    });
});
