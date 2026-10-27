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

/** Owns one transactional picker writable. No Blob or retained OPFS download is created. */
export async function streamExportToBrowser(input: BrowserExportInput) {
    const writable = await openBrowserWritable(input);
    const drainState: ArchiveDrainState = { archiveBytes: 0 };
    let centralBytes = 22;
    let count = 0;
    let closed = false;
    let fileOpen = false;
    let abortPromise: Promise<void> | undefined;
    const emitted: Uint8Array[] = [];
    const names = new Set<string>();
    const completed = new Set<string>();
    const pairs = new Map<string, string>();
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
            const nameBytes = new TextEncoder().encode(name).length;
            if (++count > 0xffff || nameBytes > 0xffff || (!zip && count > 1)) {
                throw new Error('Export exceeds ZIP32 entry limits.');
            }
            centralBytes += 46 + nameBytes;
            if (zip && drainState.archiveBytes + 30 + nameBytes + 16 + centralBytes > ZIP32_MAX) {
                throw new Error('Export archive exceeds ZIP32 limits.');
            }
            names.add(name);
            fileOpen = true;
            const entry = zip ? new ZipPassThrough(name) : undefined;
            if (entry) {
                zip!.add(entry);
                await drain();
            }
            const writer = createExportByteWriter(
                input,
                writable,
                entry,
                drainState,
                centralBytes,
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
                    completed.add(name);
                },
            };
        },
        registerReportPair(audioName: string, reportName: string) {
            if (
                !input.requireReportPairs ||
                reportName !== `${audioName}.loudness.json` ||
                !completed.has(audioName) ||
                !completed.has(reportName) ||
                pairs.has(audioName)
            ) {
                throw new Error('Invalid WAV report pair.');
            }
            pairs.set(audioName, reportName);
        },
        async commit(onCommitBegin: () => void) {
            input.checkCancelled();
            if (fileOpen || count === 0 || closed) {
                throw new Error('Export has no completed files.');
            }
            if (
                input.requireReportPairs &&
                (!zip ||
                    pairs.size * 2 !== completed.size ||
                    [...completed].some((name) =>
                        name.endsWith('.wav') ? !pairs.has(name) : ![...pairs.values()].includes(name)
                    ))
            ) {
                throw new Error('WAV report pairs are incomplete.');
            }
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
