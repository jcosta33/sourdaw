import { extractSingleGuardedZipEntry } from '#/infra/archive/extractSingleGuardedZipEntry';

import {
    type ModelStorageTransferMessage,
    type ModelStorageWorkerRequest,
    type ModelStorageWorkerResponse,
} from '../models/ModelStorageWorkerProtocol';

const MODELS_DIRECTORY = 'models';
const RENDERS_DIRECTORY = 'renders';
const READ_CHUNK_BYTES = 4 * 1024 * 1024;
const TEMPORARY_MODEL_PREFIX = '.sourdaw-';
const TEMPORARY_MODEL_SUFFIX = '.partial';
const MODEL_LOCK_PREFIX = 'sourdaw:browser-ai:model-storage:model:';
const PARTIAL_LOCK_PREFIX = 'sourdaw:browser-ai:model-storage:partial:';

type SyncAccessHandle = {
    close: () => void;
    flush: () => void;
    getSize: () => number;
    read: (buffer: ArrayBufferView, options?: { at?: number }) => number;
    truncate: (size: number) => void;
    write: (buffer: ArrayBufferView, options?: { at?: number }) => number;
};

type ReadableSyncFileHandle = FileSystemFileHandle & {
    createSyncAccessHandle: (options: { mode: 'read-only' | 'readwrite' }) => Promise<SyncAccessHandle>;
};

type MovableSyncFileHandle = ReadableSyncFileHandle & {
    move: (destination: FileSystemDirectoryHandle, name: string) => Promise<void>;
};

type WriteSession = {
    access: SyncAccessHandle | null;
    abortController: AbortController;
    archive: boolean;
    directory: FileSystemDirectoryHandle;
    expectedSha256?: string;
    expectedSizeBytes?: number;
    file: MovableSyncFileHandle;
    fileName: string;
    modelId: string;
    modelLease: ModelStorageLockLease;
    offset: number;
    partialLease: ModelStorageLockLease;
    temporaryName: string;
};

type ModelStorageLockLease = {
    release: () => Promise<void>;
};

type ModelStorageLockPort = {
    acquireExclusive: (name: string) => Promise<ModelStorageLockLease>;
    tryAcquireExclusive: (name: string) => Promise<ModelStorageLockLease | null>;
};

type CreateModelStorageRequestHandlerInput = {
    getRoot: () => Promise<FileSystemDirectoryHandle>;
    postResponse: (response: ModelStorageWorkerResponse) => void;
    sha256?: (bytes: ArrayBuffer) => Promise<string>;
    extractArchive?: (input: {
        bytes: Uint8Array<ArrayBuffer>;
        suffix: string;
        signal?: AbortSignal;
    }) => Promise<{ path: string; data: Uint8Array<ArrayBuffer> }>;
    locks?: ModelStorageLockPort;
};

function requireBrowserLockManager(): LockManager {
    if (typeof navigator === 'undefined' || !navigator.locks) {
        throw new TypeError('Current Chromium Web Locks support is required for model storage');
    }
    return navigator.locks;
}

function requestBrowserLock(name: string, ifAvailable: boolean): Promise<ModelStorageLockLease | null> {
    return new Promise<ModelStorageLockLease | null>((resolve, reject) => {
        let releaseHold: (() => void) | undefined;
        const hold = new Promise<void>((resolve) => {
            releaseHold = resolve;
        });
        let acquired = false;
        const request = requireBrowserLockManager().request(
            name,
            { mode: 'exclusive', ...(ifAvailable ? { ifAvailable: true } : {}) },
            async (lock) => {
                acquired = true;
                if (lock === null) {
                    resolve(null);
                    return;
                }
                resolve({
                    async release() {
                        releaseHold?.();
                        await request;
                    },
                });
                await hold;
            }
        );
        void request.catch((error: unknown) => {
            if (!acquired) {
                reject(error);
            }
        });
    });
}

const browserLocks: ModelStorageLockPort = {
    async acquireExclusive(name) {
        const lease = await requestBrowserLock(name, false);
        if (lease === null) {
            throw new Error(`Failed to acquire required model storage lock: ${name}`);
        }
        return lease;
    },
    tryAcquireExclusive: (name) => requestBrowserLock(name, true),
};

function isNotFoundError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'NotFoundError';
}

