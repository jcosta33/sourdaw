import { isNativeAvailable } from './helpers';

/**
 * Check if native file operations are available.
 */
export function isNativeFileSystemAvailable(): boolean {
    return isNativeAvailable();
}
