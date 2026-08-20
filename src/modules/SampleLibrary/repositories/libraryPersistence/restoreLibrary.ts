import { logger } from '#/infra/logger/appLogger';
import { batchStoreUpdates } from '#/infra/store/createStore';
import { isDesktopRuntime } from '#/utils/desktopBridge';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type LibraryRoot, type SampleRecord } from '../../models/LibraryTypes';
import { addLibraryRoot, addSamples, libraryStore, setActiveRoot } from '../../stores/libraryStore';
import { readNativeDirectory } from '../readNativeDirectory';

import { HANDLES_STORE, ROOTS_STORE, SAMPLES_STORE, openDb } from './helpers';
import { ACTIVE_ROOT_KEY } from './persistSamples';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * The spelling `'tauri'` carried on disk before the desktop shell moved off
 * Tauri. Roots connected then are still in IndexedDB, so it is accepted on
 * read and mapped forward to `'desktop'`. Nothing writes it anymore:
 * `parseLibraryRoot` hands the store the normalized kind, and
 * `persistLibraryRoots` serializes what the store holds.
 */
const LEGACY_DESKTOP_PROVIDER = 'tauri';

/**
 * Read a persisted provider kind, or `null` when the value is not one this
 * build understands. A root whose provider cannot be resolved is dropped rather
 * than restored into a state no scanner will service.
 */
function parseRootProvider(value: unknown): LibraryRoot['provider'] | null {
    if (value === LEGACY_DESKTOP_PROVIDER) {
        return 'desktop';
    }
    if (value === 'browser' || value === 'desktop') {
        return value;
    }
    return null;
}

function isRootStatus(value: unknown): value is LibraryRoot['status'] {
    return (
        value === 'ready' ||
        value === 'offline' ||
        value === 'permission_required' ||
        value === 'path_missing' ||
        value === 'scanning'
    );
}

function isSampleSyncStatus(value: unknown): value is SampleRecord['sync']['status'] {
    return (
        value === 'discovered' ||
        value === 'indexed' ||
        value === 'analyzed' ||
        value === 'offline' ||
        value === 'error'
    );
}

function isEmbeddingStatus(value: unknown): value is NonNullable<SampleRecord['embeddingStatus']> {
    return value === 'pending' || value === 'ready' || value === 'error';
}

function isOptionalNonnegativeNumber(value: unknown): boolean {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isOptionalPositiveNumber(value: unknown): boolean {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function isOptionalPositiveInteger(value: unknown): boolean {
    return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value > 0);
}

function parseLibraryRoot(value: unknown): LibraryRoot | null {
    if (!isRecord(value) || !isRecord(value.settings)) {
        return null;
    }
    const provider = parseRootProvider(value.provider);
    if (
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        provider === null ||
        typeof value.rootRef !== 'string' ||
        !isOptionalNonnegativeNumber(value.connectedAt) ||
        typeof value.connectedAt !== 'number' ||
        !isOptionalNonnegativeNumber(value.lastScanAt) ||
        !isRootStatus(value.status) ||
        typeof value.fileCount !== 'number' ||
        !Number.isInteger(value.fileCount) ||
        value.fileCount < 0 ||
        typeof value.settings.recursive !== 'boolean'
    ) {
        return null;
    }

    const root: LibraryRoot = {
        id: value.id,
        name: value.name,
        provider,
        rootRef: value.rootRef,
        connectedAt: value.connectedAt,
        status: value.status,
        fileCount: value.fileCount,
        settings: { recursive: value.settings.recursive },
    };
    if (typeof value.lastScanAt === 'number') {
        root.lastScanAt = value.lastScanAt;
    }
    return root;
}

type PersistedHandle = { id: string; handle: FileSystemDirectoryHandle };

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
    return isRecord(value) && typeof value.queryPermission === 'function';
}

function parsePersistedHandle(value: unknown): PersistedHandle | null {
    if (!isRecord(value) || typeof value.id !== 'string' || !isDirectoryHandle(value.handle)) {
        return null;
    }
    return { id: value.id, handle: value.handle };
}

