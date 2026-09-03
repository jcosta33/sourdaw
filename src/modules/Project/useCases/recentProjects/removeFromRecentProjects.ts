import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { getRecentProjects, recentProjectChanges, recentProjectsStorage } from './helpers';

export const removeFromRecentProjects = inject({ logger })(
    ({ logger }) =>
        function removeFromRecentProjects(key: string): void {
            try {
                recentProjectsStorage.set(getRecentProjects().filter((event) => event.key !== key));
                recentProjectChanges.notify();
            } catch (error) {
                logger.warn(`Failed to remove from recent projects: ${error}`);
            }
        }
);
