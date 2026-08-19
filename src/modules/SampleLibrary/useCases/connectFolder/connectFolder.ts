import { basename_from_path } from '#/utils/path-basename';
import { isDesktopRuntime } from '#/utils/desktopRuntime';

import { type LibraryRoot } from '../../models/LibraryTypes';
import { pickNativeSampleFolder } from '../../repositories/pickNativeSampleFolder';
import { addLibraryRoot } from '../../stores/libraryStore';

import { scanBrowserDirectory } from './scanBrowserDirectory';
import { scanNativeDirectory } from './scanNativeDirectory';

async function connectFolderBrowser(): Promise<string | null> {
    // Check for File System Access API support
    if (!('showDirectoryPicker' in window)) {
        // Fallback: alert the user
        return null;
    }

    try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        const id = `lib-${crypto.randomUUID().slice(0, 12)}`;

        const root: LibraryRoot = {
            id,
            name: handle.name,
            provider: 'browser',
            rootRef: handle.name, // We'll persist the handle separately
            handle,
            connectedAt: Date.now(),
            status: 'scanning',
            fileCount: 0,
            settings: { recursive: true },
        };

        addLibraryRoot(root);

        // Start scanning in background
        void scanBrowserDirectory(root);

        return id;
    } catch {
        // User cancelled the picker
        return null;
    }
}

async function connectFolderNative(): Promise<string | null> {
    try {
        const selected = await pickNativeSampleFolder();
        if (!selected) {
            return null;
        }

        const id = `lib-${crypto.randomUUID().slice(0, 12)}`;
        const folderName = basename_from_path(selected);

        const root: LibraryRoot = {
            id,
            name: folderName,
            provider: 'tauri',
            rootRef: selected,
            connectedAt: Date.now(),
            status: 'scanning',
            fileCount: 0,
            settings: { recursive: true },
        };

        addLibraryRoot(root);

        // Start scanning in background
        void scanNativeDirectory(root);

        return id;
    } catch {
        return null;
    }
}

/**
 * Open a folder picker and connect the selected folder as a library root.
 * Returns the root ID if successful, null if cancelled.
 */
export async function connectFolder(): Promise<string | null> {
    if (isDesktopRuntime()) {
        return connectFolderNative();
    }

    return connectFolderBrowser();
}
