import { expect, type Page } from '@playwright/test';

/** Choose a real private directory without automating the browser's external-folder prompt. */
export async function chooseProjectDirectory(page: Page): Promise<void> {
    const selected = await page.evaluate(async () => {
        if (typeof window.showDirectoryPicker !== 'function') {
            throw new Error('The project-save case requires native File System Access');
        }
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle('chosen-project-directory', { create: true });
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: () => Promise.resolve(directory),
        });
        return {
            nativeHandle: directory instanceof FileSystemDirectoryHandle,
            kind: directory.kind,
            permission: await directory.queryPermission({ mode: 'readwrite' }),
        };
    });
    expect(selected).toEqual({ nativeHandle: true, kind: 'directory', permission: 'granted' });
}
