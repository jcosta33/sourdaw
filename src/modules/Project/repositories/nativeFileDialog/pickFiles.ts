import { isTauri } from '#/helpers/tauriBridge';
import type { OpenFileOptions } from './helpers';
import { openViaTauri } from './helpers';

function pickFilesViaBrowser(options: OpenFileOptions): Promise<File[] | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = options.multiple ?? false;

        if (options.filters && options.filters.length > 0) {
            input.accept = options.filters.flatMap((f) => f.extensions.map((ext) => `.${ext}`)).join(',');
        }

        input.addEventListener('change', () => {
            if (!input.files || input.files.length === 0) {
                resolve(null);
                return;
            }
            const files: File[] = [];
            for (let i = 0; i < input.files.length; i++) {
                files.push(input.files[i]!);
            }
            resolve(files);
        });

        input.addEventListener('cancel', () => {
            resolve(null);
        });

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
            for (const p of paths) {
                const bytes = await fs.readFile(p);
                const name = p.split('/').pop() ?? p.split('\\').pop() ?? p;
                files.push(new File([bytes], name));
            }
            return files.length > 0 ? files : null;
        } catch {
            return pickFilesViaBrowser(options);
        }
    }
    return pickFilesViaBrowser(options);
}