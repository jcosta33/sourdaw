import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isTauri as repoIsTauri } from '../../../repositories/nativeAIBridge/isTauri';
import { isTauri } from '../isTauri';

vi.mock('../../../repositories/nativeAIBridge/isTauri', () => ({
    isTauri: vi.fn(),
}));

describe('isTauri', () => {
    beforeEach(() => {
        vi.mocked(repoIsTauri).mockReset();
    });

    it('should return true when the repository detects a Tauri environment', () => {
        vi.mocked(repoIsTauri).mockReturnValue(true);
        expect(isTauri()).toBe(true);
        expect(repoIsTauri).toHaveBeenCalledTimes(1);
    });

    it('should return false when the repository does not detect Tauri', () => {
        vi.mocked(repoIsTauri).mockReturnValue(false);
        expect(isTauri()).toBe(false);
    });
});
