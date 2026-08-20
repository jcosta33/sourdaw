import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { readNativeLibrarySampleFile } from '../readNativeLibrarySampleFile';

type ReadNativeAudioFileBytes = (input: { path: string }) => Promise<Uint8Array>;

async function readFileBytes(file: File): Promise<number[]> {
    return [...new Uint8Array(await file.arrayBuffer())];
}

describe('readNativeLibrarySampleFile', () => {
    it('should build a POSIX root-relative path and return a File named from the relative path', async () => {
        const readNativeAudioFileBytes = vi.fn<ReadNativeAudioFileBytes>().mockResolvedValue(new Uint8Array([1, 2, 3]));
        injectDependencies(readNativeLibrarySampleFile, { readNativeAudioFileBytes });

        const file = await readNativeLibrarySampleFile({
            rootPath: '/Users/jose/Samples/',
            relativePath: 'Drums/Kick.wav',
            fallbackName: 'Kick',
        });

        expect(readNativeAudioFileBytes).toHaveBeenCalledWith({ path: '/Users/jose/Samples/Drums/Kick.wav' });
        expect(file.name).toBe('Kick.wav');
        expect(await readFileBytes(file)).toEqual([1, 2, 3]);
    });

    it('should build a Windows root-relative path and normalize relative separators', async () => {
        const readNativeAudioFileBytes = vi.fn<ReadNativeAudioFileBytes>().mockResolvedValue(new Uint8Array([4, 5]));
        injectDependencies(readNativeLibrarySampleFile, { readNativeAudioFileBytes });

        const file = await readNativeLibrarySampleFile({
            rootPath: 'C:\\Users\\jose\\Samples\\',
            relativePath: '/Loops/Kicks/Kick 01.wav',
            fallbackName: 'Kick 01',
        });

        expect(readNativeAudioFileBytes).toHaveBeenCalledWith({
            path: 'C:\\Users\\jose\\Samples\\Loops\\Kicks\\Kick 01.wav',
        });
        expect(file.name).toBe('Kick 01.wav');
        expect(await readFileBytes(file)).toEqual([4, 5]);
    });

    it('should propagate repository failures so presentation keeps its existing warning path', async () => {
        const readNativeAudioFileBytes = vi
            .fn<ReadNativeAudioFileBytes>()
            .mockRejectedValue(new Error('native read failed'));
        injectDependencies(readNativeLibrarySampleFile, { readNativeAudioFileBytes });

        await expect(
            readNativeLibrarySampleFile({
                rootPath: '/Users/jose/Samples',
                relativePath: 'missing.wav',
                fallbackName: 'Missing',
            })
        ).rejects.toThrow('native read failed');
    });
});
