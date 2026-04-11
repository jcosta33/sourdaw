import { pickFiles as pickFilesFromNativeFileDialog } from '../repositories/nativeFileDialog/pickFiles';

/**
 * Public contract for file dialog operations.
 */
export function pickFiles(
    ...args: Parameters<typeof pickFilesFromNativeFileDialog>
): ReturnType<typeof pickFilesFromNativeFileDialog> {
    return pickFilesFromNativeFileDialog(...args);
}
