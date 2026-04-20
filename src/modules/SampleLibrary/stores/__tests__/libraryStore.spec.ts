import { describe, it, expect, beforeEach } from 'vitest';

import {
    libraryStore,
    addLibraryRoot,
    removeLibraryRoot,
    updateLibraryRootStatus,
    addSamples,
    toggleSampleFavorite,
    addSampleTag,
    setActiveRoot,
    setCurrentFolder,
    setSearchQuery,
    setTagFilter,
    setFavoritesOnly,
    setSortField,
    setScanProgress,
    setFolderTree,
    toggleFolderExpanded,
} from '../libraryStore';

describe('libraryStore', () => {
    beforeEach(() => {
        libraryStore.set({
            roots: [],
            samples: [],
            folderTrees: {},
            activeRootId: null,
            currentFolder: null,
            searchQuery: '',
            tagFilter: null,
            favoritesOnly: false,
            sortField: 'name',
            sortDirection: 'asc',
            scanning: false,
            scanProgress: 0,
        });
    });

    it('should have initial state', () => {
        expect(libraryStore.value?.roots).toHaveLength(0);
        expect(libraryStore.value?.samples).toHaveLength(0);
    });

    it('should add and remove a library root', () => {
        const root = {
            id: 'r1',
            name: 'Root 1',
            provider: 'browser' as const,
            rootRef: '',
            connectedAt: 0,
            status: 'ready' as const,
            fileCount: 0,
            settings: { recursive: true },
        };

        addLibraryRoot(root);
        expect(libraryStore.value?.roots).toHaveLength(1);
        expect(libraryStore.value?.activeRootId).toBe('r1');

        // Ignore duplicate
        addLibraryRoot(root);
        expect(libraryStore.value?.roots).toHaveLength(1);

        removeLibraryRoot('r1');
        expect(libraryStore.value?.roots).toHaveLength(0);
        expect(libraryStore.value?.activeRootId).toBeNull();
    });

    it('should update root status', () => {
        const root = {
            id: 'r1',
            name: 'Root 1',
            provider: 'browser' as const,
            rootRef: '',
            connectedAt: 0,
            status: 'offline' as const,
            fileCount: 0,
            settings: { recursive: true },
        };
        addLibraryRoot(root);

        updateLibraryRootStatus('r1', 'ready', 42);
        const r = libraryStore.value?.roots[0];
        expect(r?.status).toBe('ready');
        expect(r?.fileCount).toBe(42);
    });

    it('should add samples', () => {
        const s1 = {
            id: 's1',
            libraryRootId: 'r1',
            relativePath: '',
            displayName: 'Sample 1',
            ext: 'wav',
            folder: '/',
            sync: { exists: true, status: 'discovered' as const },
            format: {},
            tags: [],
            favorite: false,
        };
        addSamples([s1]);

        expect(libraryStore.value?.samples).toHaveLength(1);

        // Ignore duplicate id
        addSamples([s1]);
        expect(libraryStore.value?.samples).toHaveLength(1);
    });

    it('should toggle favorite status', () => {
        const s1 = {
            id: 's1',
            libraryRootId: 'r1',
            relativePath: '',
            displayName: 'Sample 1',
            ext: 'wav',
            folder: '/',
            sync: { exists: true, status: 'discovered' as const },
            format: {},
            tags: [],
            favorite: false,
        };
        addSamples([s1]);

        toggleSampleFavorite('s1');
        expect(libraryStore.value?.samples[0]?.favorite).toBe(true);

        toggleSampleFavorite('s1');
        expect(libraryStore.value?.samples[0]?.favorite).toBe(false);
    });

    it('should add tags', () => {
        const s1 = {
            id: 's1',
            libraryRootId: 'r1',
            relativePath: '',
            displayName: 'Sample 1',
            ext: 'wav',
            folder: '/',
            sync: { exists: true, status: 'discovered' as const },
            format: {},
            tags: [],
            favorite: false,
        };
        addSamples([s1]);

        addSampleTag('s1', 'kick');
        expect(libraryStore.value?.samples[0]?.tags).toContain('kick');

        // Ignore duplicate
        addSampleTag('s1', 'kick');
        expect(libraryStore.value?.samples[0]?.tags).toHaveLength(1);
    });

    it('should handle UI state updates', () => {
        setActiveRoot('r2');
        expect(libraryStore.value?.activeRootId).toBe('r2');

        setCurrentFolder('/test');
        expect(libraryStore.value?.currentFolder).toBe('/test');

        setSearchQuery('snare');
        expect(libraryStore.value?.searchQuery).toBe('snare');

        setTagFilter('drums');
        expect(libraryStore.value?.tagFilter).toBe('drums');

        setFavoritesOnly(true);
        expect(libraryStore.value?.favoritesOnly).toBe(true);

        setSortField('size');
        expect(libraryStore.value?.sortField).toBe('size');

        setScanProgress(true, 0.5);
        expect(libraryStore.value?.scanning).toBe(true);
        expect(libraryStore.value?.scanProgress).toBe(0.5);
    });

    it('should set and expand folder trees', () => {
        const root = {
            id: 'r1',
            name: 'Root 1',
            provider: 'browser' as const,
            rootRef: '',
            connectedAt: 0,
            status: 'ready' as const,
            fileCount: 0,
            settings: { recursive: true },
        };
        addLibraryRoot(root);

        const tree = {
            name: 'Root',
            path: '/',
            fileCount: 0,
            expanded: false,
            children: [{ name: 'Sub', path: '/sub', fileCount: 0, expanded: false, children: [] }],
        };
        setFolderTree('r1', tree);
        expect(libraryStore.value?.folderTrees.r1?.name).toBe('Root');

        toggleFolderExpanded('/sub');
        expect(libraryStore.value?.folderTrees.r1?.children[0]?.expanded).toBe(true);
    });
});
