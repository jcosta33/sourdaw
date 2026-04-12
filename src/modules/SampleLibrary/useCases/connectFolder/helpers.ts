import { type LibraryRoot, type SampleRecord, isAudioFile } from '../../models/LibraryTypes';
import { persistLibraryRoots } from '../../repositories/libraryPersistence/persistLibraryRoots';
import { persistSamples } from '../../repositories/libraryPersistence/persistSamples';
import { addSamples, updateLibraryRootStatus, setScanProgress } from '../../stores/libraryStore';
import { buildFolderTree } from '../buildFolderTree';
let _scanAbortController: AbortController | null = null;

export function getScanAbortController(): AbortController | null {
    return _scanAbortController;
}

export function setScanAbortController(controller: AbortController | null): void {
    _scanAbortController = controller;
}

export async function* traverseBrowserDirectory(
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

export // ── Helpers ──────────────────────────────────────────────────────────────────

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

export // ── Browser directory scanning ───────────────────────────────────────────────

async function scanBrowserDirectory(root: LibraryRoot): Promise<void> {
    if (!root.handle) {
        return;
    }
    setScanAbortController(new AbortController());
    const signal = getScanAbortController()!.signal;

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
                setScanProgress(true, Math.min(0.95, totalFound / Math.max(totalFound + 20, 1)));
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
        setScanAbortController(null);
    }
}

export // ── Tauri directory scanning ─────────────────────────────────────────────────

async function scanTauriDirectory(root: LibraryRoot): Promise<void> {
    setScanAbortController(new AbortController());
    setScanProgress(true, 0);

    try {
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const batch: SampleRecord[] = [];
        let totalFound = 0;

        async function scanDir(dirPath: string, relativePath: string): Promise<void> {
            try {
                const entries = await readDir(dirPath);
                for (const entry of entries) {
                    if (getScanAbortController()?.signal.aborted) {
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
                            setScanProgress(true, Math.min(0.95, totalFound / Math.max(totalFound + 20, 1)));
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
        setScanAbortController(null);
    }
}
