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
    it('requires completed, uniquely registered WAV/report pairs before closing the ZIP', async () => {
        const { chunks, writable } = createDestination();
        const batch = await streamExportToBrowser({ ...options, requireReportPairs: true });
        const start = vi.fn();
        for (const name of ['one.wav', 'two.wav']) {
            const audio = await batch.beginFile(name);
            await audio.writer.write(new Uint8Array([1]));
            await audio.finish();
            await expect(batch.commit(start)).rejects.toThrow('pairs are incomplete');
            const reportName = `${name}.loudness.json`;
            const report = await batch.beginFile(reportName);
            await report.writer.write(new Uint8Array([2]));
            expect(() => batch.registerReportPair(name, reportName)).toThrow('Invalid WAV report pair');
            await expect(batch.commit(start)).rejects.toThrow('no completed files');
            await report.finish();
            await expect(batch.commit(start)).rejects.toThrow('pairs are incomplete');
            expect(() => batch.registerReportPair(name, `${name}.json`)).toThrow('Invalid WAV report pair');
            batch.registerReportPair(name, reportName);
            expect(() => batch.registerReportPair(name, reportName)).toThrow('Invalid WAV report pair');
        }
        expect(start).not.toHaveBeenCalled();
        expect(writable.close).not.toHaveBeenCalled();
        await batch.commit(start);
        expect(start).toHaveBeenCalledOnce();
        expect(writable.close).toHaveBeenCalledOnce();
        expect(unzipSync(collect(chunks))).toEqual({
            'one.wav': new Uint8Array([1]),
            'one.wav.loudness.json': new Uint8Array([2]),
            'two.wav': new Uint8Array([1]),
            'two.wav.loudness.json': new Uint8Array([2]),
        });
    });

    it('requires an archive for WAV reports', async () => {
        const picker = vi.fn();
        vi.stubGlobal('showSaveFilePicker', picker);
        await expect(streamExportToBrowser({ ...options, archive: false, requireReportPairs: true })).rejects.toThrow(
            'WAV reports require an export archive'
        );
        expect(picker).not.toHaveBeenCalled();
    });

    it('keeps the WAV open until its final ZIP bytes drain before admitting the report', async () => {
        const { writable } = createDestination();
        const batch = await streamExportToBrowser({ ...options, requireReportPairs: true });
        const audio = await batch.beginFile('mix.wav');
        await audio.writer.write(new Uint8Array([1]));
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        writable.write.mockImplementationOnce(() => {
            entered.resolve();
            return release.promise;
        });
        const finishing = audio.finish();
        await entered.promise;
        await expect(batch.beginFile('mix.wav.loudness.json')).rejects.toThrow('Invalid export entry order');
        expect(() => batch.registerReportPair('mix.wav', 'mix.wav.loudness.json')).toThrow('Invalid WAV report pair');
        release.resolve();
        await finishing;
        const report = await batch.beginFile('mix.wav.loudness.json');
        await report.finish();
        batch.registerReportPair('mix.wav', 'mix.wav.loudness.json');
        await batch.commit(() => {});
        expect(writable.close).toHaveBeenCalledOnce();
    });

    it('keeps a failed report write uncompleted and aborts without closing', async () => {
        const { writable } = createDestination();
        const batch = await streamExportToBrowser({ ...options, requireReportPairs: true });
        const audio = await batch.beginFile('mix.wav');
        await audio.finish();
        const report = await batch.beginFile('mix.wav.loudness.json');
        writable.write.mockRejectedValueOnce(new Error('report disk full'));
        await expect(report.writer.write(new Uint8Array([2]))).rejects.toThrow('report disk full');
        expect(() => batch.registerReportPair('mix.wav', 'mix.wav.loudness.json')).toThrow('Invalid WAV report pair');
        await expect(batch.commit(() => {})).rejects.toThrow('no completed files');
        expect(writable.close).not.toHaveBeenCalled();
        await batch.abort();
        expect(writable.abort).toHaveBeenCalledOnce();
    });

    it('propagates paired close failure and keeps the browser transaction abortable', async () => {
        const { writable } = createDestination();
        writable.close.mockRejectedValueOnce(new Error('disk full at close'));
        const batch = await streamExportToBrowser({ ...options, requireReportPairs: true });
        for (const name of ['mix.wav', 'mix.wav.loudness.json']) {
            const entry = await batch.beginFile(name);
            await entry.finish();
        }
        batch.registerReportPair('mix.wav', 'mix.wav.loudness.json');
        await expect(batch.commit(() => {})).rejects.toThrow('disk full at close');
        await batch.abort();
        expect(writable.abort).toHaveBeenCalledOnce();
    });

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
    it('holds a ZIP producer behind a deferred sink write', async () => {
        const { writable } = createDestination();
        let releaseSink: () => void = () => {
            throw new Error('Sink write was not initialized');
        };
        const sinkWrite = new Promise<void>((resolve) => {
            releaseSink = resolve;
        });
        writable.write.mockImplementationOnce(() => sinkWrite);
        const batch = await streamExportToBrowser(options);
        const entry = await batch.beginFile('one.wav');
        let firstChunkFinished = false;
        let producerFinished = false;
        const writing = (async () => {
            await entry.writer.write(new Uint8Array([1, 2, 3]));
            firstChunkFinished = true;
            await entry.writer.write(new Uint8Array([4, 5, 6]));
            producerFinished = true;
        })();

        await vi.waitFor(() => expect(writable.write).toHaveBeenCalledTimes(1));
        const result = await Promise.race([
            writing.then(() => 'finished'),
            new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0)),
        ]);
        expect(result).toBe('pending');
        expect(firstChunkFinished).toBe(false);
        expect(producerFinished).toBe(false);

        releaseSink();
        await writing;
        expect(writable.write.mock.calls.length).toBeGreaterThan(1);
        await batch.abort();
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
