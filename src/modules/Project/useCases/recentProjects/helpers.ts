import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

import { RECENT_PROJECTS_KEY } from '../../models/ProjectData';

export type RecentProjectEntry = {
    name: string;
    key: string;
    updatedAt: number;
};

export const recentProjectsStorage = createLocalStorage<RecentProjectEntry[]>(
    RECENT_PROJECTS_KEY as 'sourdaw:recent-projects'
);

export function getRecentProjects(): RecentProjectEntry[] {
    return recentProjectsStorage.get() ?? [];
}
