import { desktopOpenDialog } from '#/utils/desktopBridge';

import { openViaBrowser } from './helpers';

import type { OpenFileOptions, OpenFileSelection } from './helpers';

export async function openViaNative(options: OpenFileOptions): Promise<OpenFileSelection | null> {
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
        return { kind: 'browser-files', files: await openViaBrowser(options) };
    }
}
