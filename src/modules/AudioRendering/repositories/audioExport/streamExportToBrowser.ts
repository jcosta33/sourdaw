import { Zip, ZipPassThrough } from 'fflate';

import { type ExportByteWriter } from '../../models/ExportAudioSource';

type WritableExportFile = {
    write: (bytes: Uint8Array) => Promise<void>;
    close: () => Promise<void>;
    abort: () => Promise<void>;
};
type SavePicker = (options: {
    suggestedName: string;
    types: { accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<WritableExportFile> }>;
const MAX_CHUNK = 1024 * 1024;
const ZIP32_MAX = 0xffffffff;

/** Owns one transactional picker writable. No Blob or retained OPFS download is created. */
export async function streamExportToBrowser(input: {
    suggestedName: string;
    extension: string;
    mime: string;
    archive: boolean;
    checkCancelled: () => void;
}) {
    const picker: unknown = Reflect.get(window, 'showSaveFilePicker');
    if (typeof picker !== 'function') {
        throw new TypeError(
            'Streaming export needs a browser with the Save File picker and writable file storage. Open Sourdaw in Chrome with file saving enabled.'
        );
    }
    // The API is absent from lib.dom. Its returned capability is checked before any render starts.
    const select = picker as SavePicker;
    const handle = await select({
        suggestedName: input.suggestedName,
        types: [{ accept: { [input.mime]: [input.extension] } }],
    });
    if (!handle || typeof handle.createWritable !== 'function') {
        throw new Error('Writable file storage is unavailable for streaming export.');
    }
    const writable = await handle.createWritable();
    if (
        !writable ||
        typeof writable.write !== 'function' ||
        typeof writable.close !== 'function' ||
        typeof writable.abort !== 'function'
    ) {
        throw new Error('Writable file storage is unavailable for streaming export.');
    }
    let archiveBytes = 0;
    let centralBytes = 22;
    let count = 0;
    let closed = false;
    let fileOpen = false;
    let failure: Error | undefined;
    const emitted: Uint8Array[] = [];
    const names = new Set<string>();
    let zip: Zip | undefined;
    if (input.archive) {
        zip = new Zip((error, bytes) => {
            if (error) {
                failure = error;
                return;
            }
            emitted.push(bytes);
        });
    }
    const drain = async () => {
        while (emitted.length > 0) {
            const bytes = emitted.shift()!;
            if (archiveBytes + bytes.length > ZIP32_MAX) {
                throw new Error('Export archive exceeds ZIP32 limits.');
            }
            archiveBytes += bytes.length;
            for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK) {
                input.checkCancelled();
                await writable.write(bytes.subarray(offset, offset + MAX_CHUNK));
            }
        }
        if (failure) {
            throw failure;
        }
    };
    return {
        async beginFile(name: string) {
            input.checkCancelled();
            if (closed || fileOpen || names.has(name) || /[\\/]/u.test(name)) {
                throw new Error('Invalid export entry order or name.');
            }
            const nameBytes = new TextEncoder().encode(name).length;
            if (++count > 0xffff || nameBytes > 0xffff || (!zip && count > 1)) {
                throw new Error('Export exceeds ZIP32 entry limits.');
            }
            centralBytes += 46 + nameBytes;
            if (zip && archiveBytes + 30 + nameBytes + 16 + centralBytes > ZIP32_MAX) {
                throw new Error('Export archive exceeds ZIP32 limits.');
            }
            names.add(name);
            fileOpen = true;
            const entry = zip ? new ZipPassThrough(name) : undefined;
            if (entry) {
                zip!.add(entry);
                await drain();
            }
            let entryBytes = 0;
            const writer: ExportByteWriter = {
                checkCancelled: input.checkCancelled,
                async write(bytes) {
                    input.checkCancelled();
                    if (!fileOpen || bytes.length > MAX_CHUNK) {
                        throw new Error('Invalid streaming export chunk.');
                    }
                    entryBytes += bytes.length;
                    if (
                        zip &&
                        (entryBytes > ZIP32_MAX || archiveBytes + bytes.length + 16 + centralBytes > ZIP32_MAX)
                    ) {
                        throw new Error('Export exceeds ZIP32 size limits.');
                    }
                    if (entry) {
                        entry.push(bytes);
                        await drain();
                    } else {
                        await writable.write(bytes);
                    }
                },
            };
            return {
                writer,
                async finish() {
                    input.checkCancelled();
                    if (entry) {
                        entry.push(new Uint8Array(), true);
                        await drain();
                    }
                    fileOpen = false;
                },
            };
        },
        async commit(onCommitBegin: () => void) {
            input.checkCancelled();
            if (fileOpen || count === 0 || closed) {
                throw new Error('Export has no completed files.');
            }
            if (zip) {
                zip.end();
                await drain();
            }
            input.checkCancelled();
            onCommitBegin();
            await writable.close();
            closed = true;
        },
        async abort() {
            if (closed) {
                return;
            }
            zip?.terminate();
            emitted.length = 0;
            await writable.abort();
            closed = true;
        },
    };
}
