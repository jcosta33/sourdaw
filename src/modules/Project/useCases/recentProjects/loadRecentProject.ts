import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { getAudioContext, resetAudioGraph, restoreCachedAudioBuffersFromIdb } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { createCrdtProject, projectActionHistoryToStore } from '#/modules/CrdtDocument/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { isSupportedProjectVersion, type ProjectData } from '../../models/ProjectData';
import { readNamedProjectJson, writeProjectJson } from '../../repositories/project/storageOperations';
import { projectStore } from '../../stores/projectStore';
import { beginProjectIdentityTransition } from '../projectPersistence/beginProjectIdentityTransition';
import { hydrateModuleStoresFromProjectData } from '../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from '../projectPersistence/helpers/resetModuleStoresToDefault';
import { verifyAudioBufferReferences } from '../projectPersistence/helpers/verifyAudioBufferReferences';

export async function loadRecentProject(key: string): Promise<boolean> {
    const transition = beginProjectIdentityTransition();
    try {
        if (!(await transition.prepare())) {
            return false;
        }
        // Reads localStorage first, then falls back to IndexedDB so projects
        // whose localStorage dual-write was dropped on quota stay loadable.
        const raw = await readNamedProjectJson(key);
        if (!transition.isCurrent()) {
            return false;
        }
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
        // project's audio graph before activating storage for the new project.
        stopPlayback();
        resetAudioGraph();

        const activated = await createCrdtProject({ name: data.meta.name, canActivate: transition.isCurrent });
        if (!activated || !transition.isCurrent() || !transition.complete()) {
            return false;
        }
        if (!transition.isCurrent()) {
            return false;
        }
        projectActionHistoryToStore();

        // Reset per-device-instance stores (§13.1) so stale device state from the
        // previously open project does not leak into the project being loaded;
        // hydrateModuleStoresFromProjectData does not touch the device stores.
        resetModuleStoresToDefault();

        if (!transition.isCurrent()) {
            return false;
        }
        hydrateModuleStoresFromProjectData(data);

        if (!transition.isCurrent()) {
            return false;
        }
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

        if (!transition.isCurrent()) {
            return false;
        }
        writeProjectJson(raw);

        await restoreCachedAudioBuffersFromIdb({ audioContext: getAudioContext() });
        if (!transition.isCurrent()) {
            return false;
        }
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
