import { crc32 } from 'node:zlib';

import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamExportToBrowser } from '../streamExportToBrowser';

function createDestination() {
    const chunks: Uint8Array[] = [];
    const writable = {
        write: vi.fn(async (bytes: Uint8Array) => {
            chunks.push(bytes.slice());
        }),
        close: vi.fn(async () => {}),
        abort: vi.fn(async () => {}),
    };
    vi.stubGlobal('showSaveFilePicker', async () => ({ createWritable: async () => writable }));
    return { chunks, writable };
}
function collect(chunks: Uint8Array[]) {
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}
const options = {
    suggestedName: 'stems.zip',
    extension: '.zip',
    mime: 'application/zip',
    archive: true,
    checkCancelled: () => {},
};

afterEach(() => vi.unstubAllGlobals());
describe('browser export transaction', () => {
    it('emits real ZIP32 entries with matching local and central CRCs and stable order', async () => {
        const { chunks, writable } = createDestination();
        const batch = await streamExportToBrowser(options);
        const files = { 'one.wav': new Uint8Array([1, 2, 3]), 'two.flac': new Uint8Array([4, 5, 6, 7]) };
        for (const [name, bytes] of Object.entries(files)) {
            const entry = await batch.beginFile(name);
            await entry.writer.write(bytes);
            await entry.finish();
        }
        const commit = vi.fn();
        await batch.commit(commit);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(writable.close).toHaveBeenCalledTimes(1);
        const bytes = collect(chunks);
        expect(unzipSync(bytes)).toEqual(files);
        const view = new DataView(bytes.buffer);
        const end = bytes.length - 22;
        expect(view.getUint32(end, true)).toBe(0x06054b50);
        expect(view.getUint16(end + 10, true)).toBe(2);
        let central = view.getUint32(end + 16, true);
        const names: string[] = [];
        for (const [name, source] of Object.entries(files)) {
            expect(view.getUint32(central, true)).toBe(0x02014b50);
            expect(view.getUint32(central + 16, true)).toBe(crc32(source));
            expect(view.getUint32(central + 20, true)).toBe(source.length);
            const local = view.getUint32(central + 42, true);
            expect(view.getUint32(local, true)).toBe(0x04034b50);
            const nameLength = view.getUint16(central + 28, true);
            names.push(new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + nameLength)));
            const payload = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
            expect(bytes.subarray(payload, payload + source.length)).toEqual(source);
            const descriptor = payload + source.length;
            expect(view.getUint32(descriptor, true)).toBe(0x08074b50);
            expect(view.getUint32(descriptor + 4, true)).toBe(crc32(source));
            central += 46 + nameLength + view.getUint16(central + 30, true) + view.getUint16(central + 32, true);
            expect(names.at(-1)).toBe(name);
        }
        expect(names).toEqual(Object.keys(files));
        await batch.abort();
        expect(writable.abort).not.toHaveBeenCalled();
    });
    it('awaits each sink write before a producer can push another block', async () => {
        const { writable } = createDestination();
        let drain: () => void = () => {};
        writable.write.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    drain = resolve;
                })
        );
        const batch = await streamExportToBrowser({ ...options, archive: false });
        const entry = await batch.beginFile('one.wav');
        let finished = false;
        const writing = entry.writer.write(new Uint8Array(1024)).then(() => {
            finished = true;
        });
        expect(finished).toBe(false);
        drain();
        await writing;
        expect(finished).toBe(true);
        await batch.abort();
        expect(writable.close).not.toHaveBeenCalled();
    });
    it('aborts on cancellation and leaves the previously committed destination intact', async () => {
        let cancelled = false;
        let bytes = new Uint8Array([9, 9]);
        let staged = new Uint8Array();
        const writable = {
            write: async (chunk: Uint8Array) => {
                staged = chunk.slice();
            },
            close: async () => {
                bytes = staged;
            },
            abort: vi.fn(async () => {
                staged = new Uint8Array();
            }),
        };
        vi.stubGlobal('showSaveFilePicker', async () => ({ createWritable: async () => writable }));
        const batch = await streamExportToBrowser({
            ...options,
            archive: false,
            checkCancelled: () => {
                if (cancelled) {
                    throw new Error('Export cancelled');
                }
            },
        });
        const entry = await batch.beginFile('one.wav');
        await entry.writer.write(new Uint8Array([1, 2]));
        cancelled = true;
        await expect(entry.finish()).rejects.toThrow('cancelled');
        await batch.abort();
        expect(bytes).toEqual(new Uint8Array([9, 9]));
        expect(writable.abort).toHaveBeenCalledTimes(1);
    });
    it('refuses missing picker capability before any render', async () => {
        vi.stubGlobal('showSaveFilePicker', undefined);
        await expect(streamExportToBrowser(options)).rejects.toThrow('Save File picker');
    });
});
