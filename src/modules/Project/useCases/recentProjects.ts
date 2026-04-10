import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';
import { trackStore } from '#/modules/Arrangement';
import { type ProjectData, RECENT_PROJECTS_KEY } from '../models/ProjectData';
import { projectStore } from '../stores/projectStore';
import { readNamedProjectJson, writeProjectJson } from '../repositories/project/storageOperations';
import { audioBufferCache, getAudioContext, resetAudioGraph } from '#/modules/AudioEngine';
import { stopPlayback } from '#/modules/Command';
import {
    hydrateModuleStoresFromProjectData,
    clearUndoHistory,
    verifyAudioBufferReferences,
} from './projectPersistence/helpers';

const MAX_RECENT = 10;

const recentProjectsStorage = createLocalStorage<RecentProjectEntry[]>(
    RECENT_PROJECTS_KEY as 'sourdaw:recent-projects'
);

export type RecentProjectEntry = {
    name: string;
    key: string;
    updatedAt: number;
};

export function getRecentProjects(): RecentProjectEntry[] {
    return recentProjectsStorage.get() ?? [];
}

export const addToRecentProjects = inject({ logger })(
    ({ logger }) =>
        function addToRecentProjects(name: string, key: string): void {
            try {
                const entries = getRecentProjects().filter((e) => e.key !== key);
                entries.unshift({ name, key, updatedAt: Date.now() });
                recentProjectsStorage.set(entries.slice(0, MAX_RECENT));
            } catch (error) {
                logger.warn(`Failed to update recent projects: ${error}`);
            }
        }
);

export const removeFromRecentProjects = inject({ logger })(
    ({ logger }) =>
        function removeFromRecentProjects(key: string): void {
            try {
                recentProjectsStorage.set(getRecentProjects().filter((e) => e.key !== key));
            } catch (error) {
                logger.warn(`Failed to remove from recent projects: ${error}`);
            }
        }
);

export const loadRecentProject = inject({
    logger,
    stopPlayback,
    resetAudioGraph,
    getAudioContext,
    hydrateModuleStoresFromProjectData,
    clearUndoHistory,
    verifyAudioBufferReferences,
    audioBufferCache,
})(
    ({
        logger,
        stopPlayback,
        resetAudioGraph,
        getAudioContext,
        hydrateModuleStoresFromProjectData,
        clearUndoHistory,
        verifyAudioBufferReferences,
        audioBufferCache,
    }) =>
        async function loadRecentProject(key: string): Promise<boolean> {
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
        }
);
