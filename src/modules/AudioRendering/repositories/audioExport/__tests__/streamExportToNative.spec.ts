import { beforeEach, describe, expect, it, vi } from 'vitest';

import { streamExportToNative } from '../streamExportToNative';

const native = vi.hoisted(() => ({
    begin: vi.fn(async (_path: string) => 'opaque-token'), append: vi.fn(async () => {}),
    seal: vi.fn(async () => {}), commit: vi.fn(async () => {}), abort: vi.fn(async () => {}),
}));
vi.mock('#/utils/desktopBridge', () => ({
    beginExportFile: native.begin, appendExportFile: native.append, sealExportFile: native.seal,
    commitExportFiles: native.commit, abortExportFiles: native.abort,
    desktopPathJoin: async (directory: string, name: string) => `${directory}/${name}`,
}));
beforeEach(() => vi.clearAllMocks());
describe('native export transaction adapter', () => {
    it('stages all formats, seals each, then commits the exact batch once', async () => {
        let index = 0;
        native.begin.mockImplementation(async () => `token-${++index}`);
        const batch = await streamExportToNative({ selectedFilePath: '/picked/mix.wav', checkCancelled: () => {} });
        for (const name of ['mix.wav', 'mix.mp3', 'mix.flac']) {
            const entry = await batch.beginFile(name); await entry.writer.write(new Uint8Array([1])); await entry.finish();
        }
        expect(native.commit).not.toHaveBeenCalled();
        const start = vi.fn(); await batch.commit(start);
        expect(start).toHaveBeenCalledTimes(1);
        expect(native.begin.mock.calls.map(([path]) => path)).toEqual(['/picked/mix.wav', '/picked/mix.mp3', '/picked/mix.flac']);
        expect(native.commit).toHaveBeenCalledWith(['token-1', 'token-2', 'token-3']);
        await batch.abort(); expect(native.abort).not.toHaveBeenCalled();
    });
    it('aborts every admitted token after a late append failure', async () => {
        native.begin.mockResolvedValue('only-owned-token');
        native.append.mockRejectedValueOnce(new Error('disk full'));
        const batch = await streamExportToNative({ directoryPath: '/picked', checkCancelled: () => {} });
        const entry = await batch.beginFile('stem.wav');
        await expect(entry.writer.write(new Uint8Array([1]))).rejects.toThrow('disk full');
        await batch.abort();
        expect(native.abort).toHaveBeenCalledWith(['only-owned-token']); expect(native.commit).not.toHaveBeenCalled();
    });
});
