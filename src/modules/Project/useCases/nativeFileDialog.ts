type DialogFilter = {
    name: string;
    extensions: string[];
};

type OpenFileOptions = {
    filters?: DialogFilter[];
    multiple?: boolean;
};

type SaveFileOptions = {
    defaultPath?: string;
    filters?: DialogFilter[];
};

const isTauri = (): boolean => "__TAURI__" in window;

/**
 * Opens a file picker dialog. Uses Tauri's native dialog when running as a
 * desktop app, falling back to a browser `<input type="file">` otherwise.
 *
 * Returns an array of selected file paths (Tauri) or File objects wrapped in
 * a path-like string (browser). Returns `null` when the user cancels.
 */
export const openFileDialog = async (
    options: OpenFileOptions = {},
): Promise<string[] | null> => {
    if (isTauri()) {
        return openViaTauri(options);
    }
    return openViaBrowser(options);
};

/**
 * Opens a "save file" dialog. Only meaningful in Tauri — in a browser context
 * there is no native save dialog, so this returns `null` and callers should
 * fall back to blob downloads.
 */
export const saveFileDialog = async (
    options: SaveFileOptions = {},
): Promise<string | null> => {
    if (!isTauri()) {
        return null;
    }
    return saveViaTauri(options);
};

// ---------------------------------------------------------------------------
// Tauri paths — dynamic import so the dependency is optional
// ---------------------------------------------------------------------------

const openViaTauri = async (options: OpenFileOptions): Promise<string[] | null> => {
    try {
        const { open } = await import(/* @vite-ignore */ "@tauri-apps/plugin-dialog");
        const result = await open({
            multiple: options.multiple ?? false,
            filters: options.filters,
        });
        if (result === null || result === undefined) {
            return null;
        }
        return Array.isArray(result) ? result : [result];
    } catch {
        return openViaBrowser(options);
    }
};

const saveViaTauri = async (options: SaveFileOptions): Promise<string | null> => {
    try {
        const { save } = await import(/* @vite-ignore */ "@tauri-apps/plugin-dialog");
        const result = await save({
            defaultPath: options.defaultPath,
            filters: options.filters,
        });
        return result ?? null;
    } catch {
        return null;
    }
};

/**
 * Opens a file picker and returns the selected File objects.
 * In Tauri, opens the native dialog then reads files via the FS plugin.
 * In the browser, uses a hidden `<input type="file">`.
 * Returns `null` when the user cancels.
 */
export const pickFiles = async (
    options: OpenFileOptions = {},
): Promise<File[] | null> => {
    if (isTauri()) {
        const paths = await openViaTauri(options);
        if (!paths || paths.length === 0) {
            return null;
        }
        try {
            const modName = "@tauri-apps/plugin-fs";
            const fs = await import(/* @vite-ignore */ modName) as { readFile: (path: string) => Promise<ArrayBuffer> };
            const files: File[] = [];
            for (const p of paths) {
                const bytes = await fs.readFile(p);
                const name = p.split("/").pop() ?? p.split("\\").pop() ?? p;
                files.push(new File([bytes], name));
            }
            return files.length > 0 ? files : null;
        } catch {
            return pickFilesViaBrowser(options);
        }
    }
    return pickFilesViaBrowser(options);
};

// ---------------------------------------------------------------------------
// Browser fallback
// ---------------------------------------------------------------------------

const openViaBrowser = (options: OpenFileOptions): Promise<string[] | null> => {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = options.multiple ?? false;

        if (options.filters && options.filters.length > 0) {
            input.accept = options.filters
                .flatMap((f) => f.extensions.map((ext) => `.${ext}`))
                .join(",");
        }

        input.addEventListener("change", () => {
            if (!input.files || input.files.length === 0) {
                resolve(null);
                return;
            }
            const paths: string[] = [];
            for (let i = 0; i < input.files.length; i++) {
                paths.push(input.files[i]!.name);
            }
            resolve(paths);
        });

        input.addEventListener("cancel", () => {
            resolve(null);
        });

        input.click();
    });
};

const pickFilesViaBrowser = (options: OpenFileOptions): Promise<File[] | null> => {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = options.multiple ?? false;

        if (options.filters && options.filters.length > 0) {
            input.accept = options.filters
                .flatMap((f) => f.extensions.map((ext) => `.${ext}`))
                .join(",");
        }

        input.addEventListener("change", () => {
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

        input.addEventListener("cancel", () => {
            resolve(null);
        });

        input.click();
    });
};
