import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    addMarker: vi.fn(),
    addSection: vi.fn(),
    removeMarker: vi.fn(),
    removeSection: vi.fn(),
    renameSection: vi.fn(),
    setMarkerColor: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/addMarker', () => ({ addMarker: mocks.addMarker }));
vi.mock('../../../useCases/marker/markerOperations/removeMarker', () => ({ removeMarker: mocks.removeMarker }));
vi.mock('../../../useCases/marker/markerOperations/setMarkerColor', () => ({ setMarkerColor: mocks.setMarkerColor }));
vi.mock('../../../useCases/marker/sectionOperations/addSection', () => ({ addSection: mocks.addSection }));
vi.mock('../../../useCases/marker/sectionOperations/removeSection', () => ({ removeSection: mocks.removeSection }));
vi.mock('../../../useCases/marker/sectionOperations/renameSection', () => ({ renameSection: mocks.renameSection }));

import { handleAddMarker } from '../handleAddMarker';
import { handleAddSection } from '../handleAddSection';
import { handleRemoveMarker } from '../handleRemoveMarker';
import { handleRemoveSection } from '../handleRemoveSection';
import { handleRenameSection } from '../handleRenameSection';
import { handleSetMarkerColor } from '../handleSetMarkerColor';

describe('marker action handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate marker and section actions to Arrangement use cases', () => {
        handleAddMarker.execute({ type: 'addMarker', payload: { beat: 4, name: 'Intro' } });
        handleRemoveMarker.execute({ type: 'removeMarker', payload: { markerId: 'marker1' } });
        handleSetMarkerColor.execute({ type: 'setMarkerColor', payload: { markerId: 'marker1', color: '#fff' } });
        handleAddSection.execute({
            type: 'addSection',
            payload: { startBeat: 0, endBeat: 8, name: 'Verse' },
        });
        handleRemoveSection.execute({ type: 'removeSection', payload: { sectionId: 'section1' } });
        handleRenameSection.execute({ type: 'renameSection', payload: { sectionId: 'section1', name: 'Chorus' } });

        expect(mocks.addMarker).toHaveBeenCalledWith(4, 'Intro');
        expect(mocks.removeMarker).toHaveBeenCalledWith('marker1');
        expect(mocks.setMarkerColor).toHaveBeenCalledWith('marker1', '#fff');
        expect(mocks.addSection).toHaveBeenCalledWith(0, 8, 'Verse');
        expect(mocks.removeSection).toHaveBeenCalledWith('section1');
        expect(mocks.renameSection).toHaveBeenCalledWith('section1', 'Chorus');
    });
});
