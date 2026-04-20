import { describe, it, expect, vi, beforeEach } from 'vitest';

import { buildFolderTree } from '../buildFolderTree';

const mocks = vi.hoisted(() => ({
    libraryStoreValue: { value: { samples: [], roots: [] } },
    setFolderTree: vi.fn(),
}));

vi.mock('../../stores/libraryStore', () => ({
    libraryStore: {
        get value() {
            return mocks.libraryStoreValue.value;
        },
    },
    setFolderTree: mocks.setFolderTree,
}));

describe('buildFolderTree', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds a hierarchical folder tree from flat sample paths', () => {
        mocks.libraryStoreValue.value = {
            roots: [{ id: 'r1', name: 'My Samples' }],
            samples: [
                { libraryRootId: 'r1', folder: 'Drums/Kicks' },
                { libraryRootId: 'r1', folder: 'Drums/Snares' },
                { libraryRootId: 'r1', folder: 'Vocals' },
            ],
        } as any;

        buildFolderTree('r1');

        expect(mocks.setFolderTree).toHaveBeenCalledTimes(1);
        const [rootId, tree] = mocks.setFolderTree.mock.calls[0];

        expect(rootId).toBe('r1');
        expect(tree.name).toBe('My Samples');
        expect(tree.fileCount).toBe(3);

        // Children: Drums, Vocals
        expect(tree.children).toHaveLength(2);
        expect(tree.children[0].name).toBe('Drums');
        expect(tree.children[1].name).toBe('Vocals');

        // Sub-children of Drums: Kicks, Snares
        expect(tree.children[0].children).toHaveLength(2);
        expect(tree.children[0].children[0].name).toBe('Kicks');
        expect(tree.children[0].children[1].name).toBe('Snares');
    });

    it('bails if root not found', () => {
        mocks.libraryStoreValue.value = { roots: [], samples: [] } as any;
        buildFolderTree('r1');
        expect(mocks.setFolderTree).not.toHaveBeenCalled();
    });
});
