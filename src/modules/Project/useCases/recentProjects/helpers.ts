import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

import { RECENT_PROJECTS_KEY } from '../../models/ProjectData';

export type RecentProjectEntry = {
    name: string;
    key: string;
    updatedAt: number;
};

export const recentProjectsStorage = createLocalStorage<RecentProjectEntry[]>(RECENT_PROJECTS_KEY);
const recentProjectListeners = new Set<() => void>();

function has_recent_project_entry_fields(value: unknown): value is { name: unknown; key: unknown; updatedAt: unknown } {
    return typeof value === 'object' && value !== null && 'name' in value && 'key' in value && 'updatedAt' in value;
}

function is_recent_project_entry(value: unknown): value is RecentProjectEntry {
    if (!has_recent_project_entry_fields(value)) {
        return false;
    }

    return (
        typeof value.name === 'string' &&
        typeof value.key === 'string' &&
        typeof value.updatedAt === 'number' &&
        Number.isFinite(value.updatedAt)
    );
}

function sanitize_recent_projects(value: unknown): RecentProjectEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(is_recent_project_entry);
}

export function getRecentProjects(): RecentProjectEntry[] {
    return sanitize_recent_projects(recentProjectsStorage.get());
}

/** Project-owned reactive surface for recent-project writes. */
export const recentProjectChanges = {
    subscribe(listener: () => void): () => void {
        recentProjectListeners.add(listener);
        return () => recentProjectListeners.delete(listener);
    },
    notify(): void {
        for (const listener of [...recentProjectListeners]) {
            listener();
        }
    },
};