function getTemporaryWriteId(name: string): string | null {
    if (!name.startsWith(TEMPORARY_MODEL_PREFIX) || !name.endsWith(TEMPORARY_MODEL_SUFFIX)) {
        return null;
    }
    return name.slice(TEMPORARY_MODEL_PREFIX.length, -TEMPORARY_MODEL_SUFFIX.length);
}

function modelLockName(input: { family: string; modelId: string }): string {
    return `${MODEL_LOCK_PREFIX}${JSON.stringify([input.family, input.modelId])}`;
}

function partialLockName(writeId: string): string {
    return `${PARTIAL_LOCK_PREFIX}${JSON.stringify(writeId)}`;
}

function serializeError(error: unknown): { name: string; message: string } {
    if (error instanceof Error || error instanceof DOMException) {
        return { name: error.name, message: error.message };
    }
    return { name: 'Error', message: String(error) };
}

function isReadableSyncFileHandle(handle: FileSystemFileHandle): handle is ReadableSyncFileHandle {
    return typeof Reflect.get(handle, 'createSyncAccessHandle') === 'function';
}

function requireReadableSyncFileHandle(handle: FileSystemFileHandle): ReadableSyncFileHandle {
    if (!isReadableSyncFileHandle(handle)) {
        throw new TypeError('Current Chromium OPFS sync access support is required');
    }
    return handle;
}

function isMovableSyncFileHandle(handle: ReadableSyncFileHandle): handle is MovableSyncFileHandle {
    return typeof Reflect.get(handle, 'move') === 'function';
}

function requireMovableSyncFileHandle(handle: FileSystemFileHandle): MovableSyncFileHandle {
    const readable = requireReadableSyncFileHandle(handle);
    if (!isMovableSyncFileHandle(readable)) {
        throw new TypeError('Current Chromium OPFS file move support is required');
    }
    return readable;
}

async function defaultSha256(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function resolveModelLocation(
    root: FileSystemDirectoryHandle,
    input: { family: string; modelId: string },
    create: boolean
): Promise<{ directory: FileSystemDirectoryHandle; fileName: string }> {
    const models = await root.getDirectoryHandle(MODELS_DIRECTORY, { create });
    const segments = `${input.family}/${input.modelId}`.split('/').filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) {
        throw new TypeError('Model storage path must include a file name');
    }
    let directory = models;
    for (const segment of segments) {
        directory = await directory.getDirectoryHandle(segment, { create });
    }
    return { directory, fileName };
}

async function readAll(file: ReadableSyncFileHandle, expectedSizeBytes?: number): Promise<ArrayBuffer | null> {
    const access = await file.createSyncAccessHandle({ mode: 'read-only' });
    try {
        const size = access.getSize();
        if (expectedSizeBytes !== undefined && size !== expectedSizeBytes) {
            return null;
        }
        const output = new Uint8Array(size);
        let offset = 0;
        while (offset < output.byteLength) {
            const end = Math.min(offset + READ_CHUNK_BYTES, output.byteLength);
            const bytesRead = access.read(output.subarray(offset, end), { at: offset });
            if (bytesRead <= 0) {
                throw new Error(`OPFS read stopped after ${String(offset)} of ${String(output.byteLength)} bytes`);
            }
            offset += bytesRead;
        }
        return output.buffer;
    } finally {
        access.close();
    }
}

