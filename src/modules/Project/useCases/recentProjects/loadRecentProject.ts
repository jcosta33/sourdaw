import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioContext, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/stores';
import { stopPlayback } from '#/modules/Transport/useCases';

import { isSupportedProjectVersion, type ProjectData } from '../../models/ProjectData';
import { readNamedProjectJson, writeProjectJson } from '../../repositories/project/storageOperations';
import { projectStore } from '../../stores/projectStore';
import { hydrateModuleStoresFromProjectData } from '../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { verifyAudioBufferReferences } from '../projectPersistence/helpers/verifyAudioBufferReferences';

export async function loadRecentProject(key: string): Promise<boolean> {
    try {
        // Reads localStorage first, then falls back to IndexedDB so projects
        // whose localStorage dual-write was dropped on quota stay loadable.
        const raw = await readNamedProjectJson(key);
        if (!raw) {
            logger.warn(`No project data found for key: ${key}`);
            return false;
        }

        const data = JSON.parse(raw) as ProjectData;
        if (!isSupportedProjectVersion(data.version)) {
            logger.warn(`Unsupported project version for key: ${key}`);
            return false;
        }

        // Validated — stop any in-flight playback and tear down the previous
        // project's audio graph before we hydrate stores for the new project.
        stopPlayback();
        resetAudioGraph();

        hydrateModuleStoresFromProjectData(data);

        projectStore.set({
            name: data.meta.name,
            createdAt: data.meta.createdAt,
            updatedAt: data.meta.updatedAt,
            keyRoot: data.meta.keyRoot,
            scaleName: data.meta.scaleName,
            tuning: data.meta.tuning,
            dirty: false,
            loading: false,
            initialized: true,
        });

        writeProjectJson(raw);

        await audioBufferCache.restoreFromIdb(getAudioContext());
        if (trackStore.value) {
            trackStore.set({ ...trackStore.value });
        }
        verifyAudioBufferReferences();
        clearUndoHistory();

        return true;
    } catch (error) {
        logger.error(new Error('Failed to load recent project', { cause: error }));
        return false;
    }
}
