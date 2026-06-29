import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type LibraryRoot, type SampleRecord, isAudioFile } from '../../models/LibraryTypes';
import { persistLibraryRoots } from '../../repositories/libraryPersistence/persistLibraryRoots';
import { persistSamples } from '../../repositories/libraryPersistence/persistSamples';
import { readTauriDirectory } from '../../repositories/readTauriDirectory';
import {
    addSamples,
    removeSamples,
    updateLibraryRootStatus,
    setScanProgress,
    libraryStore,
} from '../../stores/libraryStore';
import { buildFolderTree } from '../buildFolderTree';

/**
 * Map a thrown scan error to a library-root status and a user-facing message.
 * The File System Access / Tauri FS layers surface failure modes as DOMException
 * names (or plain Errors); we distinguish the actionable ones so a revoked-
 * permission folder is not silently reported as merely "offline".
 */
function classifyScanError(error: unknown, folderName: string): { status: LibraryRoot['status']; message: string } {
    const name = error instanceof DOMException || error instanceof Error ? error.name : '';
    switch (name) {
        case 'NotAllowedError':
        case 'SecurityError':
            return {
                status: 'permission_required',
                message: `Lost permission to read "${folderName}". Reconnect the folder to rescan.`,
            };
        case 'NotFoundError':
            return {
                status: 'offline',
                message: `The folder "${folderName}" could not be found. It may have been moved or removed.`,
            };
        default:
            return {
                status: 'offline',
                message: `Could not scan "${folderName}" — a filesystem error occurred.`,
            };
    }
}

let scanAbortController: AbortController | null = null;

export function getScanAbortController(): AbortController | null {
    return scanAbortController;
}

export function setScanAbortController(controller: AbortController | null): void {
    scanAbortController = controller;
}

export async function* traverseBrowserDirectory(
    dir: FileSystemDirectoryHandle,
    parentPath: string
): AsyncIterable<{ path: string; name: string; handle: FileSystemFileHandle; mtimeMs?: number }> {
    for await (const entry of dir.values()) {
        const childPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        if (entry.kind === 'file' && isAudioFile(entry.name)) {
            // Read last-modified so rescans can detect in-place edits (the
            // deterministic id is path-based, so a changed file keeps its id and
            // would otherwise be deduped away with stale metadata). One getFile()
            // per audio file; a file we cannot stat still yields with no mtime.
            let mtimeMs: number | undefined;
            try {
                mtimeMs = (await entry.getFile()).lastModified;
            } catch {
                mtimeMs = undefined;
            }
            yield { path: childPath, name: entry.name, handle: entry, mtimeMs };
        } else if (entry.kind === 'directory') {
            yield* traverseBrowserDirectory(entry, childPath);
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function createSampleRecord(
    rootId: string,
    relativePath: string,
    filename: string,
    mtimeMs?: number
): SampleRecord {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const displayName = filename.replace(/\.[^.]+$/, '');
    const folder = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';

    return {
        // §139.4 — NUL separator is the one byte guaranteed not to appear
        // in a POSIX filename. The previous ":" delimiter collided when a
        // folder name legally contained a colon.
        id: `${rootId}\u0000${relativePath}`,
        libraryRootId: rootId,
        relativePath,
        displayName,
        ext,
        folder,
        sync: {
            exists: true,
            mtimeMs,
            status: 'discovered',
        },
        format: {},
        tags: [],
        favorite: false,
    };
}

/**
 * Reconcile the store's persisted view of a root against a completed scan.
 *
 * `scanned` maps each currently-present sample id to its freshly-built record
 * (carrying the on-disk mtime where the provider exposes it). The reconcile:
 *  - removes records whose backing file is gone (a deletion the add-only scan
 *    could never surface);
 *  - replaces records whose mtime changed since last scan (an in-place edit the
 *    deterministic-id dedup would otherwise hide behind stale metadata).
 * New files were already added during streaming, so they need no action here.
 *
 * It must only run after a *complete* scan: a scan that was aborted or skipped
 * unreadable directories has not observed the full file set, and pruning then
 * would delete live samples. The `complete` guard enforces that.
 */
function reconcileScannedRoot(rootId: string, scanned: Map<string, SampleRecord>, complete: boolean): void {
    if (!complete) {
        return;
    }
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    const orphanIds: string[] = [];
    const changed: SampleRecord[] = [];
    for (const stored of state.samples) {
        if (stored.libraryRootId !== rootId) {
            continue;
        }
        const fresh = scanned.get(stored.id);
        if (!fresh) {
            orphanIds.push(stored.id);
            continue;
        }
        // Replace only when both sides expose an mtime and it moved. Undefined
        // mtime (provider can't stat, e.g. Tauri readDir) is treated as "no
        // change signal" so we never churn records we can't compare.
        const freshMtime = fresh.sync.mtimeMs;
        const storedMtime = stored.sync.mtimeMs;
        if (freshMtime !== undefined && storedMtime !== undefined && freshMtime !== storedMtime) {
            changed.push(fresh);
        }
    }

    if (orphanIds.length > 0) {
        removeSamples(orphanIds);
    }
    if (changed.length > 0) {
        // Drop the stale records then re-add the fresh ones (addSamples dedups
        // by id, so the remove must precede the add).
        removeSamples(changed.map((s) => s.id));
        addSamples(changed);
    }
}

// ── Browser directory scanning ───────────────────────────────────────────────

export async function scanBrowserDirectory(root: LibraryRoot): Promise<void> {
    if (!root.handle) {
        return;
    }
    setScanAbortController(new AbortController());
    const signal = getScanAbortController()!.signal;

    setScanProgress(true, 0);

    const batch: SampleRecord[] = [];
    const scanned = new Map<string, SampleRecord>();
    let totalFound = 0;

    try {
        for await (const entry of traverseBrowserDirectory(root.handle, '')) {
            if (signal.aborted) {
                break;
            }

            totalFound++;
            const record = createSampleRecord(root.id, entry.path, entry.name, entry.mtimeMs);
            scanned.set(record.id, record);
            batch.push(record);

            // Batch commit every 100 files
            if (batch.length >= 100) {
                addSamples([...batch]);
                batch.length = 0;
                // Asymptotic approach to 1.0; the finally block snaps to an actual 1.0.
                // The previous 0.95 cap made the bar plateau visibly for mid-size scans.
                setScanProgress(true, totalFound / (totalFound + 20));
            }
        }

        // Commit remaining
        if (batch.length > 0) {
            addSamples([...batch]);
        }

        // Reconcile deletions/edits before the folder tree and persistence read
        // the store, so a removed file disappears from both the UI and IDB.
        // Only when the scan ran to completion — an aborted scan saw a partial
        // file set and pruning then would delete live samples.
        reconcileScannedRoot(root.id, scanned, !signal.aborted);

        updateLibraryRootStatus(root.id, 'ready', totalFound);
        buildFolderTree(root.id);
        await persistLibraryRoots();
        await persistSamples();
    } catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)));
        const { status, message } = classifyScanError(error, root.name);
        updateLibraryRootStatus(root.id, status);
        notifyUser(message, 'error');
    } finally {
        setScanProgress(false, 1);
        setScanAbortController(null);
    }
}

