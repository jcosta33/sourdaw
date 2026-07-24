import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { readTauriAudioFileBytes } from '../readTauriAudioFileBytes';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('readTauriAudioFileBytes', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should invoke read_file_bytes with the absolute path and return the raw response bytes', async () => {
        const expected = new Uint8Array([0, 128, 255]);
        vi.mocked(invoke).mockResolvedValue(expected.buffer);

        const bytes = await readTauriAudioFileBytes({ path: '/Users/jose/Samples/kick.wav' });

        expect(invoke).toHaveBeenCalledWith('read_file_bytes', { path: '/Users/jose/Samples/kick.wav' });
        expect([...bytes]).toEqual([0, 128, 255]);
    });

    it('should decode a legacy JSON number-array payload to the same bytes', async () => {
        vi.mocked(invoke).mockResolvedValue([0, 128, 255]);

        const bytes = await readTauriAudioFileBytes({ path: '/Users/jose/Samples/kick.wav' });

        expect([...bytes]).toEqual([0, 128, 255]);
    });

    it('should reject a payload that is neither a buffer nor a byte array', async () => {
        vi.mocked(invoke).mockResolvedValue('not bytes');

        await expect(readTauriAudioFileBytes({ path: '/tmp/kick.wav' })).rejects.toThrow(
            'read_file_bytes returned an unsupported payload'
        );
    });

    it('should reject byte values outside the u8 range', async () => {
        vi.mocked(invoke).mockResolvedValue([0, 256]);

        await expect(readTauriAudioFileBytes({ path: '/tmp/kick.wav' })).rejects.toThrow(
            'read_file_bytes returned an invalid byte payload'
        );
    });
});
