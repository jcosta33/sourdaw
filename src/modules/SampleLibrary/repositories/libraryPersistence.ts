/**
 * Library persistence — saves/restores library roots and sample metadata
 * to IndexedDB for browser builds, or app-local storage for Tauri.
 *
 * Serializes directory handles for browser rehydration.
 */
import { type LibraryRoot, type SampleRecord } from '../models/LibraryTypes';
import { libraryStore, addLibraryRoot, addSamples } from '../stores/libraryStore';
import { buildFolderTree } from '../useCases/buildFolderTree';

const DB_NAME = 'sourdaw-library';
const DB_VERSION = 1;
const ROOTS_STORE = 'roots';
const SAMPLES_STORE = 'samples';
const HANDLES_STORE = 'handles';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(ROOTS_STORE)) {
                db.createObjectStore(ROOTS_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(SAMPLES_STORE)) {
                db.createObjectStore(SAMPLES_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(HANDLES_STORE)) {
                db.createObjectStore(HANDLES_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Persist all current library roots to IndexedDB.
 */
export async function persistLibraryRoots(): Promise<void> {
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    try {
        const db = await openDb();
        const tx = db.transaction([ROOTS_STORE, HANDLES_STORE], 'readwrite');
        const rootStore = tx.objectStore(ROOTS_STORE);
        const handleStore = tx.objectStore(HANDLES_STORE);

        for (const root of state.roots) {
            // Serialize root without the handle (handles can't be JSON-stringified)
            const serializable = { ...root, handle: undefined };
            rootStore.put(serializable);

            // Persist browser directory handles separately
            if (root.provider === 'browser' && root.handle) {
                handleStore.put({ id: root.id, handle: root.handle });
            }
        }

        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch {
        // Silent fail — persistence is best-effort
    }
}

/**
 * Persist sample records in batches.
 */
export async function persistSamples(): Promise<void> {
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    try {
        const db = await openDb();
        const tx = db.transaction(SAMPLES_STORE, 'readwrite');
        const store = tx.objectStore(SAMPLES_STORE);

        for (const sample of state.samples) {
            store.put(sample);
        }

        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch {
        // Silent fail
    }
}

/**
 * Restore library roots and samples from IndexedDB on app launch.
 */
export async function restoreLibrary(): Promise<void> {
    try {
        const db = await openDb();

        // Restore roots
        const roots = await new Promise<LibraryRoot[]>((resolve, reject) => {
            const tx = db.transaction(ROOTS_STORE, 'readonly');
            const store = tx.objectStore(ROOTS_STORE);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result as LibraryRoot[]);
            request.onerror = () => reject(request.error);
        });

        // Restore handles for browser roots
        const handles = await new Promise<Array<{ id: string; handle: FileSystemDirectoryHandle }>>(
            (resolve, reject) => {
                const tx = db.transaction(HANDLES_STORE, 'readonly');
                const store = tx.objectStore(HANDLES_STORE);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
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
                        const perm = await (handle as unknown as { queryPermission: (opts: { mode: string }) => Promise<string> }).queryPermission({ mode: 'read' });
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
                // Tauri: check if path still exists
                root.status = 'ready'; // Assume ready; will validate on first access
            }

            addLibraryRoot(root);
        }

        // Restore samples
        const samples = await new Promise<SampleRecord[]>((resolve, reject) => {
            const tx = db.transaction(SAMPLES_STORE, 'readonly');
            const store = tx.objectStore(SAMPLES_STORE);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result as SampleRecord[]);
            request.onerror = () => reject(request.error);
        });

        if (samples.length > 0) {
            addSamples(samples);
        }

        // Rebuild folder trees for all restored roots
        for (const root of roots) {
            buildFolderTree(root.id);
        }

        db.close();
    } catch {
        // First launch or corrupted DB — start fresh
    }
}

/**
 * Request permission for a browser directory handle that needs re-authorization.
 */
export async function requestPermission(rootId: string): Promise<boolean> {
    const state = libraryStore.value;
    if (!state) {
        return false;
    }

    const root = state.roots.find((r) => r.id === rootId);
    if (!root || !root.handle) {
        return false;
    }

    try {
        const perm = await (root.handle as unknown as { requestPermission: (opts: { mode: string }) => Promise<string> }).requestPermission({ mode: 'read' });
        if (perm === 'granted') {
            const { updateLibraryRootStatus } = await import('../stores/libraryStore');
            updateLibraryRootStatus(rootId, 'ready');
            return true;
        }
    } catch {
        // Permission denied
    }

    return false;
}
