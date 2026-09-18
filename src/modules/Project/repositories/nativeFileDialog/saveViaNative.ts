import { desktopSaveDialog } from '#/utils/desktopBridge';
import { basename_from_path } from '#/utils/path-basename';

import type { DialogFilter } from './helpers';

export type SaveFileOptions = {
    filters?: DialogFilter[];
    suggestedName?: string;
};

/** Native save dialog; resolves the chosen destination path or null when cancelled. Never falls back to a browser picker. */
export async function saveViaNative(options: SaveFileOptions): Promise<string | null> {
    const defaultPath = options.suggestedName === undefined ? undefined : basename_from_path(options.suggestedName);
    return desktopSaveDialog({ defaultPath, filters: options.filters });
}
