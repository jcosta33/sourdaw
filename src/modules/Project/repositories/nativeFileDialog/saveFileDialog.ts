import { desktopSaveDialog, isTauri } from '#/utils/tauriBridge';

import type { DialogFilter } from './helpers';

type SaveFileOptions = {
    defaultPath?: string;
    filters?: DialogFilter[];
};

async function saveViaTauri(options: SaveFileOptions): Promise<string | null> {
    try {
        const result = await desktopSaveDialog({
            defaultPath: options.defaultPath,
            filters: options.filters,
        });
        return result ?? null;
    } catch {
        return null;
    }
}

/**
 * Opens a "save file" dialog. Only meaningful in Tauri — in a browser context
 * there is no native save dialog, so this returns `null` and callers should
 * fall back to blob downloads.
 */
export async function saveFileDialog(options: SaveFileOptions = {}): Promise<string | null> {
    if (!isTauri()) {
        return null;
    }
    return saveViaTauri(options);
}
