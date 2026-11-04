import { isDesktopRuntime, readFileBytes } from '#/utils/desktopBridge';
import { basename_from_path } from '#/utils/path-basename';

import { openViaBrowser } from './helpers';
import { openViaNative } from './openViaNative';

import type { OpenFileOptions } from './helpers';

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

/**
 * Opens a file picker and returns the selected File objects.
 * On the desktop app, opens the native dialog then reads files via the native path-policy command.
 * A rejected native opening falls back to the browser's File objects without a native path read.
 * In the browser, uses a hidden `<input type="file">`.
 * Returns `null` when the user cancels.
 */
export async function pickFiles(options: OpenFileOptions = {}): Promise<File[] | null> {
    if (isDesktopRuntime()) {
        const selection = await openViaNative(options);
        if (!selection) {
            return null;
        }
        if (!Array.isArray(selection)) {
            return selection.files?.length ? selection.files : null;
        }

        const files: File[] = [];
        for (const param of selection) {
            const bytes = await readFileBytes({ path: param });
            const name = basename_from_path(param);
            files.push(new File([copyBytesToArrayBuffer(bytes)], name));
        }
        return files.length > 0 ? files : null;
    }
    return openViaBrowser(options);
}
