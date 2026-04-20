import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddMarker } from '../handleAddMarker';
import { handleAddSection } from '../handleAddSection';
import { handleRemoveMarker } from '../handleRemoveMarker';
import { handleRemoveSection } from '../handleRemoveSection';
import { handleRenameSection } from '../handleRenameSection';

const mocks = vi.hoisted(() => ({
    addMarker: vi.fn(),
    removeMarker: vi.fn(),
    addSection: vi.fn(),
    removeSection: vi.fn(),
    renameSection: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addMarker: mocks.addMarker,
    removeMarker: mocks.removeMarker,
    addSection: mocks.addSection,
    removeSection: mocks.removeSection,
    renameSection: mocks.renameSection,
}));

describe('Workspace Handlers (Markers & Sections)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('handleAddMarker should delegate to addMarker', () => {
        handleAddMarker.execute({ type: 'addMarker', payload: { beat: 4, name: 'Intro' } });
        expect(mocks.addMarker).toHaveBeenCalledWith(4, 'Intro');
    });

    it('handleRemoveMarker should delegate to removeMarker', () => {
        handleRemoveMarker.execute({ type: 'removeMarker', payload: { markerId: 'm1' } });
        expect(mocks.removeMarker).toHaveBeenCalledWith('m1');
    });

    it('handleAddSection should delegate to addSection', () => {
        handleAddSection.execute({ type: 'addSection', payload: { startBeat: 0, endBeat: 8, name: 'Verse' } });
        expect(mocks.addSection).toHaveBeenCalledWith(0, 8, 'Verse');
    });

    it('handleRemoveSection should delegate to removeSection', () => {
        handleRemoveSection.execute({ type: 'removeSection', payload: { sectionId: 's1' } });
        expect(mocks.removeSection).toHaveBeenCalledWith('s1');
    });

    it('handleRenameSection should delegate to renameSection', () => {
        handleRenameSection.execute({ type: 'renameSection', payload: { sectionId: 's1', name: 'Chorus' } });
        expect(mocks.renameSection).toHaveBeenCalledWith('s1', 'Chorus');
    });
});
