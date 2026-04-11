import { type LibraryRoot, type SampleRecord } from '../../models/LibraryTypes';
import { addLibraryRoot, addSamples } from '../../stores/libraryStore';
import { buildFolderTree } from '../../useCases/buildFolderTree';
import { HANDLES_STORE, ROOTS_STORE, SAMPLES_STORE, openDb } from './helpers';

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
                        const perm = await (
                            handle as unknown as { queryPermission: (opts: { mode: string }) => Promise<string> }
                        ).queryPermission({ mode: 'read' });
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