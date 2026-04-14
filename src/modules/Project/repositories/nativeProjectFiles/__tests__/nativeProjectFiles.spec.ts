import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getProjectDirectory } from '../getProjectDirectory';
import { isNativeFileSystemAvailable } from '../isNativeFileSystemAvailable';
import { tauriInvoke, isTauriAvailable } from '../helpers';

vi.mock('../helpers', () => ({
    tauriInvoke: vi.fn(),
    isTauriAvailable: vi.fn(),
}));

describe('nativeProjectFiles repository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('getProjectDirectory', () => {
        it('should return the documents path and attempt to create it', async () => {
            vi.mocked(tauriInvoke).mockResolvedValue('/home/user');
            
            const dir = await getProjectDirectory();
            
            expect(dir).toBe('/home/user/Documents/Sourdaw Projects');
            expect(tauriInvoke).toHaveBeenCalledWith('get_home_dir');
            expect(tauriInvoke).toHaveBeenCalledWith('write_audio_file', expect.anything());
        });

        it('should fallback to /tmp if home dir fails', async () => {
            vi.mocked(tauriInvoke).mockRejectedValue(new Error('fail'));
            
            const dir = await getProjectDirectory();
            expect(dir).toBe('/tmp/Documents/Sourdaw Projects');
        });
    });

    describe('isNativeFileSystemAvailable', () => {
        it('should return true if in Tauri', () => {
            vi.mocked(isTauriAvailable).mockReturnValue(true);
            expect(isNativeFileSystemAvailable()).toBe(true);
        });

        it('should return false if not in Tauri', () => {
            vi.mocked(isTauriAvailable).mockReturnValue(false);
            expect(isNativeFileSystemAvailable()).toBe(false);
        });
    });
});
