import { type LibraryRoot } from '../../models/LibraryTypes';

/**
 * Map a thrown scan error to a library-root status and a user-facing message.
 * The File System Access / native FS layers surface failure modes as DOMException
 * names (or plain Errors); we distinguish the actionable ones so a revoked-
 * permission folder is not silently reported as merely "offline".
 */
export function classifyScanError(
    error: unknown,
    folderName: string
): { status: LibraryRoot['status']; message: string } {
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
