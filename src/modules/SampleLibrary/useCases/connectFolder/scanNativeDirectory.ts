import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type LibraryRoot, type SampleRecord, isAudioFile } from '../../models/LibraryTypes';
import { persistLibraryRoots } from '../../repositories/libraryPersistence/persistLibraryRoots';
import { persistSamples } from '../../repositories/libraryPersistence/persistSamples';
import { readNativeDirectory } from '../../repositories/readNativeDirectory';
import { addSamples, setScanProgress, updateLibraryRootStatus } from '../../stores/libraryStore';
import { buildFolderTree } from '../buildFolderTree';

import { classifyScanError } from './classifyScanError';
import { createSampleRecord } from './createSampleRecord';
import { getScanAbortController } from './getScanAbortController';
import { reconcileScannedRoot } from './reconcileScannedRoot';
import { setScanAbortController } from './setScanAbortController';

export async function scanNativeDirectory(root: LibraryRoot): Promise<void> {
    setScanAbortController(new AbortController());
    const signal = getScanAbortController()!.signal;
    setScanProgress(true, 0);

    try {
        const batch: SampleRecord[] = [];
        const scanned = new Map<string, SampleRecord>();
        let totalFound = 0;
        const skippedDirs: string[] = [];

        async function scanDir(dirPath: string, relativePath: string): Promise<void> {
            let entries: Awaited<ReturnType<typeof readNativeDirectory>>;
            try {
                entries = await readNativeDirectory({ path: dirPath });
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
                    // unavailable for native roots; orphan removal still works.
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
