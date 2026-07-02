export type DialogFilter = {
    name: string;
    extensions: string[];
};

export type OpenFileOptions = {
    filters?: DialogFilter[];
    multiple?: boolean;
};

// ---------------------------------------------------------------------------
// Browser fallback
// ---------------------------------------------------------------------------

export function openViaBrowser(options: OpenFileOptions): Promise<string[] | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = options.multiple ?? false;

        if (options.filters && options.filters.length > 0) {
            input.accept = options.filters.flatMap((freq) => freq.extensions.map((ext) => `.${ext}`)).join(',');
        }

        let settled = false;
        function settle(value: string[] | null): void {
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
            const paths: string[] = [];
            for (let index = 0; index < input.files.length; index++) {
                paths.push(input.files[index]!.name);
            }
            settle(paths);
        });

        input.addEventListener('cancel', () => {
            settle(null);
        });

        window.addEventListener('focus', onFocus);

        input.click();
    });
}
