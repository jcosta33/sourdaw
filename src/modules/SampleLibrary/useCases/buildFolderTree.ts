/**
 * Build a folder tree from the current sample records for a given root.
 * Extracted so it can be called from both connectFolder and restoreLibrary
 * without creating a circular dependency.
 */
import { type FolderNode } from '../models/LibraryTypes';
import { libraryStore, setFolderTree } from '../stores/libraryStore';

export function buildFolderTree(rootId: string): void {
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    const rootSamples = state.samples.filter((s) => s.libraryRootId === rootId);
    const root = state.roots.find((r) => r.id === rootId);
    if (!root) {
        return;
    }

    // Build tree from folder paths
    const treeRoot: FolderNode = {
        name: root.name,
        path: '',
        children: [],
        fileCount: 0,
        expanded: true,
    };

    const folderMap = new Map<string, FolderNode>();
    folderMap.set('', treeRoot);

    for (const sample of rootSamples) {
        const parts = sample.folder.split('/').filter(Boolean);
        let currentPath = '';

        for (const part of parts) {
            const parentPath = currentPath;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (!folderMap.has(currentPath)) {
                const node: FolderNode = {
                    name: part,
                    path: currentPath,
                    children: [],
                    fileCount: 0,
                    expanded: false,
                };
                folderMap.set(currentPath, node);
                const parent = folderMap.get(parentPath);
                if (parent) {
                    parent.children.push(node);
                }
            }
        }

        // Increment file count for the immediate folder and the root
        const folderNode = folderMap.get(sample.folder);
        if (folderNode) {
            folderNode.fileCount++;
        }
        treeRoot.fileCount++;
    }

    // Sort children alphabetically
    function sortTree(node: FolderNode): void {
        node.children.sort((a, b) => a.name.localeCompare(b.name));
        for (const child of node.children) {
            sortTree(child);
        }
    }
    sortTree(treeRoot);

    setFolderTree(rootId, treeRoot);
}
