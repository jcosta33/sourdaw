import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { type ProjectData } from '../../models/ProjectData';
import { projectStore } from '../../stores/projectStore';
import { readNamedProjectJson, writeProjectJson } from '../../repositories/project/storageOperations';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioContext, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';
import { hydrateModuleStoresFromProjectData } from '../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { verifyAudioBufferReferences } from '../projectPersistence/helpers/verifyAudioBufferReferences';

export const loadRecentProject = async function loadRecentProject(key: string): Promise<boolean> {
    try {
        const raw = readNamedProjectJson(key);
        if (!raw) {
            logger.warn(`No project data found for key: ${key}`);
            return false;
        }

        const data = JSON.parse(raw) as ProjectData;
        if (data.version !== 1) {
            logger.warn(`Unsupported project version for key: ${key}`);
            return false;
        }

        // Validated — stop any in-flight playback and tear down the previous
        // project's audio graph before we hydrate stores for the new project.
        stopPlayback();
        resetAudioGraph();

        hydrateModuleStoresFromProjectData(data);
        projectStore.set({
            name: data.name,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
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
};