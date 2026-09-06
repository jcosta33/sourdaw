import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';

import { createDefaultProductionBrief } from '../../../models/ProductionBrief';
import { isCanonicalProjectId } from '../../../models/ProjectData';
import { projectStore } from '../../../stores/projectStore';
import { buildProjectData } from '../fileIO/buildProjectData';
import { migrateActiveProjectIdentity } from '../migrateActiveProjectIdentity';

const mocks = vi.hoisted(() => ({
    persistCrdtProject: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>();
    return { ...actual, persistCrdtProject: mocks.persistCrdtProject };
});
vi.mock('#/modules/AudioEngine/useCases', () => ({
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    audioEngine: {},
    ensureBusStrip: vi.fn(),
    exportCachedAudioBuffers: () => Promise.resolve({}),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getEngineState: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    removeSend: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    wireSidechainRoute: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));

/** A version-1 document's `projectMeta`: durable meta with no identity slot. */
function legacyProjectMeta(): Record<string, unknown> {
    return {
        name: 'Legacy Project',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        keyRoot: 0,
        scaleName: 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: Array.from({ length: 128 }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
        },
        productionBrief: createDefaultProductionBrief(1_700_000_000_000),
    };
}

function documentProjectId(): unknown {
    return (getCrdtDoc<Record<string, Record<string, unknown>>>('root')?.projectMeta ?? {}).projectId;
}

describe('migrateActiveProjectIdentity against a live legacy Automerge document', () => {
    beforeEach(() => {
        // The adapter defers each write to an animation frame; the flush the
        // migration performs is what commits it, so a frame never has to run.
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn(() => undefined)
        );
        mocks.persistCrdtProject.mockReset();
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        registerCrdtStorageRuntime();
        createCrdtDoc('root');
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'root',
            changeFn: (doc) => {
                doc.projectMeta = legacyProjectMeta();
            },
        });
        // The previous test's projected cache and any write it left pending
        // belong to the document just replaced; a hydrate would otherwise
        // rebase them onto this one and carry its identity across.
        resetAutomergeStorageProjections('root');
        projectStore.hydrate();
        expect(projectStore.value?.projectId).toBeUndefined();
    });

    afterEach(() => {
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('reports failure, and stays retryable, when an aborted action transaction discards the minted identity', async () => {
        expect(projectStore.value?.projectId).toBeUndefined();

        // `handleSaveProject` runs `saveProject` as a synchronous
        // fire-and-forget, so the migration's store write and its flush both
        // execute inside the dispatching action's storage transaction. That
        // write is scoped to a commit owner still open at flush time, so the
        // flush skips it and only the transaction's own settlement can commit
        // it. An abort discards it instead, and the document is persisted with
        // no identity.
        let migrating: Promise<boolean> | null = null;
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            migrating = migrateActiveProjectIdentity();
        });
        expect(isCanonicalProjectId(projectStore.value?.projectId)).toBe(true);
        expect(documentProjectId()).toBeUndefined();

        transaction.abort();

        await expect(migrating).rejects.toThrow('Minted project identity did not survive persistence');
        expect(projectStore.value?.projectId).toBeUndefined();
        expect(projectStore.value?.identityMigrationPending).toBe(false);
        expect(await buildProjectData({ includeAudioBuffers: false })).toBeNull();

        // The legacy project is not stuck: the next attempt runs outside any
        // action transaction, so its write reaches the document and the
        // snapshot the save path needs can be built again.
        await expect(migrateActiveProjectIdentity()).resolves.toBe(true);
        expect(isCanonicalProjectId(projectStore.value?.projectId)).toBe(true);
        expect(isCanonicalProjectId(documentProjectId())).toBe(true);
        expect(await buildProjectData({ includeAudioBuffers: false })).not.toBeNull();
    });

    it('publishes the minted identity to store and document on the ordinary unscoped path', async () => {
        await expect(migrateActiveProjectIdentity()).resolves.toBe(true);

        expect(isCanonicalProjectId(projectStore.value?.projectId)).toBe(true);
        expect(projectStore.value?.identityMigrationPending).toBe(false);
        expect(documentProjectId()).toBe(projectStore.value?.projectId);
    });
});
