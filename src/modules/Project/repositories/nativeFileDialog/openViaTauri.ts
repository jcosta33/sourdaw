import { desktopOpenDialog } from '#/utils/tauriBridge';

import { openViaBrowser } from './helpers';

import type { OpenFileOptions } from './helpers';

export async function openViaTauri(options: OpenFileOptions): Promise<string[] | null> {
    try {
        const result = await desktopOpenDialog({
            multiple: options.multiple ?? false,
            filters: options.filters,
        });
        if (result === null) {
            return null;
        }
        return Array.isArray(result) ? result : [result];
    } catch {
        return openViaBrowser(options);
    }
}
