import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isNativeAvailable } from '../helpers';
import { isNativeFileSystemAvailable } from '../isNativeFileSystemAvailable';

vi.mock('../helpers', () => ({
    isNativeAvailable: vi.fn(),
}));

describe('nativeProjectFiles repository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('isNativeFileSystemAvailable', () => {
        it('should return true if in the desktop app', () => {
            vi.mocked(isNativeAvailable).mockReturnValue(true);
            expect(isNativeFileSystemAvailable()).toBe(true);
        });

        it('should return false if not in the desktop app', () => {
            vi.mocked(isNativeAvailable).mockReturnValue(false);
            expect(isNativeFileSystemAvailable()).toBe(false);
        });
    });
});
