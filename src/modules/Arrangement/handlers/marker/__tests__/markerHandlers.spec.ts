import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    addMarker: vi.fn(),
    addSection: vi.fn(),
    removeMarker: vi.fn(),
    removeSection: vi.fn(),
    renameSection: vi.fn(),
    setMarkerColor: vi.fn(),
    getMarkerState: vi.fn<
        () => {
            markers: { id: string; beat: number; name: string; color: string }[];
            sections: { id: string; startBeat: number; endBeat: number; name: string; color: string }[];
        } | null
    >(),
}));

vi.mock('../../../useCases/marker/markerOperations/addMarker', () => ({ addMarker: mocks.addMarker }));
vi.mock('../../../useCases/marker/markerOperations/removeMarker', () => ({ removeMarker: mocks.removeMarker }));
vi.mock('../../../useCases/marker/markerOperations/setMarkerColor', () => ({ setMarkerColor: mocks.setMarkerColor }));
vi.mock('../../../useCases/marker/sectionOperations/addSection', () => ({ addSection: mocks.addSection }));
vi.mock('../../../useCases/marker/sectionOperations/removeSection', () => ({ removeSection: mocks.removeSection }));
vi.mock('../../../useCases/marker/sectionOperations/renameSection', () => ({ renameSection: mocks.renameSection }));
vi.mock('../../../useCases/timelineQueries', () => ({ getMarkerState: mocks.getMarkerState }));

import { handleAddMarker } from '../handleAddMarker';
import { handleAddSection } from '../handleAddSection';
import { handleRemoveMarker } from '../handleRemoveMarker';
import { handleRemoveSection } from '../handleRemoveSection';
import { handleRenameSection } from '../handleRenameSection';
import { handleSetMarkerColor } from '../handleSetMarkerColor';

