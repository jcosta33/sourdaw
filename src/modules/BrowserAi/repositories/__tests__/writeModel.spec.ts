import { afterEach, describe, expect, it, vi } from 'vitest';

import { createModelWritable } from '../createModelWritable';
import { writeModel } from '../writeModel';

vi.mock('../createModelWritable', () => ({ createModelWritable: vi.fn() }));

afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(createModelWritable).mockReset();
});

describe('writeModel', () => {
    it('aborts the writable when writing fails', async () => {
        const writeError = new Error('write failed');
        const writable = {
            write: vi.fn(() => Promise.reject(writeError)),
            close: vi.fn(() => Promise.resolve()),
            abort: vi.fn(() => Promise.resolve()),
        } as unknown as FileSystemWritableFileStream;
        vi.mocked(createModelWritable).mockResolvedValue(writable);

        await expect(writeModel({ family: 'ddsp', modelId: 'violin', data: new ArrayBuffer(4) })).rejects.toBe(
            writeError
        );
        expect(writable.abort).toHaveBeenCalledOnce();
    });

    it('aborts a pending write when its signal is cancelled', async () => {
        let resolveWrite: (() => void) | undefined;
        const writePromise = new Promise<void>((resolve) => {
            resolveWrite = resolve;
        });
        const writable = {
            write: vi.fn(() => writePromise),
            close: vi.fn(() => Promise.resolve()),
            abort: vi.fn(() => Promise.resolve()),
        } as unknown as FileSystemWritableFileStream;
        vi.mocked(createModelWritable).mockResolvedValue(writable);
        const controller = new AbortController();

        const promise = writeModel({
            family: 'ddsp',
            modelId: 'violin',
            data: new ArrayBuffer(4),
            signal: controller.signal,
        });
        await vi.waitFor(() => expect(writable.write).toHaveBeenCalledOnce());
        controller.abort();
        resolveWrite?.();

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(writable.abort).toHaveBeenCalledOnce();
        expect(writable.close).not.toHaveBeenCalled();
    });
});