type ParsedSample = { live: SampleRecord; sanitizedWrite: SampleRecord | null };

type PersistedSampleRecord = Omit<SampleRecord, 'analysis'> & { analysis?: unknown };

function isPersistedSampleRecord(value: unknown): value is PersistedSampleRecord {
    if (!isRecord(value) || !isRecord(value.sync) || !isRecord(value.format)) {
        return false;
    }
    const { sync, format } = value;
    if (
        typeof value.id !== 'string' ||
        typeof value.libraryRootId !== 'string' ||
        typeof value.relativePath !== 'string' ||
        typeof value.displayName !== 'string' ||
        typeof value.ext !== 'string' ||
        typeof value.folder !== 'string' ||
        typeof sync.exists !== 'boolean' ||
        !isSampleSyncStatus(sync.status) ||
        !isOptionalNonnegativeNumber(sync.mtimeMs) ||
        !isOptionalNonnegativeNumber(sync.sizeBytes) ||
        !isOptionalNonnegativeNumber(format.durationSec) ||
        !isOptionalPositiveNumber(format.sampleRate) ||
        !isOptionalPositiveInteger(format.channels) ||
        !isOptionalPositiveInteger(format.bitDepth) ||
        !Array.isArray(value.tags) ||
        !value.tags.every((tag) => typeof tag === 'string') ||
        typeof value.favorite !== 'boolean' ||
        (value.embeddingStatus !== undefined && !isEmbeddingStatus(value.embeddingStatus))
    ) {
        return false;
    }

    if (value.spatialMap !== undefined) {
        if (
            !isRecord(value.spatialMap) ||
            typeof value.spatialMap.x !== 'number' ||
            !Number.isFinite(value.spatialMap.x) ||
            value.spatialMap.x < -1 ||
            value.spatialMap.x > 1 ||
            typeof value.spatialMap.y !== 'number' ||
            !Number.isFinite(value.spatialMap.y) ||
            value.spatialMap.y < -1 ||
            value.spatialMap.y > 1
        ) {
            return false;
        }
    }
    return true;
}

function parseSampleRecord(value: unknown): ParsedSample | null {
    if (!isPersistedSampleRecord(value)) {
        return null;
    }

    const { analysis: _removedAnalysis, ...withoutAnalysis } = value;
    const live: SampleRecord = {
        ...withoutAnalysis,
        sync: {
            ...value.sync,
            status: value.sync.status === 'analyzed' ? 'indexed' : value.sync.status,
        },
    };
    const cleanupRequired = Object.hasOwn(value, 'analysis') || value.sync.status === 'analyzed';
    return { live, sanitizedWrite: cleanupRequired ? live : null };
}

function persistSanitizedSamples(db: IDBDatabase, samples: SampleRecord[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SAMPLES_STORE, 'readwrite');
        const store = tx.objectStore(SAMPLES_STORE);
        for (const sample of samples) {
            store.put(sample);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
    });
}

function getNativeDirectoryErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return '';
}

function isNativeMissingDirectoryError(error: unknown): boolean {
    const message = getNativeDirectoryErrorMessage(error);
    return message === 'File not found or not accessible' || message === 'Not a directory';
}

function isNativeChildListingError(error: unknown): boolean {
    const message = getNativeDirectoryErrorMessage(error);
    return message.startsWith('Failed to read entry:') || message.startsWith('Failed to read metadata:');
}

/**
 * Validate that a restored native root's absolute path still resolves on disk.
 * Returns the status the root should take: `ready` when the path exists,
 * `path_missing` when it provably does not, and `offline` when we cannot tell
 * (not in a desktop runtime, no path recorded, or the check itself failed).
 */
async function resolveNativeRootStatus(root: LibraryRoot): Promise<LibraryRoot['status']> {
    if (!isDesktopRuntime() || !root.rootRef) {
        return 'offline';
    }
    try {
        await readNativeDirectory({ path: root.rootRef });
        return 'ready';
    } catch (error) {
        if (isNativeMissingDirectoryError(error)) {
            return 'path_missing';
        }
        if (isNativeChildListingError(error)) {
            return 'ready';
        }
        return 'offline';
    }
}

