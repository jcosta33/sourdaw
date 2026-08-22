import { isDesktopRuntime, readFileBytes } from '#/utils/desktopBridge';
import { basename_from_path } from '#/utils/path-basename';

import { openViaNative } from './openViaNative';

import type { OpenFileOptions } from './helpers';

function pickFilesViaBrowser(options: OpenFileOptions): Promise<File[] | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = options.multiple ?? false;

        if (options.filters && options.filters.length > 0) {
            input.accept = options.filters.flatMap((freq) => freq.extensions.map((ext) => `.${ext}`)).join(',');
        }

        let settled = false;
        function settle(value: File[] | null): void {
            if (settled) {
                return;
            }
            settled = true;
            window.removeEventListener('focus', onFocus);
            resolve(value);
        }

        // The `cancel` event is not fired by every environment (older Electron /
        // Chromium builds never emit it), so a dismissed dialog would otherwise
        // leave this Promise pending forever. When focus returns to the window
        // without a `change` having fired, treat it as a cancel. The timeout
        // gives a genuine `change` event time to land first.
        function onFocus(): void {
            setTimeout(() => {
                settle(null);
            }, 300);
        }

        input.addEventListener('change', () => {
            if (!input.files || input.files.length === 0) {
                settle(null);
                return;
            }
            const files: File[] = [];
            for (let index = 0; index < input.files.length; index++) {
                files.push(input.files[index]!);
            }
            settle(files);
        });

        input.addEventListener('cancel', () => {
            settle(null);
        });

        window.addEventListener('focus', onFocus);

        input.click();
    });
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

/**
 * Opens a file picker and returns the selected File objects.
 * On the desktop app, opens the native dialog then reads files via the native path-policy command.
 * In the browser, uses a hidden `<input type="file">`.
 * Returns `null` when the user cancels.
 */
export async function pickFiles(options: OpenFileOptions = {}): Promise<File[] | null> {
    if (isDesktopRuntime()) {
        const paths = await openViaNative(options);
        if (!paths || paths.length === 0) {
            return null;
        }

        const files: File[] = [];
        for (const param of paths) {
            const bytes = await readFileBytes({ path: param });
            const name = basename_from_path(param);
            files.push(new File([copyBytesToArrayBuffer(bytes)], name));
        }
        return files.length > 0 ? files : null;
    }
    return pickFilesViaBrowser(options);
}
