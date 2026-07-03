import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getDroppedCrumbsFilePath } from '../get-dropped-crumbs-file-path';

const mocks = vi.hoisted(() => ({
    tauriInvoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    tauriInvoke: mocks.tauriInvoke,
}));

function createFileWithPath(name: string, path: string): File {
    const file = new File([], name);
    Object.defineProperty(file, 'path', { value: path });
    return file;
}

describe('getDroppedCrumbsFilePath', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tauriInvoke.mockResolvedValue(undefined);
    });

    it('should prefer the desktop path attached to a dropped file', async () => {
        const file = createFileWithPath('loop.wav', '/Users/me/Loops/loop.wav');

        await expect(getDroppedCrumbsFilePath({ file })).resolves.toBe('/Users/me/Loops/loop.wav');
        expect(mocks.tauriInvoke).not.toHaveBeenCalled();
    });

    it('should write dropped bytes to a unique Crumbs IPC temp path when no desktop path exists', async () => {
        const firstFile = new File([new Uint8Array([1, 2, 3])], '../Loops/loop.wav', { type: 'audio/wav' });
        const secondFile = new File([new Uint8Array([4, 5, 6])], '../Loops/loop.wav', { type: 'audio/wav' });

        const firstPath = await getDroppedCrumbsFilePath({ file: firstFile });
        const secondPath = await getDroppedCrumbsFilePath({ file: secondFile });

        expect(firstPath).toMatch(/^crumbs-drops\/[a-zA-Z0-9._-]+\/loop\.wav$/);
        expect(secondPath).toMatch(/^crumbs-drops\/[a-zA-Z0-9._-]+\/loop\.wav$/);
        expect(firstPath).not.toBe('loop.wav');
        expect(secondPath).not.toBe('loop.wav');
        expect(firstPath).not.toBe(secondPath);
        expect(firstPath).not.toContain('..');

        expect(mocks.tauriInvoke).toHaveBeenNthCalledWith(1, 'write_audio_file', {
            path: firstPath,
            data: [1, 2, 3],
        });
        expect(mocks.tauriInvoke).toHaveBeenNthCalledWith(2, 'write_audio_file', {
            path: secondPath,
            data: [4, 5, 6],
        });
    });
});