// ── Tauri directory scanning ─────────────────────────────────────────────────

export async function scanTauriDirectory(root: LibraryRoot): Promise<void> {
    setScanAbortController(new AbortController());
    const signal = getScanAbortController()!.signal;
    setScanProgress(true, 0);

    try {
        const batch: SampleRecord[] = [];
        const scanned = new Map<string, SampleRecord>();
        let totalFound = 0;
        const skippedDirs: string[] = [];

        async function scanDir(dirPath: string, relativePath: string): Promise<void> {
            let entries: Awaited<ReturnType<typeof readTauriDirectory>>;
            try {
                entries = await readTauriDirectory({ path: dirPath });
            } catch (error) {
                if (relativePath === '') {
                    throw error;
                }

                // One unreadable subdirectory must not abort the whole scan, but it
                // must not be invisible either: a permission-denied subtree would
                // otherwise leave the root reporting "ready" while silently missing
                // files. Record and log it; the caller surfaces a partial-scan notice.
                skippedDirs.push(relativePath);
                logger.error(error instanceof Error ? error : new Error(String(error)));
                return;
            }

            for (const entry of entries) {
                if (signal.aborted) {
                    return;
                }

                const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

                if (entry.isDirectory) {
                    if (root.settings.recursive) {
                        await scanDir(`${dirPath}/${entry.name}`, entryRelPath);
                    }
                } else if (isAudioFile(entry.name)) {
                    totalFound++;
                    // readDir exposes no mtime, so changed-file detection is
                    // unavailable for Tauri roots; orphan removal still works.
                    const record = createSampleRecord(root.id, entryRelPath, entry.name);
                    scanned.set(record.id, record);
                    batch.push(record);

                    if (batch.length >= 100) {
                        addSamples([...batch]);
                        batch.length = 0;
                        // Asymptotic approach to 1.0; the finally block snaps to an actual 1.0.
                        // The previous 0.95 cap made the bar plateau visibly for mid-size scans.
                        setScanProgress(true, totalFound / (totalFound + 20));
                    }
                }
            }
        }

        await scanDir(root.rootRef, '');

        if (batch.length > 0) {
            addSamples([...batch]);
        }

        // Reconcile only on a complete scan: an aborted scan or one that skipped
        // unreadable subtrees has not seen every file, so pruning would delete
        // live samples that simply weren't visited.
        reconcileScannedRoot(root.id, scanned, !signal.aborted && skippedDirs.length === 0);

        updateLibraryRootStatus(root.id, 'ready', totalFound);
        buildFolderTree(root.id);
        await persistLibraryRoots();
        await persistSamples();

        if (skippedDirs.length > 0) {
            notifyUser(
                `Scanned "${root.name}" but skipped ${skippedDirs.length} unreadable ` +
                    `folder${skippedDirs.length === 1 ? '' : 's'}; some samples may be missing.`,
                'warning'
            );
        }
    } catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)));
        const { status, message } = classifyScanError(error, root.name);
        updateLibraryRootStatus(root.id, status);
        notifyUser(message, 'error');
    } finally {
        setScanProgress(false, 1);
        setScanAbortController(null);
    }
}
