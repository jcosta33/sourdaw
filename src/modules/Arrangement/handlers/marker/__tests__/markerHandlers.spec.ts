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
        mocks.addSection.mockReturnValue(true);
        mocks.removeMarker.mockReturnValue(true);
        mocks.removeSection.mockReturnValue(true);
        mocks.renameSection.mockReturnValue(true);
        mocks.getMarkerState.mockReturnValue(null);
    });

    it('should delegate marker and section actions to Arrangement use cases', async () => {
        await handleAddMarker.execute({ type: 'addMarker', payload: { beat: 4, name: 'Intro' } });
        await handleRemoveMarker.execute({ type: 'removeMarker', payload: { markerId: 'marker1' } });
        await handleSetMarkerColor.execute({ type: 'setMarkerColor', payload: { markerId: 'marker1', color: '#fff' } });
        await handleAddSection.execute({
            type: 'addSection',
            payload: { startBeat: 0, endBeat: 8, name: 'Verse' },
        });
        await handleRemoveSection.execute({ type: 'removeSection', payload: { sectionId: 'section1' } });
        await handleRenameSection.execute({
            type: 'renameSection',
            payload: { sectionId: 'section1', name: 'Chorus' },
        });

        expect(mocks.addMarker).toHaveBeenCalledWith(4, 'Intro', expect.stringMatching(/^marker-/), undefined);
        expect(mocks.removeMarker).toHaveBeenCalledWith('marker1');
        expect(mocks.setMarkerColor).toHaveBeenCalledWith('marker1', '#fff');
        expect(mocks.addSection).toHaveBeenCalledWith(0, 8, 'Verse', expect.stringMatching(/^section-/), undefined);
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

    it('handleAddMarker mints one id shared by the execute call and the inverse', async () => {
        const action: { type: 'addMarker'; payload: { beat: number; name: string; markerId?: string } } = {
            type: 'addMarker',
            payload: { beat: 4, name: 'Intro' },
        };

        const desc = handleAddMarker.describe(action);
        await handleAddMarker.execute(action);

        const inverse = desc.inverseAction;
        if (inverse?.type !== 'removeMarker') {
            throw new Error('expected a removeMarker inverse');
        }
        expect(inverse.payload.markerId).toMatch(/^marker-/);
        expect(mocks.addMarker).toHaveBeenCalledWith(4, 'Intro', inverse.payload.markerId, undefined);
    });

    it('handleAddMarker honors a caller-supplied id', async () => {
        const action: { type: 'addMarker'; payload: { beat: number; name: string; markerId?: string } } = {
            type: 'addMarker',
            payload: { beat: 4, name: 'Intro', markerId: 'marker-fixed' },
        };

        const desc = handleAddMarker.describe(action);
        await handleAddMarker.execute(action);

        expect(mocks.addMarker).toHaveBeenCalledWith(4, 'Intro', 'marker-fixed', undefined);
        expect(desc.inverseAction).toEqual({ type: 'removeMarker', payload: { markerId: 'marker-fixed' } });
    });

    it('handleAddSection mints one id shared by the execute call and the inverse', async () => {
        const action: {
            type: 'addSection';
            payload: { startBeat: number; endBeat: number; name: string; sectionId?: string };
        } = { type: 'addSection', payload: { startBeat: 0, endBeat: 8, name: 'Verse' } };

        const desc = handleAddSection.describe(action);
        await handleAddSection.execute(action);

        const inverse = desc.inverseAction;
        if (inverse?.type !== 'removeSection') {
            throw new Error('expected a removeSection inverse');
        }
        expect(inverse.payload.sectionId).toMatch(/^section-/);
        expect(mocks.addSection).toHaveBeenCalledWith(0, 8, 'Verse', inverse.payload.sectionId, undefined);
    });

    it('handleAddSection suppresses only an identity-bearing replay whose exact id exists', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [],
            sections: [{ id: 'section-existing', startBeat: 0, endBeat: 8, name: 'Verse', color: '#def' }],
        });

        expect(
            handleAddSection.isNoop?.({
                type: 'addSection',
                payload: { startBeat: 0, endBeat: 8, name: 'Verse' },
            })
        ).toBe(false);
        expect(
            handleAddSection.isNoop?.({
                type: 'addSection',
                payload: { startBeat: 16, endBeat: 32, name: 'Different', sectionId: 'section-existing' },
            })
        ).toBe(true);
    });

    it('handleRemoveMarker describes an inverse restoring the exact marker', async () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [{ id: 'm1', beat: 8, name: 'Verse', color: '#abc' }],
            sections: [],
        });

        const desc = handleRemoveMarker.describe({ type: 'removeMarker', payload: { markerId: 'm1' } });

        expect(desc.label).toBe('Remove marker "Verse" at beat 8 (m1)');
        expect(desc.inverseAction).toEqual({
            type: 'addMarker',
            payload: { beat: 8, name: 'Verse', markerId: 'm1', color: '#abc' },
        });
        if (desc.inverseAction?.type !== 'addMarker') {
            throw new Error('expected an addMarker inverse');
        }

        await handleAddMarker.execute(desc.inverseAction);

        expect(mocks.addMarker).toHaveBeenCalledWith(8, 'Verse', 'm1', '#abc');
    });

    it('handleRemoveMarker describes a null inverse when the marker is not found', () => {
        const desc = handleRemoveMarker.describe({ type: 'removeMarker', payload: { markerId: 'missing' } });

        expect(desc.inverseAction).toBeNull();
    });

    it('handleRemoveMarker reports no-write when the target cannot be removed', () => {
        mocks.removeMarker.mockReturnValue(false);

        const result = handleRemoveMarker.execute({ type: 'removeMarker', payload: { markerId: 'missing' } });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('handleRemoveSection describes and restores the exact section', async () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [],
            sections: [{ id: 's1', startBeat: 8, endBeat: 16, name: 'Chorus', color: '#def' }],
        });

        const desc = handleRemoveSection.describe({ type: 'removeSection', payload: { sectionId: 's1' } });

        expect(desc.label).toBe('Remove section "Chorus" from beat 8 to beat 16 (s1)');
        expect(desc.inverseAction).toEqual({
            type: 'addSection',
            payload: { startBeat: 8, endBeat: 16, name: 'Chorus', sectionId: 's1', color: '#def' },
        });
        if (desc.inverseAction?.type !== 'addSection') {
            throw new Error('expected an addSection inverse');
        }

        await handleAddSection.execute(desc.inverseAction);

        expect(mocks.addSection).toHaveBeenCalledWith(8, 16, 'Chorus', 's1', '#def');
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

        expect(desc.label).toBe('Rename section "Old Name" to "New Name" from beat 8 to beat 16 (s1)');
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

    it('section handlers report no-write when their use cases change nothing', () => {
        mocks.addSection.mockReturnValue(false);
        mocks.removeSection.mockReturnValue(false);
        mocks.renameSection.mockReturnValue(false);

        const addResult = handleAddSection.execute({
            type: 'addSection',
            payload: { startBeat: 0, endBeat: 8, name: 'Verse' },
        });
        const removeResult = handleRemoveSection.execute({
            type: 'removeSection',
            payload: { sectionId: 'missing' },
        });
        const renameResult = handleRenameSection.execute({
            type: 'renameSection',
            payload: { sectionId: 'missing', name: 'Verse' },
        });

        expect(addResult).toEqual({ status: 'no-write' });
        expect(removeResult).toEqual({ status: 'no-write' });
        expect(renameResult).toEqual({ status: 'no-write' });
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
            payload: { markerId: 'm1', color: '#old', expectedColor: '#new' },
        });
        expect(desc.redoAction).toEqual({
            type: 'setMarkerColor',
            payload: { markerId: 'm1', color: '#new', expectedColor: '#old' },
        });
    });

    it('handleSetMarkerColor describes a null inverse when the marker is not found', () => {
        const desc = handleSetMarkerColor.describe({
            type: 'setMarkerColor',
            payload: { markerId: 'missing', color: '#new' },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('handleSetMarkerColor refuses a guarded inverse after a collaborator changes the color', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [{ id: 'm1', beat: 8, name: 'Verse', color: '#collaborator' }],
            sections: [],
        });

        const result = handleSetMarkerColor.execute({
            type: 'setMarkerColor',
            payload: { markerId: 'm1', color: '#old', expectedColor: '#new' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setMarkerColor).not.toHaveBeenCalled();
    });

    it('handleSetMarkerColor reports truthful no-write execution', () => {
        mocks.setMarkerColor.mockReturnValue(false);

        const result = handleSetMarkerColor.execute({
            type: 'setMarkerColor',
            payload: { markerId: 'missing', color: '#new' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });
});
