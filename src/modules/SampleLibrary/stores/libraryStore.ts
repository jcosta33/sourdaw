/**
 * Library store — manages connected folder roots, sample records,
 * folder tree state, search, and filter state.
 */
import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type LibraryRoot, type SampleRecord, type FolderNode } from '../models/LibraryTypes';

const logger = Container.getInstance().get(Logger);

export type LibrarySortField = 'name' | 'date' | 'duration' | 'size' | 'path';
export type LibrarySortDirection = 'asc' | 'desc';

export type LibraryState = {
    /** Connected folder roots */
    roots: LibraryRoot[];
    /** All indexed sample records */
    samples: SampleRecord[];
    /** Folder tree built from sample paths */
    folderTree: FolderNode[];
    /** Currently expanded root id (for single-root focus) */
    activeRootId: string | null;
    /** Currently browsed folder path within active root */
    currentFolder: string | null;
    /** Search query */
    searchQuery: string;
    /** Active tag filter */
    tagFilter: string | null;
    /** Show favorites only */
    favoritesOnly: boolean;
    /** Sort */
    sortField: LibrarySortField;
    sortDirection: LibrarySortDirection;
    /** Is scanning in progress */
    scanning: boolean;
    /** Scan progress (0-1) */
    scanProgress: number;
};

export const libraryStore = new Store<LibraryState>(logger, {
    initialData: {
        roots: [],
        samples: [],
        folderTree: [],
        activeRootId: null,
        currentFolder: null,
        searchQuery: '',
        tagFilter: null,
        favoritesOnly: false,
        sortField: 'name',
        sortDirection: 'asc',
        scanning: false,
        scanProgress: 0,
    },
});

// ── Root management ──────────────────────────────────────────────────────────

export function addLibraryRoot(root: LibraryRoot): void {
    const state = libraryStore.value;
    if (!state) {
        return;
    }
    // Don't add duplicates
    if (state.roots.some((r) => r.id === root.id)) {
        return;
    }
    libraryStore.set({
        ...state,
        roots: [...state.roots, root],
        activeRootId: root.id,
    });
}

export function removeLibraryRoot(rootId: string): void {
    const state = libraryStore.value;
    if (!state) {
        return;
    }
    libraryStore.set({
        ...state,
        roots: state.roots.filter((r) => r.id !== rootId),
        samples: state.samples.filter((s) => s.libraryRootId !== rootId),
        activeRootId: state.activeRootId === rootId ? null : state.activeRootId,
    });
}

export function updateLibraryRootStatus(rootId: string, status: LibraryRoot['status'], fileCount?: number): void {
    const state = libraryStore.value;
    if (!state) {
        return;
    }
    libraryStore.set({
        ...state,
        roots: state.roots.map((r) =>
            r.id === rootId ? { ...r, status, fileCount: fileCount ?? r.fileCount, lastScanAt: Date.now() } : r
        ),
    });
}

// ── Sample management ────────────────────────────────────────────────────────

export function addSamples(newSamples: SampleRecord[]): void {
    const state = libraryStore.value;
    if (!state) {
        return;
    }
    // Deduplicate by id
    const existingIds = new Set(state.samples.map((s) => s.id));
    const unique = newSamples.filter((s) => !existingIds.has(s.id));
    libraryStore.set({
        ...state,
        samples: [...state.samples, ...unique],
    });
}

export function toggleSampleFavorite(sampleId: string): void {
    const state = libraryStore.value;
    if (!state) {
        return;
    }
    libraryStore.set({
        ...state,
        samples: state.samples.map((s) => (s.id === sampleId ? { ...s, favorite: !s.favorite } : s)),
    });
}

export function addSampleTag(sampleId: string, tag: string): void {
    const state = libraryStore.value;
    if (!state) {
        return;
    }
    libraryStore.set({
        ...state,
        samples: state.samples.map((s) =>
            s.id === sampleId && !s.tags.includes(tag) ? { ...s, tags: [...s.tags, tag] } : s
        ),
    });
}

// ── UI state ─────────────────────────────────────────────────────────────────

export function setActiveRoot(rootId: string | null): void {
    const state = libraryStore.value;
    if (state) {
        libraryStore.set({ ...state, activeRootId: rootId, currentFolder: null });
    }
}

export function setCurrentFolder(folder: string | null): void {
    const state = libraryStore.value;
    if (state) {
        libraryStore.set({ ...state, currentFolder: folder });
    }
}

export function setSearchQuery(query: string): void {
    const state = libraryStore.value;
    if (state) {
        libraryStore.set({ ...state, searchQuery: query });
    }
}

export function setTagFilter(tag: string | null): void {
    const state = libraryStore.value;
    if (state) {
        libraryStore.set({ ...state, tagFilter: tag });
    }
}

export function setFavoritesOnly(enabled: boolean): void {
    const state = libraryStore.value;
    if (state) {
        libraryStore.set({ ...state, favoritesOnly: enabled });
    }
}

export function setSortField(field: LibrarySortField): void {
    const state = libraryStore.value;
    if (state) {
        libraryStore.set({ ...state, sortField: field });
    }
}

export function setScanProgress(scanning: boolean, progress: number): void {
    const state = libraryStore.value;
    if (state) {
        libraryStore.set({ ...state, scanning, scanProgress: progress });
    }
}

export function setFolderTree(tree: FolderNode[]): void {
    const state = libraryStore.value;
    if (state) {
        libraryStore.set({ ...state, folderTree: tree });
    }
}

export function toggleFolderExpanded(path: string): void {
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    function toggleInTree(nodes: FolderNode[]): FolderNode[] {
        return nodes.map((node) => {
            if (node.path === path) {
                return { ...node, expanded: !node.expanded };
            }
            if (node.children.length > 0) {
                return { ...node, children: toggleInTree(node.children) };
            }
            return node;
        });
    }

    libraryStore.set({ ...state, folderTree: toggleInTree(state.folderTree) });
}
