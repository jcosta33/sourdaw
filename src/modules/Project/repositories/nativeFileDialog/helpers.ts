export type DialogFilter = {
    name: string;
    extensions: string[];
};

export type OpenFileOptions = {
    filters?: DialogFilter[];
    multiple?: boolean;
};

/** Browser selections carry no native path grant, including cancellation after a rejected native opening. */
export type OpenFileSelection = string[] | { kind: 'browser-files'; files: File[] | null };

export function openViaBrowser(options: OpenFileOptions): Promise<File[] | null> {
    return new Promise((resolve, reject) => {
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

        try {
            input.click();
        } catch (error) {
            if (!settled) {
                settled = true;
                window.removeEventListener('focus', onFocus);
                reject(error);
            }
        }
    });
}
