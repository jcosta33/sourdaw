import { stringify } from 'superjson';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { RECENT_PROJECTS_KEY } from '../../../models/ProjectData';
import { getRecentProjects, recentProjectsStorage } from '../helpers';

async function get_fresh_recent_projects_from_raw_storage(raw: string) {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem(RECENT_PROJECTS_KEY, raw);

    const helpers = await import('../helpers');
    return helpers.getRecentProjects();
}

describe('recentProjects helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('should return an empty array when storage is empty', () => {
        vi.spyOn(recentProjectsStorage, 'get').mockReturnValue(null);

        expect(getRecentProjects()).toEqual([]);
    });

    it('should return entries from storage', () => {
        const entries = [{ name: 'P', key: 'k1', updatedAt: 1 }];
        vi.spyOn(recentProjectsStorage, 'get').mockReturnValue(entries);

        expect(getRecentProjects()).toEqual(entries);
    });

    it('should return an empty array when raw storage text is malformed', async () => {
        await expect(get_fresh_recent_projects_from_raw_storage('not-json')).resolves.toEqual([]);
    });

    it('should return an empty array when stored data is not an array', async () => {
        const raw = stringify({ name: 'Project', key: 'key-a', updatedAt: 1 });

        await expect(get_fresh_recent_projects_from_raw_storage(raw)).resolves.toEqual([]);
    });

    it('should drop invalid entries while preserving valid neighboring entries', async () => {
        const valid_first_entry = { name: 'First', key: 'key-a', updatedAt: 1 };
        const valid_second_entry = { name: 'Second', key: 'key-b', updatedAt: 2 };
        const raw = stringify([
            valid_first_entry,
            { name: 'Missing key', updatedAt: 3 },
            { name: 'Infinite update', key: 'key-c', updatedAt: Number.POSITIVE_INFINITY },
            null,
            valid_second_entry,
            { name: 123, key: 'key-d', updatedAt: 4 },
        ]);

        await expect(get_fresh_recent_projects_from_raw_storage(raw)).resolves.toEqual([
            valid_first_entry,
            valid_second_entry,
        ]);
    });
});
