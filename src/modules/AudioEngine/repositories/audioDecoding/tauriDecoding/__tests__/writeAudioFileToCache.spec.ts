import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { isTauri } from '#/utils/tauriBridge';

import { writeAudioFileToCache } from '../writeAudioFileToCache';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
}));

describe('writeAudioFileToCache', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isTauri).mockReturnValue(true);
    });

    it('should skip cache writes in browser without invoking Tauri', async () => {
        const contents = new Uint8Array([0]).buffer;
        vi.mocked(isTauri).mockReturnValue(false);

        const result = await writeAudioFileToCache({ fileName: 'track.wav', contents });

        expect(result).toEqual({ kind: 'skipped' });
        expect(invoke).not.toHaveBeenCalled();
    });

    it('should write bytes to the native cache path and return the path', async () => {
        const contents = new Uint8Array([1, 2, 3]).buffer;
        vi.mocked(invoke).mockResolvedValueOnce('/app/models').mockResolvedValueOnce(undefined);

        const result = await writeAudioFileToCache({ fileName: 'track.wav', contents });

        expect(invoke).toHaveBeenNthCalledWith(1, 'get_model_dir');
        expect(invoke).toHaveBeenNthCalledWith(2, 'write_audio_file', {
            path: '/app/models/../cache/track.wav',
            data: new Uint8Array(contents),
        });
        expect(result).toEqual({ kind: 'ready', path: '/app/models/../cache/track.wav' });
    });

    it('should strip POSIX traversal components before writing to the cache path', async () => {
        const contents = new Uint8Array([4, 5, 6]).buffer;
        vi.mocked(invoke).mockResolvedValueOnce('/app/models').mockResolvedValueOnce(undefined);

        await writeAudioFileToCache({ fileName: '../../../../etc/passwd', contents });

        expect(invoke).toHaveBeenNthCalledWith(2, 'write_audio_file', {
            path: '/app/models/../cache/passwd',
            data: new Uint8Array(contents),
        });
    });

    it('should strip Windows traversal components before writing to the cache path', async () => {
        const contents = new Uint8Array([7, 8, 9]).buffer;
        vi.mocked(invoke).mockResolvedValueOnce('/app/models').mockResolvedValueOnce(undefined);

        await writeAudioFileToCache({ fileName: '..\\..\\windows\\system32\\evil.wav', contents });

        expect(invoke).toHaveBeenNthCalledWith(2, 'write_audio_file', {
            path: '/app/models/../cache/evil.wav',
            data: new Uint8Array(contents),
        });
    });

    it('should use a safe default for pure-dot or empty names', async () => {
        const contents = new Uint8Array([10, 11, 12]).buffer;
        vi.mocked(invoke).mockResolvedValueOnce('/app/models').mockResolvedValueOnce(undefined);

        await writeAudioFileToCache({ fileName: '..', contents });

        expect(invoke).toHaveBeenNthCalledWith(2, 'write_audio_file', {
            path: '/app/models/../cache/audio-file',
            data: new Uint8Array(contents),
        });
    });
});
