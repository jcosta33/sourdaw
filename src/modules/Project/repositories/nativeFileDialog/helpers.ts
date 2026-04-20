export type DialogFilter = {
    name: string;
    extensions: string[];
};

export type OpenFileOptions = {
    filters?: DialogFilter[];
    multiple?: boolean;
};

export // ---------------------------------------------------------------------------
// Browser fallback
// ---------------------------------------------------------------------------

function openViaBrowser(options: OpenFileOptions): Promise<string[] | null> {
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
            const paths: string[] = [];
            for (let i = 0; i < input.files.length; i++) {
                paths.push(input.files[i]!.name);
            }
            resolve(paths);
        });

        input.addEventListener('cancel', () => {
            resolve(null);
        });

        input.click();
    });
}

export // ---------------------------------------------------------------------------
// Tauri paths — dynamic import so the dependency is optional
// ---------------------------------------------------------------------------

async function openViaTauri(options: OpenFileOptions): Promise<string[] | null> {
    try {
        const { open } = await import(/* @vite-ignore */ '@tauri-apps/plugin-dialog');
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
}
