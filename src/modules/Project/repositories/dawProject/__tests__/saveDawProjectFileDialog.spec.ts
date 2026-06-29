import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

import { saveDawProjectFileDialog } from '../saveDawProjectFileDialog';
import { writeDawProjectFile } from '../writeDawProjectFile';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(),
}));

describe('DAWproject native repositories', () => {
    beforeEach(() => {
        vi.mocked(invoke).mockReset();
        vi.mocked(save).mockReset();
    });

    it('should request a DAWproject save path with the suggested file name', async () => {
        vi.mocked(save).mockResolvedValue('/tmp/session.dawproject');

        const result = await saveDawProjectFileDialog({ suggestedName: 'session.dawproject' });

        expect(result).toBe('/tmp/session.dawproject');
        expect(save).toHaveBeenCalledWith({
            defaultPath: 'session.dawproject',
            filters: [{ name: 'DAWproject', extensions: ['dawproject'] }],
        });
    });

    it('should return null when the native save dialog is cancelled', async () => {
        vi.mocked(save).mockResolvedValue(null);

        const result = await saveDawProjectFileDialog({ suggestedName: 'session.dawproject' });

        expect(result).toBeNull();
    });

    it('should forward DAWproject bytes to the native filesystem writer', async () => {
        const bytes = new Uint8Array([1, 2, 3]);

        await writeDawProjectFile({ filePath: '/tmp/session.dawproject', bytes });

        expect(invoke).toHaveBeenCalledWith('write_audio_file', {
            path: '/tmp/session.dawproject',
            data: bytes,
        });
    });
});
