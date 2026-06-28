import { basename_from_path } from '#/utils/path-basename';
import { isTauri } from '#/utils/tauriBridge';

import { openViaTauri } from './helpers';

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

/**
 * Opens a file picker and returns the selected File objects.
 * In Tauri, opens the native dialog then reads files via the FS plugin.
 * In the browser, uses a hidden `<input type="file">`.
 * Returns `null` when the user cancels.
 */
export async function pickFiles(options: OpenFileOptions = {}): Promise<File[] | null> {
    if (isTauri()) {
        const paths = await openViaTauri(options);
        if (!paths || paths.length === 0) {
            return null;
        }
        try {
            const modName = '@tauri-apps/plugin-fs';
            const fs = (await import(/* @vite-ignore */ modName)) as {
                readFile: (path: string) => Promise<ArrayBuffer>;
            };
            const files: File[] = [];
            for (const param of paths) {
                const bytes = await fs.readFile(param);
                const name = basename_from_path(param);
                files.push(new File([bytes], name));
            }
            return files.length > 0 ? files : null;
        } catch {
            return pickFilesViaBrowser(options);
        }
    }
    return pickFilesViaBrowser(options);
}
