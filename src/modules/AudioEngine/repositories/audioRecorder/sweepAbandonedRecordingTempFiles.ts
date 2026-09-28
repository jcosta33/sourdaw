import { logger } from '#/infra/logger/appLogger';

import { activeSessions } from './recordingSession';

/** Every take's OPFS temp file: `rec-tmp-<uuid>.pcm`, minted by
 * startAudioRecording and handed to the worker in its `init` message. */
const RECORDING_TEMP_FILE_PATTERN = /^rec-tmp-.+\.pcm$/;

/**
 * Remove `rec-tmp-*.pcm` entries a previous app run abandoned — a crash or
 * force-quit ends the session without any settlement, so nothing removed the
 * take's temp file. Runs once per app run, at the recording repository's
 * first use. Failures are non-fatal: the next run sweeps again.
 *
 * Names held by this run's live sessions are never touched: the enumeration
 * can race a session starting on the same first-use tick, and its file is a
 * name this sweep would otherwise match.
 */
export function sweepAbandonedRecordingTempFilesOnce(): void {
    if (sweepStarted) {
        return;
    }
    sweepStarted = true;
    void sweep().catch((error: unknown) => {
        logger.debug('Recording temp file sweep failed', error);
    });
}

let sweepStarted = false;

/**
 * Whether `name` is the temp file of a session this run holds right now.
 * Tested per entry rather than snapshotted before the loop: the enumeration
 * awaits the directory between entries, and a session registering mid-sweep
 * owns a name a pre-iteration snapshot would have missed.
 */
function isLiveSessionName(name: string): boolean {
    for (const session of activeSessions.values()) {
        if (session.tempFile === name) {
            return true;
        }
    }
    return false;
}

async function sweep(): Promise<string[]> {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
        return [];
    }
    const root = await navigator.storage.getDirectory();
    if (typeof Reflect.get(root, Symbol.asyncIterator) !== 'function') {
        return [];
    }
    const removed: string[] = [];
    for await (const [name, handle] of root as AsyncIterable<
        [string, FileSystemFileHandle | FileSystemDirectoryHandle]
    >) {
        if (handle.kind !== 'file' || !RECORDING_TEMP_FILE_PATTERN.test(name) || isLiveSessionName(name)) {
            continue;
        }
        try {
            await root.removeEntry(name);
            removed.push(name);
        } catch (error: unknown) {
            logger.debug(`Leftover recording temp file ${name} could not be swept`, error);
        }
    }
    return removed;
}
