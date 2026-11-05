import { Zip, ZipPassThrough } from 'fflate';

import { type ExportByteWriter } from '../../models/ExportAudioSource';

import { createWavReportPairLedger } from './wavReportPairLedger';

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

type BrowserExportInput = {
    suggestedName: string;
    extension: string;
    mime: string;
    archive: boolean;
    requireReportPairs?: boolean;
    checkCancelled: () => void;
    signal?: AbortSignal;
};

function awaitSinkWrite(write: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) {
        return write;
    }
    if (signal.aborted) {
        return Promise.reject(new Error('Export cancelled'));
    }

    return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            reject(new Error('Export cancelled'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        write.then(
            () => {
                signal.removeEventListener('abort', onAbort);
                resolve();
            },
            (error: unknown) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            }
        );
    });
}

async function openBrowserWritable(input: BrowserExportInput): Promise<WritableExportFile> {
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
    return writable;
}

type ArchiveDrainState = { archiveBytes: number; failure?: Error };

async function drainZipOutput(
    emitted: Uint8Array[],
    writable: WritableExportFile,
    checkCancelled: () => void,
    state: ArchiveDrainState,
    signal?: AbortSignal
): Promise<void> {
    while (emitted.length > 0) {
        const bytes = emitted.shift()!;
        if (state.archiveBytes + bytes.length > ZIP32_MAX) {
            throw new Error('Export archive exceeds ZIP32 limits.');
        }
        state.archiveBytes += bytes.length;
        for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK) {
            checkCancelled();
            await awaitSinkWrite(writable.write(bytes.subarray(offset, offset + MAX_CHUNK)), signal);
        }
    }
    if (state.failure) {
        throw state.failure;
    }
}

function createZipOutput(emitted: Uint8Array[], state: ArchiveDrainState): Zip {
    return new Zip((error, bytes) => {
        if (error) {
            state.failure = error;
            return;
        }
        emitted.push(bytes);
    });
}

function createExportByteWriter(
    input: BrowserExportInput,
    writable: WritableExportFile,
    entry: ZipPassThrough | undefined,
    drainState: ArchiveDrainState,
    centralBytes: number,
    drain: () => Promise<void>,
    isFileOpen: () => boolean
): ExportByteWriter {
    let entryBytes = 0;
    return {
        checkCancelled: input.checkCancelled,
        async write(bytes) {
            input.checkCancelled();
            if (!isFileOpen() || bytes.length > MAX_CHUNK) {
                throw new Error('Invalid streaming export chunk.');
            }
            entryBytes += bytes.length;
            if (
                entry &&
                (entryBytes > ZIP32_MAX || drainState.archiveBytes + bytes.length + 16 + centralBytes > ZIP32_MAX)
            ) {
                throw new Error('Export exceeds ZIP32 size limits.');
            }
            if (entry) {
                entry.push(bytes);
                await drain();
            } else {
                await awaitSinkWrite(writable.write(bytes), input.signal);
            }
        },
    };
}

async function addArchiveEntry(
    zip: Zip | undefined,
    name: string,
    drain: () => Promise<void>
): Promise<ZipPassThrough | undefined> {
    if (!zip) {
        return undefined;
    }
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    await drain();
    return entry;
}

type ArchiveEntries = { count: number; centralBytes: number };

/** Admit one more entry within the ZIP32 entry count, name length and archive size limits. */
function admitArchiveEntry(
    entries: ArchiveEntries,
    name: string,
    archived: boolean,
    archiveBytes: number
): ArchiveEntries {
    const nameBytes = new TextEncoder().encode(name).length;
    const count = entries.count + 1;
    if (count > 0xffff || nameBytes > 0xffff || (!archived && count > 1)) {
        throw new Error('Export exceeds ZIP32 entry limits.');
    }
    const centralBytes = entries.centralBytes + 46 + nameBytes;
    if (archived && archiveBytes + 30 + nameBytes + 16 + centralBytes > ZIP32_MAX) {
        throw new Error('Export archive exceeds ZIP32 limits.');
    }
    return { count, centralBytes };
}

/** Owns one transactional picker writable. No Blob or retained OPFS download is created. */
export async function streamExportToBrowser(input: BrowserExportInput) {
    if (input.requireReportPairs && !input.archive) {
        throw new Error('WAV reports require an export archive.');
    }
    const writable = await openBrowserWritable(input);
    const drainState: ArchiveDrainState = { archiveBytes: 0 };
    let entries: ArchiveEntries = { count: 0, centralBytes: 22 };
    let closed = false;
    let fileOpen = false;
    let abortPromise: Promise<void> | undefined;
    const emitted: Uint8Array[] = [];
    const names = new Set<string>();
    const reportPairs = createWavReportPairLedger(input.requireReportPairs === true);
    const zip = input.archive ? createZipOutput(emitted, drainState) : undefined;
    const drain = () => drainZipOutput(emitted, writable, input.checkCancelled, drainState, input.signal);
    const abort = (): Promise<void> => {
        if (closed) {
            return Promise.resolve();
        }
        if (abortPromise) {
            return abortPromise;
        }
        zip?.terminate();
        emitted.length = 0;
        abortPromise = writable.abort().then(() => {
            closed = true;
        });
        return abortPromise;
    };
    const abortOnSignal = () => {
        void abort().catch(() => {});
    };
    input.signal?.addEventListener('abort', abortOnSignal, { once: true });
    if (input.signal?.aborted) {
        await abort();
        throw new Error('Export cancelled');
    }
    return {
        async beginFile(name: string) {
            input.checkCancelled();
            if (closed || fileOpen || names.has(name) || /[\\/]/u.test(name)) {
                throw new Error('Invalid export entry order or name.');
            }
            entries = admitArchiveEntry(entries, name, zip !== undefined, drainState.archiveBytes);
            names.add(name);
            fileOpen = true;
            const entry = await addArchiveEntry(zip, name, drain);
            const writer = createExportByteWriter(
                input,
                writable,
                entry,
                drainState,
                entries.centralBytes,
                drain,
                () => fileOpen
            );
            return {
                writer,
                async finish() {
                    input.checkCancelled();
                    if (entry) {
                        entry.push(new Uint8Array(), true);
                        await drain();
                    }
                    fileOpen = false;
                    reportPairs.complete(name, name);
                },
            };
        },
        registerReportPair(audioName: string, reportName: string) {
            input.checkCancelled();
            if (closed) {
                throw new Error('Invalid WAV report pair.');
            }
            reportPairs.register(audioName, reportName);
        },
        async commit(onCommitBegin: () => void) {
            input.checkCancelled();
            if (fileOpen || entries.count === 0 || closed) {
                throw new Error('Export has no completed files.');
            }
            // Required pairs always have an archive: the adapter refuses them without one before opening.
            reportPairs.assertComplete();
            if (zip) {
                zip.end();
                await drain();
            }
            input.checkCancelled();
            onCommitBegin();
            await writable.close();
            closed = true;
            input.signal?.removeEventListener('abort', abortOnSignal);
        },
        async abort() {
            input.signal?.removeEventListener('abort', abortOnSignal);
            await abort();
        },
    };
}
