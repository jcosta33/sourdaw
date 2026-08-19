import { desktopSaveDialog, isDesktopRuntime } from '#/utils/desktopBridge';

import type { DialogFilter } from './helpers';

type SaveFileOptions = {
    defaultPath?: string;
    filters?: DialogFilter[];
};

async function saveViaNative(options: SaveFileOptions): Promise<string | null> {
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
 * Opens a "save file" dialog. Only meaningful in the desktop app — in a browser context
 * there is no native save dialog, so this returns `null` and callers should
 * fall back to blob downloads.
 */
export async function saveFileDialog(options: SaveFileOptions = {}): Promise<string | null> {
    if (!isDesktopRuntime()) {
        return null;
    }
    return saveViaNative(options);
}
