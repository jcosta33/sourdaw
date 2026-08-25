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
    cancelPendingAudioBufferImport: vi.fn(),
    getAudioContext: vi.fn(() => ({ sampleRate: 44_100 })),
    prepareCachedAudioBuffersFromIdb: mocks.prepareCachedAudioBuffersFromIdb,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    createCrdtProject: mocks.createCrdtProject,
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
    loadCrdtProject: mocks.loadCrdtProject,
    persistCrdtProject: mocks.persistCrdtProject,
    projectCrdtToStores: mocks.projectCrdtToStores,
    startCrdtAutoSave: mocks.startCrdtAutoSave,
}));
vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: vi.fn(),
    executeAppAction: mocks.executeAppAction,
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    migrateAbsoluteMidiNotes: vi.fn(),
    readLegacyChordTrackMigration: mocks.readLegacyChordTrackMigration,
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
