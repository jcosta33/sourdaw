import { isDesktopRuntime } from '#/utils/desktopBridge';

import { openViaBrowser } from './helpers';
import { openViaNative } from './openViaNative';

import type { OpenFileOptions } from './helpers';

/**
 * Opens a file picker dialog. Uses the desktop app's native dialog when running as a
 * desktop app, falling back to a browser `<input type="file">` otherwise.
 *
 * Returns an array of selected file paths (desktop) or File objects wrapped in
 * a path-like string (browser). Returns `null` when the user cancels.
 */
export async function openFileDialog(options: OpenFileOptions = {}): Promise<string[] | null> {
    if (isDesktopRuntime()) {
        return openViaNative(options);
    }
    return openViaBrowser(options);
}
