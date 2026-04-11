import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repositories/libraryPersistence/requestPermission', () => ({
    requestPermission: vi.fn().mockResolvedValue(true),
}));

import { requestPermission } from './requestPermission';
import { requestPermission as repoRequestPermission } from '../repositories/libraryPersistence/requestPermission';

describe('requestPermission', () => {
    beforeEach(() => {
        vi.mocked(repoRequestPermission).mockClear();
    });

    it('delegates to the repository implementation', async () => {
        const result = await requestPermission('root-1');
        expect(result).toBe(true);
        expect(repoRequestPermission).toHaveBeenCalledWith('root-1');
    });
});
