import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { isTauriAvailable } from '../helpers';
import { tauriInvoke } from '../tauriInvoke';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('../helpers', () => ({
    isTauriAvailable: vi.fn(),
}));

describe('tauriInvoke', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should throw when Tauri is not available', async () => {
        vi.mocked(isTauriAvailable).mockReturnValue(false);

        await expect(tauriInvoke('read_audio_file', { path: '/tmp/project.sourdaw' })).rejects.toThrow(
            'Tauri not available'
        );
        expect(invoke).not.toHaveBeenCalled();
    });

    it('should delegate to Tauri invoke and return the typed result', async () => {
        const entries = [{ name: 'track.sourdaw', path: '/tmp/track.sourdaw', is_directory: false }];
        vi.mocked(isTauriAvailable).mockReturnValue(true);
        vi.mocked(invoke).mockResolvedValue(entries);

        const result = await tauriInvoke<Array<{ name: string; path: string; is_directory: boolean }>>(
            'list_directory',
            { path: '/tmp' }
        );

        expect(invoke).toHaveBeenCalledWith('list_directory', { path: '/tmp' });
        expect(result).toEqual(entries);
    });
});
