import { isTauri } from '#/utils/tauriBridge';
import type { OpenFileOptions } from './helpers';
import { openViaBrowser, openViaTauri } from './helpers';

/**
 * Opens a file picker dialog. Uses Tauri's native dialog when running as a
 * desktop app, falling back to a browser `<input type="file">` otherwise.
 *
 * Returns an array of selected file paths (Tauri) or File objects wrapped in
 * a path-like string (browser). Returns `null` when the user cancels.
 */
export async function openFileDialog(options: OpenFileOptions = {}): Promise<string[] | null> {
    if (isTauri()) {
        return openViaTauri(options);
    }
    return openViaBrowser(options);
}