import { describe, it, expect, vi, beforeEach } from 'vitest';

import { writeFileBytes } from '#/utils/desktopBridge';

import { desktopInvoke } from '../desktopInvoke';
import { getProjectDirectory } from '../getProjectDirectory';
import { isNativeAvailable } from '../helpers';
import { isNativeFileSystemAvailable } from '../isNativeFileSystemAvailable';

vi.mock('../helpers', () => ({
    isNativeAvailable: vi.fn(),
}));

vi.mock('../desktopInvoke', () => ({
    desktopInvoke: vi.fn(),
}));

vi.mock('#/utils/desktopBridge', () => ({
    writeFileBytes: vi.fn(),
}));

describe('nativeProjectFiles repository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('getProjectDirectory', () => {
        it('should return the documents path and create the directory when it is absent', async () => {
            vi.mocked(desktopInvoke).mockImplementation((cmd: string) => {
                if (cmd === 'get_home_dir') {
                    return Promise.resolve('/home/user');
                }
                if (cmd === 'list_directory') {
                    // Directory does not exist yet.
                    return Promise.reject(new Error('Not a directory'));
                }
                return Promise.resolve(undefined as never);
            });

            const dir = await getProjectDirectory();

            expect(dir).toBe('/home/user/Documents/Sourdaw Projects');
            expect(desktopInvoke).toHaveBeenCalledWith('get_home_dir');
            expect(desktopInvoke).toHaveBeenCalledWith('list_directory', {
                path: '/home/user/Documents/Sourdaw Projects',
            });
            expect(writeFileBytes).toHaveBeenCalledWith({
                path: '/home/user/Documents/Sourdaw Projects/.sourdaw-projects',
                bytes: new TextEncoder().encode('Sourdaw Projects Directory'),
            });
        });

        it('should not write a marker when the directory already exists', async () => {
            // Regression: a plain "get" must not write on every call. Previously
            // getProjectDirectory unconditionally wrote a hidden .sourdaw-projects
            // marker as a side effect, mutating read-only / CI temp dirs.
            vi.mocked(desktopInvoke).mockImplementation((cmd: string) => {
                if (cmd === 'get_home_dir') {
                    return Promise.resolve('/home/user' as never);
                }
                if (cmd === 'list_directory') {
                    // Directory already exists — resolve with an empty listing.
                    return Promise.resolve([] as never);
                }
                return Promise.resolve(undefined as never);
            });

            const dir = await getProjectDirectory();

            expect(dir).toBe('/home/user/Documents/Sourdaw Projects');
            expect(desktopInvoke).toHaveBeenCalledWith('list_directory', {
                path: '/home/user/Documents/Sourdaw Projects',
            });
            expect(writeFileBytes).not.toHaveBeenCalled();
        });

        it('should fallback to /tmp if home dir fails', async () => {
            vi.mocked(desktopInvoke).mockRejectedValue(new Error('fail'));

            const dir = await getProjectDirectory();
            expect(dir).toBe('/tmp/Documents/Sourdaw Projects');
        });
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
