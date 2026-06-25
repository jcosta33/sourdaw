import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CURRENT_PROJECT_VERSION } from '../../../models/ProjectData';
import { readNamedProjectJson, writeProjectJson } from '../../../repositories/project/storageOperations';
import { hydrateModuleStoresFromProjectData } from '../../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { loadRecentProject } from '../loadRecentProject';

vi.mock('../../../repositories/project/storageOperations', () => ({
    readNamedProjectJson: vi.fn(),
    writeProjectJson: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({ stopPlayback: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resetAudioGraph: vi.fn(),
    getAudioContext: vi.fn(),
}));
vi.mock('#/modules/Command/stores', () => ({ clearUndoHistory: vi.fn() }));
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { restoreFromIdb: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: { value: null } }));
vi.mock('../../projectPersistence/helpers/hydrateModuleStoresFromProjectData', () => ({
    hydrateModuleStoresFromProjectData: vi.fn(),
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
    });

    it('returns false when neither localStorage nor IndexedDB has the project', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(null);

        const ok = await loadRecentProject('missing');

        expect(ok).toBe(false);
        expect(hydrateModuleStoresFromProjectData).not.toHaveBeenCalled();
    });
});
