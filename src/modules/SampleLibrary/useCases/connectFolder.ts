/**
 * Connect a local folder as a library root.
 *
 * Browser: uses showDirectoryPicker() / File System Access API.
 * Tauri: uses native file dialog.
 *
 * After connecting, starts async scanning to discover audio files.
 */
import { type LibraryRoot, type SampleRecord, isAudioFile } from '../models/LibraryTypes';
import {
    libraryStore,
    addLibraryRoot,
    addSamples,
    updateLibraryRootStatus,
    setScanProgress,
} from '../stores/libraryStore';
import { persistLibraryRoots, persistSamples } from '../repositories/libraryPersistence';
import { buildFolderTree } from './buildFolderTree';

let scanAbortController: AbortController | null = null;

/**
 * Open a folder picker and connect the selected folder as a library root.
 * Returns the root ID if successful, null if cancelled.
 */
export async function connectFolder(): Promise<string | null> {
    // Check if we're in Tauri
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

    if (isTauri) {
        return connectFolderTauri();
    }

    return connectFolderBrowser();
}

async function connectFolderBrowser(): Promise<string | null> {
    // Check for File System Access API support
    if (!('showDirectoryPicker' in window)) {
        // Fallback: alert the user
        return null;
    }

    try {
        const handle = await (window as unknown as { showDirectoryPicker: (opts: { mode: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'read' });
        const id = `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const root: LibraryRoot = {
            id,
            name: handle.name,
            provider: 'browser',
            rootRef: handle.name, // We'll persist the handle separately
            handle,
            connectedAt: Date.now(),
            status: 'scanning',
            fileCount: 0,
            settings: { recursive: true },
        };

        addLibraryRoot(root);

        // Start scanning in background
        void scanBrowserDirectory(root);

        return id;
    } catch {
        // User cancelled the picker
        return null;
    }
}

async function connectFolderTauri(): Promise<string | null> {
    try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({ directory: true, multiple: false, title: 'Connect Sample Folder' });
        if (!selected || typeof selected !== 'string') {
            return null;
        }

        const id = `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const folderName = selected.split('/').pop() ?? selected.split('\\').pop() ?? selected;

        const root: LibraryRoot = {
            id,
            name: folderName,
            provider: 'tauri',
            rootRef: selected,
            connectedAt: Date.now(),
            status: 'scanning',
            fileCount: 0,
            settings: { recursive: true },
        };

        addLibraryRoot(root);

        // Start scanning in background
        void scanTauriDirectory(root);

        return id;
    } catch {
        return null;
    }
}

// ── Browser directory scanning ───────────────────────────────────────────────

async function scanBrowserDirectory(root: LibraryRoot): Promise<void> {
    if (!root.handle) {
        return;
    }
    scanAbortController = new AbortController();
    const signal = scanAbortController.signal;

    setScanProgress(true, 0);

    const batch: SampleRecord[] = [];
    let totalFound = 0;

    try {
        for await (const entry of traverseBrowserDirectory(root.handle, '')) {
            if (signal.aborted) {
                break;
            }

            totalFound++;
            batch.push(createSampleRecord(root.id, entry.path, entry.name));

            // Batch commit every 100 files
            if (batch.length >= 100) {
                addSamples([...batch]);
                batch.length = 0;
                setScanProgress(true, totalFound / Math.max(totalFound + 100, 1));
            }
        }

        // Commit remaining
        if (batch.length > 0) {
            addSamples([...batch]);
        }

        updateLibraryRootStatus(root.id, 'ready', totalFound);
        buildFolderTree(root.id);
        await persistLibraryRoots();
        await persistSamples();
    } catch (error) {
        updateLibraryRootStatus(root.id, 'offline');
    } finally {
        setScanProgress(false, 1);
        scanAbortController = null;
    }
}

async function* traverseBrowserDirectory(
    dir: FileSystemDirectoryHandle,
    parentPath: string
): AsyncIterable<{ path: string; name: string; handle: FileSystemFileHandle }> {
    for await (const entry of dir.values()) {
        const childPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        if (entry.kind === 'file' && isAudioFile(entry.name)) {
            yield { path: childPath, name: entry.name, handle: entry as FileSystemFileHandle };
        } else if (entry.kind === 'directory') {
            yield* traverseBrowserDirectory(entry as FileSystemDirectoryHandle, childPath);
        }
    }
}

// ── Tauri directory scanning ─────────────────────────────────────────────────

async function scanTauriDirectory(root: LibraryRoot): Promise<void> {
    scanAbortController = new AbortController();
    setScanProgress(true, 0);

    try {
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const batch: SampleRecord[] = [];
        let totalFound = 0;

        async function scanDir(dirPath: string, relativePath: string): Promise<void> {
            try {
                const entries = await readDir(dirPath);
                for (const entry of entries) {
                    if (scanAbortController?.signal.aborted) {
                        return;
                    }

                    const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

                    if (entry.isDirectory) {
                        if (root.settings.recursive) {
                            await scanDir(`${dirPath}/${entry.name}`, entryRelPath);
                        }
                    } else if (isAudioFile(entry.name)) {
                        totalFound++;
                        batch.push(createSampleRecord(root.id, entryRelPath, entry.name));

                        if (batch.length >= 100) {
                            addSamples([...batch]);
                            batch.length = 0;
                            setScanProgress(true, totalFound / Math.max(totalFound + 100, 1));
                        }
                    }
                }
            } catch {
                // Skip inaccessible directories
            }
        }

        await scanDir(root.rootRef, '');

        if (batch.length > 0) {
            addSamples([...batch]);
        }

        updateLibraryRootStatus(root.id, 'ready', totalFound);
        buildFolderTree(root.id);
        await persistLibraryRoots();
        await persistSamples();
    } catch {
        updateLibraryRootStatus(root.id, 'offline');
    } finally {
        setScanProgress(false, 1);
        scanAbortController = null;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function createSampleRecord(rootId: string, relativePath: string, filename: string): SampleRecord {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const displayName = filename.replace(/\.[^.]+$/, '');
    const folder = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';

    return {
        id: `${rootId}:${relativePath}`,
        libraryRootId: rootId,
        relativePath,
        displayName,
        ext,
        folder,
        sync: {
            exists: true,
            status: 'discovered',
        },
        format: {},
        tags: [],
        favorite: false,
    };
}

export function cancelScan(): void {
    if (scanAbortController) {
        scanAbortController.abort();
    }
}

/**
 * Rescan a library root — re-traverse and reconcile.
 */
export async function rescanRoot(rootId: string): Promise<void> {
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    const root = state.roots.find((r) => r.id === rootId);
    if (!root) {
        return;
    }

    updateLibraryRootStatus(rootId, 'scanning');

    if (root.provider === 'browser' && root.handle) {
        await scanBrowserDirectory(root);
    } else if (root.provider === 'tauri') {
        await scanTauriDirectory(root);
    }
}
