import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createTrack: vi.fn(() => ({ id: 'folder-1', name: '', kind: 'folder', color: '#fff', collapsed: false })),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({ createTrack: mocks.createTrack }));

import { createFolder } from '../createFolder';

describe('createFolder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates a folder track with the given name and parentId', () => {
        createFolder({ name: 'Drums', parentId: 'parent-1' });
        expect(mocks.createTrack).toHaveBeenCalledExactlyOnceWith({
            name: 'Drums',
            kind: 'folder',
            parentId: 'parent-1',
        });
    });

    it('applies color override when provided', () => {
        const folder = createFolder({ name: 'X', color: '#abc' });
        expect(folder.color).toBe('#abc');
    });

    it('applies collapsed override when provided', () => {
        const folder = createFolder({ name: 'X', collapsed: true });
        expect(folder.collapsed).toBe(true);
    });

    it('leaves color/collapsed unchanged when overrides omitted', () => {
        const folder = createFolder({ name: 'X' });
        expect(folder.color).toBe('#fff');
        expect(folder.collapsed).toBe(false);
    });
});
