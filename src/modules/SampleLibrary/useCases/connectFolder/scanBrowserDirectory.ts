import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type LibraryRoot, type SampleRecord } from '../../models/LibraryTypes';
import { persistLibraryRoots } from '../../repositories/libraryPersistence/persistLibraryRoots';
import { persistSamples } from '../../repositories/libraryPersistence/persistSamples';
import { addSamples, setScanProgress, updateLibraryRootStatus } from '../../stores/libraryStore';
import { buildFolderTree } from '../buildFolderTree';

import { classifyScanError } from './classifyScanError';
import { createSampleRecord } from './createSampleRecord';
import { getScanAbortController } from './getScanAbortController';
import { reconcileScannedRoot } from './reconcileScannedRoot';
import { setScanAbortController } from './setScanAbortController';
import { traverseBrowserDirectory } from './traverseBrowserDirectory';

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
