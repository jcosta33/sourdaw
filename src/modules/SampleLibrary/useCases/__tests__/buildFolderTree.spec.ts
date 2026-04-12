import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setFolderTree, mockStore } = vi.hoisted(() => {
    const ref = {
        value: null as { samples: { id: string; libraryRootId: string; folder: string }[]; roots: { id: string; name: string }[] } | null,
    };
    const setFolderTree = vi.fn();
    return { setFolderTree, mockStore: ref };
});

vi.mock('../../stores/libraryStore', () => ({
    libraryStore: {
        get value() {
            return mockStore.value;
        },
    },
    setFolderTree,
}));

import { buildFolderTree } from '../buildFolderTree';

describe('buildFolderTree', () => {
    beforeEach(() => {
        setFolderTree.mockClear();
    });

    it('noops when the library store is empty', () => {
        mockStore.value = null;
        buildFolderTree('r1');
        expect(setFolderTree).not.toHaveBeenCalled();
    });

    it('builds a nested tree from sample folder paths and increments file counts', () => {
        mockStore.value = {
            samples: [
                { id: 'a', libraryRootId: 'r1', folder: 'kicks' },
                { id: 'b', libraryRootId: 'r1', folder: 'kicks' },
                { id: 'c', libraryRootId: 'r1', folder: 'snares/acoustic' },
                { id: 'd', libraryRootId: 'r2', folder: 'ignored' },
            ],
            roots: [{ id: 'r1', name: 'My Root' }],
        };

        buildFolderTree('r1');

        expect(setFolderTree).toHaveBeenCalledTimes(1);
        const [rootId, root] = setFolderTree.mock.calls[0]!;
        expect(rootId).toBe('r1');
        expect(root.name).toBe('My Root');
        expect(root.fileCount).toBe(3);
        expect(root.children.map((c: { name: string }) => c.name)).toEqual(['kicks', 'snares']);
        const kicks = root.children.find((c: { name: string }) => c.name === 'kicks')!;
        expect(kicks.fileCount).toBe(2);
        const snares = root.children.find((c: { name: string }) => c.name === 'snares')!;
        expect(snares.children.map((c: { name: string }) => c.name)).toEqual(['acoustic']);
    });
});
