import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRecentProjects, recentProjectsStorage } from '../helpers';

describe('recentProjects helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
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
});
