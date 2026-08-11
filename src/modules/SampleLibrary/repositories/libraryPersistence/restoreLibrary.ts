import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { isTauri } from '#/utils/tauriBridge';

import { type LibraryRoot, type SampleRecord } from '../../models/LibraryTypes';
import { addLibraryRoot, addSamples, setActiveRoot, libraryStore } from '../../stores/libraryStore';
import { readTauriDirectory } from '../readTauriDirectory';

import { HANDLES_STORE, ROOTS_STORE, SAMPLES_STORE, openDb } from './helpers';
import { ACTIVE_ROOT_KEY } from './persistSamples';

type RestoreLibraryInput = {
    trustedAnalysisRootId?: string;
};

function removeUntrustedAnalysis(sample: SampleRecord, trustedAnalysisRootId?: string): SampleRecord {
    if (sample.libraryRootId === trustedAnalysisRootId) {
        return sample;
    }
    if (sample.analysis === undefined && sample.sync.status !== 'analyzed') {
        return sample;
    }

    const sanitized = {
        ...sample,
        sync: sample.sync.status === 'analyzed' ? { ...sample.sync, status: 'indexed' as const } : sample.sync,
    };
    delete sanitized.analysis;
    return sanitized;
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
 * Validate that a restored Tauri root's absolute path still resolves on disk.
 * Returns the status the root should take: `ready` when the path exists,
 * `path_missing` when it provably does not, and `offline` when we cannot tell
 * (not in a Tauri runtime, no path recorded, or the check itself failed).
 */
async function resolveTauriRootStatus(root: LibraryRoot): Promise<LibraryRoot['status']> {
    if (!isTauri() || !root.rootRef) {
        return 'offline';
    }
    try {
        await readTauriDirectory({ path: root.rootRef });
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
export async function restoreLibrary({ trustedAnalysisRootId }: RestoreLibraryInput = {}): Promise<string[]> {
    try {
        const db = await openDb();

        // Restore roots
        const roots = await new Promise<LibraryRoot[]>((resolve, reject) => {
            const tx = db.transaction(ROOTS_STORE, 'readonly');
            const store = tx.objectStore(ROOTS_STORE);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result as LibraryRoot[]);
            request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
        });

        // Restore handles for browser roots
        const handles = await new Promise<Array<{ id: string; handle: FileSystemDirectoryHandle }>>(
            (resolve, reject) => {
                const tx = db.transaction(HANDLES_STORE, 'readonly');
                const store = tx.objectStore(HANDLES_STORE);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
            }
        );

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
                // Tauri: cheaply confirm the absolute path still resolves before
                // claiming the root is ready. A moved/deleted folder restores as
                // path_missing instead of a falsely-ready root that fails on first
                // access with no explanation.
                root.status = await resolveTauriRootStatus(root);
            }

            // Bulk restore must not auto-focus: passing the default {activate:true}
            // would set activeRootId to whichever root comes last out of IDB
            // (factory lex-sorts after lib-* roots), wiping the session's real
            // focus. Restore the persisted activeRootId explicitly below instead.
            addLibraryRoot(root, { activate: false });
        }

        // Restore samples
        const samples = await new Promise<SampleRecord[]>((resolve, reject) => {
            const tx = db.transaction(SAMPLES_STORE, 'readonly');
            const store = tx.objectStore(SAMPLES_STORE);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result as SampleRecord[]);
            request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
        });

        const restoredSamples = samples.map((sample) => removeUntrustedAnalysis(sample, trustedAnalysisRootId));
        const sanitizedSamples = restoredSamples.filter((sample, index) => sample !== samples[index]);
        if (sanitizedSamples.length > 0) {
            await persistSanitizedSamples(db, sanitizedSamples);
        }

        if (restoredSamples.length > 0) {
            addSamples(restoredSamples);
        }

        // Restore the session's last focused root if it was persisted and still
        // exists. Restoring it explicitly (rather than letting addLibraryRoot
        // auto-focus the last-out-of-IDB root) is what stops focus resetting to
        // 'Factory Samples' on every reload. No saved preference leaves focus as
        // it was, so the first-launch seed can claim it.
        if (typeof localStorage !== 'undefined') {
            const savedActiveRoot = localStorage.getItem(ACTIVE_ROOT_KEY);
            const state = libraryStore.value;
            if (savedActiveRoot && state?.roots.some((r) => r.id === savedActiveRoot)) {
                setActiveRoot(savedActiveRoot);
            }
        }

        db.close();

        return roots.map((root) => root.id);
    } catch (error) {
        // openDb resolves (creating stores) on a clean first launch, so reaching
        // this catch means a genuine failure — a corrupted DB or transient IO
        // error — not an empty library. Surface it instead of silently starting
        // fresh, which would hide the loss of a previously connected library.
        logger.error(error instanceof Error ? error : new Error(String(error)));
        notifyUser('Could not load your saved sample library. It may be unavailable this session.', 'error');
        return [];
    }
}
