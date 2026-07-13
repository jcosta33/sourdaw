import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAudioContext, restoreCachedAudioBuffersFromIdb } from '#/modules/AudioEngine/useCases';

import { CURRENT_PROJECT_VERSION } from '../../../models/ProjectData';
import { readNamedProjectJson, writeProjectJson } from '../../../repositories/project/storageOperations';
import { hydrateArrangementStoreFromProjectData } from '../../projectPersistence/helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from '../../projectPersistence/helpers/resetModuleStoresToDefault';
import { loadRecentProject } from '../loadRecentProject';

const { audioContext } = vi.hoisted(() => ({
    audioContext: { id: 'audio-context' },
}));

vi.mock('../../../repositories/project/storageOperations', () => ({
    readNamedProjectJson: vi.fn(),
    writeProjectJson: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({ stopPlayback: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resetAudioGraph: vi.fn(),
    getAudioContext: vi.fn(() => audioContext),
    restoreCachedAudioBuffersFromIdb: vi.fn().mockResolvedValue(0),
}));
vi.mock('#/modules/Command/useCases', () => ({ clearUndoHistory: vi.fn() }));
vi.mock('../../projectPersistence/helpers/hydrateModuleStoresFromProjectData', () => ({
    hydrateModuleStoresFromProjectData: vi.fn(),
}));
vi.mock('../../projectPersistence/helpers/hydrateArrangementStoreFromProjectData', () => ({
    hydrateArrangementStoreFromProjectData: vi.fn(),
}));
vi.mock('../../projectPersistence/helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: vi.fn(),
}));
vi.mock('../../projectPersistence/helpers/verifyAudioBufferReferences', () => ({
    verifyAudioBufferReferences: vi.fn(),
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const validProject = JSON.stringify({
    version: CURRENT_PROJECT_VERSION,
    meta: {
        name: 'Large Project',
        createdAt: 1,
        updatedAt: 2,
        keyRoot: 0,
        scaleName: 'major',
        tuning: { name: '12-TET', frequencies: [] },
    },
    arrangement: { tracks: [] },
});

describe('loadRecentProject', () => {
    beforeEach(() => {
        vi.mocked(readNamedProjectJson).mockReset();
        vi.mocked(writeProjectJson).mockClear();
        vi.mocked(hydrateModuleStoresFromProjectData).mockClear();
        vi.mocked(hydrateArrangementStoreFromProjectData).mockClear();
        vi.mocked(resetModuleStoresToDefault).mockClear();
        vi.mocked(getAudioContext).mockClear();
        vi.mocked(restoreCachedAudioBuffersFromIdb).mockClear();
    });

    it('loads a named project that resolves only from the IndexedDB fallback', async () => {
        // readNamedProjectJson is the async, IDB-aware read: localStorage was
        // empty (quota-dropped dual-write) and the value came back from IDB.
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);

        const ok = await loadRecentProject('sourdaw:project:Large Project');

        expect(ok).toBe(true);
        expect(readNamedProjectJson).toHaveBeenCalledWith('sourdaw:project:Large Project');
        expect(hydrateModuleStoresFromProjectData).toHaveBeenCalledTimes(1);
        expect(hydrateArrangementStoreFromProjectData).toHaveBeenCalledWith(
            expect.objectContaining({ version: CURRENT_PROJECT_VERSION })
        );
        expect(writeProjectJson).toHaveBeenCalledWith(validProject);
        expect(getAudioContext).toHaveBeenCalledTimes(1);
        expect(restoreCachedAudioBuffersFromIdb).toHaveBeenCalledWith({
            audioContext,
        });
    });

    it('resets the per-device-instance stores (§13.1) before hydrating, to avoid leaking the previous project', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);

        const ok = await loadRecentProject('sourdaw:project:Large Project');

        expect(ok).toBe(true);
        expect(resetModuleStoresToDefault).toHaveBeenCalledTimes(1);
        // The reset must precede hydration so device stores are blank before the
        // loaded project's non-device state is written over them.
        const resetOrder = vi.mocked(resetModuleStoresToDefault).mock.invocationCallOrder[0];
        const hydrateOrder = vi.mocked(hydrateModuleStoresFromProjectData).mock.invocationCallOrder[0];
        expect(resetOrder).toBeLessThan(hydrateOrder);
    });

    it('restores cached audio buffers before publishing hydrated tracks', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);
        let completeRestore: (() => void) | undefined;
        vi.mocked(restoreCachedAudioBuffersFromIdb).mockImplementationOnce(
            () =>
                new Promise<number>((resolve) => {
                    completeRestore = () => resolve(0);
                })
        );

        const loading = loadRecentProject('sourdaw:project:Large Project');
        await vi.waitFor(() => expect(restoreCachedAudioBuffersFromIdb).toHaveBeenCalledTimes(1));

        expect(resetModuleStoresToDefault).toHaveBeenCalledTimes(1);
        expect(hydrateModuleStoresFromProjectData).not.toHaveBeenCalled();
        const finishRestore = completeRestore;
        if (!finishRestore) {
            throw new Error('Expected pending audio-buffer restoration');
        }
        finishRestore();
        await expect(loading).resolves.toBe(true);
        expect(hydrateModuleStoresFromProjectData).toHaveBeenCalledTimes(1);
    });

    it('returns false when neither localStorage nor IndexedDB has the project', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(null);

        const ok = await loadRecentProject('missing');

        expect(ok).toBe(false);
        expect(hydrateModuleStoresFromProjectData).not.toHaveBeenCalled();
        // No project was replaced, so the device-store reset must not fire either.
        expect(resetModuleStoresToDefault).not.toHaveBeenCalled();
    });

    it('serializes overlapping loads so the later request publishes last', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(validProject);
        let completeFirstRestore: (() => void) | undefined;
        vi.mocked(restoreCachedAudioBuffersFromIdb)
            .mockImplementationOnce(
                () =>
                    new Promise<number>((resolve) => {
                        completeFirstRestore = () => resolve(0);
                    })
            )
            .mockResolvedValueOnce(0);

        const firstLoad = loadRecentProject('first-project');
        const secondLoad = loadRecentProject('second-project');
        await vi.waitFor(() => expect(completeFirstRestore).toBeDefined());
        const readsBeforeFirstRestoreCompleted = vi.mocked(readNamedProjectJson).mock.calls.length;

        const finishFirstRestore = completeFirstRestore;
        if (!finishFirstRestore) {
            throw new Error('Expected first project restoration to be pending');
        }
        finishFirstRestore();
        await expect(Promise.all([firstLoad, secondLoad])).resolves.toEqual([true, true]);

        expect(readsBeforeFirstRestoreCompleted).toBe(1);
        expect(readNamedProjectJson).toHaveBeenNthCalledWith(1, 'first-project');
        expect(readNamedProjectJson).toHaveBeenNthCalledWith(2, 'second-project');
    });
});