function throwIfAborted(session: WriteSession): void {
    if (session.abortController.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
}

async function closeWriteAccess(session: WriteSession): Promise<void> {
    if (session.access === null) {
        return;
    }
    session.access.flush();
    session.access.close();
    session.access = null;
}

async function removeTemporaryFile(session: WriteSession): Promise<void> {
    await session.directory.removeEntry(session.temporaryName).catch((error: unknown) => {
        if (!isNotFoundError(error)) {
            throw error;
        }
    });
}

export function createModelStorageRequestHandler({
    getRoot,
    postResponse,
    sha256 = defaultSha256,
    extractArchive = extractSingleGuardedZipEntry,
    locks = browserLocks,
}: CreateModelStorageRequestHandlerInput): (request: ModelStorageWorkerRequest) => Promise<void> {
    const writes = new Map<string, WriteSession>();

    async function abortWrite(writeId: string): Promise<void> {
        const session = writes.get(writeId);
        if (!session) {
            return;
        }
        writes.delete(writeId);
        session.abortController.abort();
        try {
            if (session.access !== null) {
                session.access.close();
                session.access = null;
            }
        } finally {
            try {
                await removeTemporaryFile(session);
            } finally {
                await session.partialLease.release();
                await session.modelLease.release();
            }
        }
    }

    async function withModelLock<Result>(
        input: { family: string; modelId: string },
        operation: () => Promise<Result>
    ): Promise<Result> {
        const lease = await locks.acquireExclusive(modelLockName(input));
        try {
            return await operation();
        } finally {
            await lease.release();
        }
    }

    async function sweepStalePartials(directory: FileSystemDirectoryHandle): Promise<void> {
        if (typeof Reflect.get(directory, Symbol.asyncIterator) !== 'function') {
            return;
        }
        for await (const [name, handle] of directory as AsyncIterable<
            [string, FileSystemFileHandle | FileSystemDirectoryHandle]
        >) {
            if (handle.kind === 'directory') {
                await sweepStalePartials(handle);
                continue;
            }
            const writeId = getTemporaryWriteId(name);
            if (writeId === null) {
                continue;
            }
            const lease = await locks.tryAcquireExclusive(partialLockName(writeId));
            if (lease === null) {
                continue;
            }
            try {
                await directory.removeEntry(name).catch((error: unknown) => {
                    if (!isNotFoundError(error)) {
                        throw error;
                    }
                });
            } finally {
                await lease.release();
            }
        }
    }

    async function sweepModelPartials(): Promise<void> {
        try {
            const root = await getRoot();
            await sweepStalePartials(await root.getDirectoryHandle(MODELS_DIRECTORY, { create: false }));
        } catch (error) {
            if (!isNotFoundError(error)) {
                throw error;
            }
        }
    }

    async function handleRead(request: Extract<ModelStorageWorkerRequest, { type: 'read-model' }>): Promise<void> {
        const { destinationPort } = request;
        try {
            await withModelLock(request, async () => {
                const root = await getRoot();
                const { directory, fileName } = await resolveModelLocation(root, request, false);
                const file = requireReadableSyncFileHandle(await directory.getFileHandle(fileName, { create: false }));
                const modelData = await readAll(file, request.expectedSizeBytes);
                const validDigest =
                    modelData !== null &&
                    (request.expectedSha256 === undefined || (await sha256(modelData)) === request.expectedSha256);
                if (!validDigest) {
                    await directory.removeEntry(fileName);
                    destinationPort.close();
                    postResponse({ type: 'read-complete', requestId: request.requestId, found: false });
                    return;
                }
                const message: ModelStorageTransferMessage = { type: 'model-data', modelData };
                destinationPort.postMessage(message, [modelData]);
                destinationPort.close();
                postResponse({ type: 'read-complete', requestId: request.requestId, found: true });
            });
        } catch (error) {
            if (isNotFoundError(error)) {
                destinationPort.close();
                postResponse({ type: 'read-complete', requestId: request.requestId, found: false });
                return;
            }
            const serialized = serializeError(error);
            const message: ModelStorageTransferMessage = { type: 'model-error', ...serialized };
            destinationPort.postMessage(message);
            destinationPort.close();
            throw error;
        }
    }

    async function handleBegin(
        request: Extract<ModelStorageWorkerRequest, { type: 'begin-model-write' }>
    ): Promise<void> {
        if (writes.has(request.writeId)) {
            throw new Error(`Model write already exists: ${request.writeId}`);
        }
        await sweepModelPartials();
        const modelLease = await locks.acquireExclusive(modelLockName(request));
        const temporaryName = `${TEMPORARY_MODEL_PREFIX}${request.writeId}${TEMPORARY_MODEL_SUFFIX}`;
        let directory: FileSystemDirectoryHandle | null = null;
        let partialLease: ModelStorageLockLease | null = null;
        let access: SyncAccessHandle | null = null;
        try {
            const root = await getRoot();
            const location = await resolveModelLocation(root, request, true);
            directory = location.directory;
            partialLease = await locks.acquireExclusive(partialLockName(request.writeId));
            const file = requireMovableSyncFileHandle(await directory.getFileHandle(temporaryName, { create: true }));
            access = await file.createSyncAccessHandle({ mode: 'readwrite' });
            access.truncate(0);
            writes.set(request.writeId, {
                access,
                abortController: new AbortController(),
                archive: request.archive,
                directory,
                expectedSha256: request.expectedSha256,
                expectedSizeBytes: request.expectedSizeBytes,
                file,
                fileName: location.fileName,
                modelId: request.modelId,
                modelLease,
                offset: 0,
                partialLease,
                temporaryName,
            });
        } catch (error) {
            access?.close();
            await directory?.removeEntry(temporaryName).catch(() => undefined);
            await partialLease?.release();
            await modelLease.release();
            throw error;
        }
        postResponse({ type: 'write-begun', requestId: request.requestId });
    }

    async function handleChunk(
        request: Extract<ModelStorageWorkerRequest, { type: 'write-model-chunk' }>
    ): Promise<void> {
        const session = writes.get(request.writeId);
        if (!session?.access) {
            throw new Error(`Unknown model write: ${request.writeId}`);
        }
        try {
            throwIfAborted(session);
            const chunk = new Uint8Array(request.chunk);
            if (
                session.expectedSizeBytes !== undefined &&
                session.offset + chunk.byteLength > session.expectedSizeBytes
            ) {
                throw new Error(
                    `Model byte limit exceeded for ${session.modelId}: expected at most ${String(session.expectedSizeBytes)} bytes`
                );
            }
            const bytesWritten = session.access.write(chunk, { at: session.offset });
            if (bytesWritten !== chunk.byteLength) {
                throw new Error(`OPFS wrote ${String(bytesWritten)} of ${String(chunk.byteLength)} model bytes`);
            }
            session.offset += bytesWritten;
            postResponse({ type: 'chunk-written', requestId: request.requestId, bytesWritten });
        } catch (error) {
            await abortWrite(request.writeId);
            throw error;
        }
    }

    async function handleCommit(
        request: Extract<ModelStorageWorkerRequest, { type: 'commit-model-write' }>
    ): Promise<void> {
        const session = writes.get(request.writeId);
        if (!session) {
            throw new Error(`Unknown model write: ${request.writeId}`);
        }
        try {
            throwIfAborted(session);
            if (session.expectedSizeBytes !== undefined && session.offset !== session.expectedSizeBytes) {
                throw new Error(
                    `Size check failed for ${session.modelId}: expected ${String(session.expectedSizeBytes)} bytes, got ${String(session.offset)}`
                );
            }
            await closeWriteAccess(session);

            let storedBytes = session.offset;
            let extractedPath: string | null = null;
            let downloadedBytes: ArrayBuffer | null = null;
            if (session.expectedSha256 !== undefined || session.archive) {
                downloadedBytes = await readAll(session.file, session.expectedSizeBytes);
                if (downloadedBytes === null) {
                    throw new Error(`Size check failed for ${session.modelId} while reopening downloaded bytes`);
                }
            }
            if (session.expectedSha256 !== undefined && downloadedBytes !== null) {
                postResponse({ type: 'write-progress', requestId: request.requestId, stage: 'verifying' });
                const actualSha256 = await sha256(downloadedBytes);
                throwIfAborted(session);
                if (actualSha256 !== session.expectedSha256) {
                    throw new Error(
                        `Integrity check failed for ${session.modelId}: expected ${session.expectedSha256}, got ${actualSha256}`
                    );
                }
            }
            if (session.archive && downloadedBytes !== null) {
                postResponse({ type: 'write-progress', requestId: request.requestId, stage: 'extracting' });
                const extracted = await extractArchive({
                    bytes: new Uint8Array(downloadedBytes),
                    suffix: '.onnx',
                    signal: session.abortController.signal,
                });
                throwIfAborted(session);
                extractedPath = extracted.path;
                const access = await session.file.createSyncAccessHandle({ mode: 'readwrite' });
                session.access = access;
                access.truncate(0);
                const bytesWritten = access.write(extracted.data, { at: 0 });
                if (bytesWritten !== extracted.data.byteLength) {
                    throw new Error(
                        `OPFS wrote ${String(bytesWritten)} of ${String(extracted.data.byteLength)} extracted model bytes`
                    );
                }
                storedBytes = bytesWritten;
                await closeWriteAccess(session);
            }

            if (session.expectedSha256 !== undefined || session.archive) {
                postResponse({ type: 'write-progress', requestId: request.requestId, stage: 'storing' });
            }
            throwIfAborted(session);
            await session.file.move(session.directory, session.fileName);
            await session.partialLease.release();
            await session.modelLease.release();
            writes.delete(request.writeId);
            postResponse({
                type: 'write-committed',
                requestId: request.requestId,
                storedBytes,
                extractedPath,
            });
        } catch (error) {
            await abortWrite(request.writeId);
            throw error;
        }
    }

    async function measureDirectory(
        directory: FileSystemDirectoryHandle,
        scavengeModelPartials: boolean
    ): Promise<number> {
        let usedBytes = 0;
        for await (const [name, handle] of directory as AsyncIterable<
            [string, FileSystemFileHandle | FileSystemDirectoryHandle]
        >) {
            if (handle.kind === 'file') {
                const temporaryWriteId = scavengeModelPartials ? getTemporaryWriteId(name) : null;
                if (temporaryWriteId !== null) {
                    continue;
                }
                usedBytes += (await handle.getFile()).size;
            } else {
                usedBytes += await measureDirectory(handle, scavengeModelPartials);
            }
        }
        return usedBytes;
    }

    return async function handleModelStorageRequest(request: ModelStorageWorkerRequest): Promise<void> {
        try {
            if (request.type === 'read-model') {
                await handleRead(request);
                return;
            }
            if (request.type === 'begin-model-write') {
                await handleBegin(request);
                return;
            }
            if (request.type === 'write-model-chunk') {
                await handleChunk(request);
                return;
            }
            if (request.type === 'commit-model-write') {
                await handleCommit(request);
                return;
            }
            if (request.type === 'abort-model-write') {
                await abortWrite(request.writeId);
                postResponse({ type: 'write-aborted', requestId: request.requestId });
                return;
            }
            if (request.type === 'delete-model') {
                await withModelLock(request, async () => {
                    try {
                        const root = await getRoot();
                        const { directory, fileName } = await resolveModelLocation(root, request, false);
                        await directory.removeEntry(fileName);
                    } catch (error) {
                        if (!isNotFoundError(error)) {
                            throw error;
                        }
                    }
                });
                postResponse({ type: 'model-deleted', requestId: request.requestId });
                return;
            }
            if (request.type === 'check-model') {
                let cached = true;
                try {
                    const root = await getRoot();
                    const { directory, fileName } = await resolveModelLocation(root, request, false);
                    await directory.getFileHandle(fileName, { create: false });
                } catch (error) {
                    if (!isNotFoundError(error)) {
                        throw error;
                    }
                    cached = false;
                }
                postResponse({ type: 'model-checked', requestId: request.requestId, cached });
                return;
            }
            if (request.type === 'verify-model') {
                let verified = false;
                await withModelLock(request, async () => {
                    try {
                        const root = await getRoot();
                        const { directory, fileName } = await resolveModelLocation(root, request, false);
                        const file = requireReadableSyncFileHandle(
                            await directory.getFileHandle(fileName, { create: false })
                        );
                        const modelData = await readAll(file, request.expectedSizeBytes);
                        verified = modelData !== null && (await sha256(modelData)) === request.expectedSha256;
                        if (!verified) {
                            await directory.removeEntry(fileName);
                        }
                    } catch (error) {
                        if (!isNotFoundError(error)) {
                            throw error;
                        }
                    }
                });
                postResponse({ type: 'model-verified', requestId: request.requestId, verified });
                return;
            }

            await sweepModelPartials();
            const root = await getRoot();
            let usedBytes = 0;
            for (const name of [MODELS_DIRECTORY, RENDERS_DIRECTORY]) {
                try {
                    usedBytes += await measureDirectory(
                        await root.getDirectoryHandle(name, { create: false }),
                        name === MODELS_DIRECTORY
                    );
                } catch (error) {
                    if (!isNotFoundError(error)) {
                        throw error;
                    }
                }
            }
            postResponse({ type: 'storage-measured', requestId: request.requestId, usedBytes });
        } catch (error) {
            postResponse({ type: 'error', requestId: request.requestId, ...serializeError(error) });
        }
    };
}
