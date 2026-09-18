import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke as bridgeInvoke } from '#/utils/desktopBridge';

import { desktopInvoke } from '../desktopInvoke';
import { isNativeAvailable } from '../helpers';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn(),
}));

vi.mock('../helpers', () => ({
    isNativeAvailable: vi.fn(),
}));

describe('desktopInvoke', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should throw when the native backend is not available', async () => {
        vi.mocked(isNativeAvailable).mockReturnValue(false);

        await expect(desktopInvoke('read_audio_file', { path: '/tmp/project.sourdaw' })).rejects.toThrow(
            'Sourdaw desktop bridge is not available'
        );
        expect(bridgeInvoke).not.toHaveBeenCalled();
    });

    it('should delegate to the desktop bridge and return the typed result', async () => {
        const entries = [{ name: 'track.sourdaw', path: '/tmp/track.sourdaw', is_directory: false }];
        vi.mocked(isNativeAvailable).mockReturnValue(true);
        vi.mocked(bridgeInvoke).mockResolvedValue(entries);

        const result = await desktopInvoke<Array<{ name: string; path: string; is_directory: boolean }>>(
            'list_directory',
            { path: '/tmp' }
        );

        expect(bridgeInvoke).toHaveBeenCalledWith('list_directory', { path: '/tmp' });
        expect(result).toEqual(entries);
    });
});