/**
 * Restore library roots and samples from IndexedDB on app launch.
 *
 * Returns the ids of the roots that were restored so the calling use case can
 * rebuild their folder trees. Folder-tree shaping lives in the `buildFolderTree`
 * use case; a repository touches IDB and the store but does not drive use-case
 * logic, so the rebuild is the caller's responsibility, not this function's. On
 * failure the empty array is returned (nothing was restored).
 */
export async function restoreLibrary(): Promise<string[]> {
    let db: IDBDatabase | null = null;
    try {
        const openedDb = await openDb();
        db = openedDb;

        // Restore roots
        const rootRows = await new Promise<unknown[]>((resolve, reject) => {
            const tx = openedDb.transaction(ROOTS_STORE, 'readonly');
            const store = tx.objectStore(ROOTS_STORE);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
        });
        const roots = rootRows.map(parseLibraryRoot).filter((root): root is LibraryRoot => root !== null);

        // Restore handles for browser roots
        const handleRows = await new Promise<unknown[]>((resolve, reject) => {
            const tx = openedDb.transaction(HANDLES_STORE, 'readonly');
            const store = tx.objectStore(HANDLES_STORE);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
        });
        const handles = handleRows
            .map(parsePersistedHandle)
            .filter((handle): handle is PersistedHandle => handle !== null);

        const handleMap = new Map(handles.map((h) => [h.id, h.handle]));

        // Rehydrate roots with handles and check permissions
        for (const root of roots) {
            if (root.provider === 'browser') {
                const handle = handleMap.get(root.id);
                if (handle) {
                    // Check if we still have permission
                    try {
                        const perm = await handle.queryPermission({ mode: 'read' });
                        if (perm === 'granted') {
                            root.handle = handle;
                            root.status = 'ready';
                        } else {
                            root.handle = handle;
                            root.status = 'permission_required';
                        }
                    } catch {
                        root.status = 'offline';
                    }
                } else {
                    root.status = 'offline';
                }
            } else {
                // Native: cheaply confirm the absolute path still resolves before
                // claiming the root is ready. A moved/deleted folder restores as
                // path_missing instead of a falsely-ready root that fails on first
                // access with no explanation.
                root.status = await resolveNativeRootStatus(root);
            }
        }

        // Restore samples
        const samples = await new Promise<unknown[]>((resolve, reject) => {
            const tx = openedDb.transaction(SAMPLES_STORE, 'readonly');
            const store = tx.objectStore(SAMPLES_STORE);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
        });

        const parsedSamples = samples
            .map(parseSampleRecord)
            .filter((sample): sample is ParsedSample => sample !== null);
        const restoredSamples = parsedSamples.map((sample) => sample.live);
        const sanitizedSamples = parsedSamples.flatMap((sample) =>
            sample.sanitizedWrite === null ? [] : [sample.sanitizedWrite]
        );
        if (sanitizedSamples.length > 0) {
            await persistSanitizedSamples(openedDb, sanitizedSamples);
        }

        const savedActiveRoot = typeof localStorage === 'undefined' ? null : localStorage.getItem(ACTIVE_ROOT_KEY);
        batchStoreUpdates(() => {
            for (const root of roots) {
                addLibraryRoot(root, { activate: false });
            }
            if (restoredSamples.length > 0) {
                addSamples(restoredSamples);
            }
            const state = libraryStore.value;
            if (savedActiveRoot && state?.roots.some((root) => root.id === savedActiveRoot)) {
                setActiveRoot(savedActiveRoot);
            }
        });

        openedDb.close();
        db = null;

        return roots.map((root) => root.id);
    } catch (error) {
        db?.close();
        // openDb resolves (creating stores) on a clean first launch, so reaching
        // this catch means a genuine failure — a corrupted DB or transient IO
        // error — not an empty library. Surface it instead of silently starting
        // fresh, which would hide the loss of a previously connected library.
        logger.error(error instanceof Error ? error : new Error(String(error)));
        notifyUser('Could not load your saved sample library. It may be unavailable this session.', 'error');
        return [];
    }
}
