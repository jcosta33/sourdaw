import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { getRecentProjects, recentProjectChanges, recentProjectsStorage } from './helpers';

const MAX_RECENT = 10;

export const addToRecentProjects = inject({ logger })(
    ({ logger }) =>
        function addToRecentProjects(name: string, key: string): void {
            try {
                const entries = getRecentProjects().filter((event) => event.key !== key);
                entries.unshift({ name, key, updatedAt: Date.now() });
                recentProjectsStorage.set(entries.slice(0, MAX_RECENT));
                recentProjectChanges.notify();
            } catch (error) {
                logger.warn(`Failed to update recent projects: ${error}`);
            }
        }
);
