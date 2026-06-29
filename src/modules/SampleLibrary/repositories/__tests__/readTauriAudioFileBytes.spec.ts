import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readTauriAudioFileBytes } from '../readTauriAudioFileBytes';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('readTauriAudioFileBytes', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should invoke read_audio_file with the absolute path and return bytes', async () => {
        vi.mocked(invoke).mockResolvedValue([0, 128, 255]);

        const bytes = await readTauriAudioFileBytes({ path: '/Users/jose/Samples/kick.wav' });

        expect(invoke).toHaveBeenCalledWith('read_audio_file', { path: '/Users/jose/Samples/kick.wav' });
        expect([...bytes]).toEqual([0, 128, 255]);
    });

    it('should reject a non-array native payload', async () => {
        vi.mocked(invoke).mockResolvedValue('not bytes');

        await expect(readTauriAudioFileBytes({ path: '/tmp/kick.wav' })).rejects.toThrow(
            'read_audio_file returned a non-array payload'
        );
    });

    it('should reject byte values outside the u8 range', async () => {
        vi.mocked(invoke).mockResolvedValue([0, 256]);

        await expect(readTauriAudioFileBytes({ path: '/tmp/kick.wav' })).rejects.toThrow(
            'read_audio_file returned an invalid byte payload'
        );
    });
});
