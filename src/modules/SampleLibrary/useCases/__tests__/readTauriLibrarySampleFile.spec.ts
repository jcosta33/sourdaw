import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { readTauriLibrarySampleFile } from '../readTauriLibrarySampleFile';

type ReadTauriAudioFileBytes = (input: { path: string }) => Promise<Uint8Array>;

async function readFileBytes(file: File): Promise<number[]> {
    return [...new Uint8Array(await file.arrayBuffer())];
}

describe('readTauriLibrarySampleFile', () => {
    it('should build a POSIX root-relative path and return a File named from the relative path', async () => {
        const readTauriAudioFileBytes = vi.fn<ReadTauriAudioFileBytes>().mockResolvedValue(new Uint8Array([1, 2, 3]));
        injectDependencies(readTauriLibrarySampleFile, { readTauriAudioFileBytes });

        const file = await readTauriLibrarySampleFile({
            rootPath: '/Users/jose/Samples/',
            relativePath: 'Drums/Kick.wav',
            fallbackName: 'Kick',
        });

        expect(readTauriAudioFileBytes).toHaveBeenCalledWith({ path: '/Users/jose/Samples/Drums/Kick.wav' });
        expect(file.name).toBe('Kick.wav');
        expect(await readFileBytes(file)).toEqual([1, 2, 3]);
    });

    it('should build a Windows root-relative path and normalize relative separators', async () => {
        const readTauriAudioFileBytes = vi.fn<ReadTauriAudioFileBytes>().mockResolvedValue(new Uint8Array([4, 5]));
        injectDependencies(readTauriLibrarySampleFile, { readTauriAudioFileBytes });

        const file = await readTauriLibrarySampleFile({
            rootPath: 'C:\\Users\\jose\\Samples\\',
            relativePath: '/Loops/Kicks/Kick 01.wav',
            fallbackName: 'Kick 01',
        });

        expect(readTauriAudioFileBytes).toHaveBeenCalledWith({
            path: 'C:\\Users\\jose\\Samples\\Loops\\Kicks\\Kick 01.wav',
        });
        expect(file.name).toBe('Kick 01.wav');
        expect(await readFileBytes(file)).toEqual([4, 5]);
    });

    it('should propagate repository failures so presentation keeps its existing warning path', async () => {
        const readTauriAudioFileBytes = vi
            .fn<ReadTauriAudioFileBytes>()
            .mockRejectedValue(new Error('native read failed'));
        injectDependencies(readTauriLibrarySampleFile, { readTauriAudioFileBytes });

        await expect(
            readTauriLibrarySampleFile({
                rootPath: '/Users/jose/Samples',
                relativePath: 'missing.wav',
                fallbackName: 'Missing',
            })
        ).rejects.toThrow('native read failed');
    });
});
