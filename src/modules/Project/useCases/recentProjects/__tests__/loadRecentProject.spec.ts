import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAudioContext, restoreCachedAudioBuffersFromIdb } from '#/modules/AudioEngine/useCases';

import { CURRENT_PROJECT_VERSION } from '../../../models/ProjectData';
import { readNamedProjectJson, writeProjectJson } from '../../../repositories/project/storageOperations';
import { hydrateModuleStoresFromProjectData } from '../../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from '../../projectPersistence/helpers/resetModuleStoresToDefault';
import { loadRecentProject } from '../loadRecentProject';

vi.mock('../../../repositories/project/storageOperations', () => ({
    readNamedProjectJson: vi.fn(),
    writeProjectJson: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({ stopPlayback: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resetAudioGraph: vi.fn(),
    getAudioContext: vi.fn(() => ({ id: 'audio-context' })),
    restoreCachedAudioBuffersFromIdb: vi.fn().mockResolvedValue(0),
}));
vi.mock('#/modules/Command/useCases', () => ({ clearUndoHistory: vi.fn() }));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: { value: null } }));
vi.mock('../../projectPersistence/helpers/hydrateModuleStoresFromProjectData', () => ({
    hydrateModuleStoresFromProjectData: vi.fn(),
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
        expect(writeProjectJson).toHaveBeenCalledWith(validProject);
        expect(getAudioContext).toHaveBeenCalledTimes(1);
        expect(restoreCachedAudioBuffersFromIdb).toHaveBeenCalledWith({
            audioContext: vi.mocked(getAudioContext).mock.results[0]?.value,
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

    it('returns false when neither localStorage nor IndexedDB has the project', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(null);

        const ok = await loadRecentProject('missing');

        expect(ok).toBe(false);
        expect(hydrateModuleStoresFromProjectData).not.toHaveBeenCalled();
        // No project was replaced, so the device-store reset must not fire either.
        expect(resetModuleStoresToDefault).not.toHaveBeenCalled();
    });
});