describe('marker action handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.addMarker.mockReturnValue(true);
        mocks.getMarkerState.mockReturnValue(null);
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

        expect(mocks.addMarker).toHaveBeenCalledWith(4, 'Intro', expect.stringMatching(/^marker-/));
        expect(mocks.removeMarker).toHaveBeenCalledWith('marker1');
        expect(mocks.setMarkerColor).toHaveBeenCalledWith('marker1', '#fff');
        expect(mocks.addSection).toHaveBeenCalledWith(0, 8, 'Verse', expect.stringMatching(/^section-/));
        expect(mocks.removeSection).toHaveBeenCalledWith('section1');
        expect(mocks.renameSection).toHaveBeenCalledWith('section1', 'Chorus');
    });

    it('handleAddMarker reports no-write when marker state is unavailable', () => {
        mocks.addMarker.mockReturnValue(false);

        const result = handleAddMarker.execute({ type: 'addMarker', payload: { beat: 4, name: 'Intro' } });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('handleAddMarker preserves identity-less macro repeats and identity-bearing restores', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [{ id: 'marker-existing', beat: 4, name: '  CHORUS  ', color: '#abc' }],
            sections: [],
        });

        expect(handleAddMarker.isNoop?.({ type: 'addMarker', payload: { beat: 4, name: 'chorus' } })).toBe(false);
        expect(
            handleAddMarker.isNoop?.({
                type: 'addMarker',
                payload: { beat: 4, name: 'chorus', markerId: 'marker-restored' },
            })
        ).toBe(false);
    });

    it('handleAddMarker suppresses an identity-bearing replay only when its exact id already exists', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [{ id: 'marker-existing', beat: 4, name: 'Chorus', color: '#abc' }],
            sections: [],
        });

        expect(
            handleAddMarker.isNoop?.({
                type: 'addMarker',
                payload: { beat: 32, name: 'Different', markerId: 'marker-existing' },
            })
        ).toBe(true);
    });

    it('handleAddMarker mints one id shared by the execute call and the inverse', () => {
        const action: { type: 'addMarker'; payload: { beat: number; name: string; markerId?: string } } = {
            type: 'addMarker',
            payload: { beat: 4, name: 'Intro' },
        };

        const desc = handleAddMarker.describe(action);
        handleAddMarker.execute(action);

        const inverse = desc.inverseAction;
        if (inverse?.type !== 'removeMarker') {
            throw new Error('expected a removeMarker inverse');
        }
        expect(inverse.payload.markerId).toMatch(/^marker-/);
        expect(mocks.addMarker).toHaveBeenCalledWith(4, 'Intro', inverse.payload.markerId);
    });

    it('handleAddMarker honors a caller-supplied id', () => {
        const action: { type: 'addMarker'; payload: { beat: number; name: string; markerId?: string } } = {
            type: 'addMarker',
            payload: { beat: 4, name: 'Intro', markerId: 'marker-fixed' },
        };

        const desc = handleAddMarker.describe(action);
        handleAddMarker.execute(action);

        expect(mocks.addMarker).toHaveBeenCalledWith(4, 'Intro', 'marker-fixed');
        expect(desc.inverseAction).toEqual({ type: 'removeMarker', payload: { markerId: 'marker-fixed' } });
    });

    it('handleAddSection mints one id shared by the execute call and the inverse', () => {
        const action: {
            type: 'addSection';
            payload: { startBeat: number; endBeat: number; name: string; sectionId?: string };
        } = { type: 'addSection', payload: { startBeat: 0, endBeat: 8, name: 'Verse' } };

        const desc = handleAddSection.describe(action);
        handleAddSection.execute(action);

        const inverse = desc.inverseAction;
        if (inverse?.type !== 'removeSection') {
            throw new Error('expected a removeSection inverse');
        }
        expect(inverse.payload.sectionId).toMatch(/^section-/);
        expect(mocks.addSection).toHaveBeenCalledWith(0, 8, 'Verse', inverse.payload.sectionId);
    });

    it('handleRemoveMarker describes an inverse restoring the exact marker', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [{ id: 'm1', beat: 8, name: 'Verse', color: '#abc' }],
            sections: [],
        });

        const desc = handleRemoveMarker.describe({ type: 'removeMarker', payload: { markerId: 'm1' } });

        expect(desc.inverseAction).toEqual({
            type: 'addMarker',
            payload: { beat: 8, name: 'Verse', markerId: 'm1', color: '#abc' },
        });
    });

    it('handleRemoveMarker describes a null inverse when the marker is not found', () => {
        const desc = handleRemoveMarker.describe({ type: 'removeMarker', payload: { markerId: 'missing' } });

        expect(desc.inverseAction).toBeNull();
    });

    it('handleRemoveSection describes an inverse restoring the exact section', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [],
            sections: [{ id: 's1', startBeat: 8, endBeat: 16, name: 'Chorus', color: '#def' }],
        });

        const desc = handleRemoveSection.describe({ type: 'removeSection', payload: { sectionId: 's1' } });

        expect(desc.inverseAction).toEqual({
            type: 'addSection',
            payload: { startBeat: 8, endBeat: 16, name: 'Chorus', sectionId: 's1', color: '#def' },
        });
    });

    it('handleRenameSection describes an inverse restoring the previous name', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [],
            sections: [{ id: 's1', startBeat: 8, endBeat: 16, name: 'Old Name', color: '#def' }],
        });

        const desc = handleRenameSection.describe({
            type: 'renameSection',
            payload: { sectionId: 's1', name: 'New Name' },
        });

        expect(desc.inverseAction).toEqual({
            type: 'renameSection',
            payload: { sectionId: 's1', name: 'Old Name' },
        });
    });

    it('handleRemoveSection describes a null inverse when the section is not found', () => {
        const desc = handleRemoveSection.describe({ type: 'removeSection', payload: { sectionId: 'missing' } });

        expect(desc.inverseAction).toBeNull();
    });

    it('handleRenameSection describes a null inverse when the section is not found', () => {
        const desc = handleRenameSection.describe({
            type: 'renameSection',
            payload: { sectionId: 'missing', name: 'New Name' },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('handleSetMarkerColor describes an inverse restoring the previous color', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [{ id: 'm1', beat: 8, name: 'Verse', color: '#old' }],
            sections: [],
        });

        const desc = handleSetMarkerColor.describe({
            type: 'setMarkerColor',
            payload: { markerId: 'm1', color: '#new' },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setMarkerColor',
            payload: { markerId: 'm1', color: '#old' },
        });
    });

    it('handleSetMarkerColor describes a null inverse when the marker is not found', () => {
        const desc = handleSetMarkerColor.describe({
            type: 'setMarkerColor',
            payload: { markerId: 'missing', color: '#new' },
        });

        expect(desc.inverseAction).toBeNull();
    });
});
