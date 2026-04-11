import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { getRecentProjects, recentProjectsStorage } from './helpers';

export const removeFromRecentProjects = inject({ logger })(
    ({ logger }) =>
        (function removeFromRecentProjects(key: string): void {
            try {
                recentProjectsStorage.set(getRecentProjects().filter((e) => e.key !== key));
            } catch (error) {
                logger.warn(`Failed to remove from recent projects: ${error}`);
            }
        })
);