import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/marker/markerOperations/renameMarker', () => ({
    renameMarker: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/moveMarker', () => ({
    moveMarker: vi.fn(),
}));

vi.mock('../../../useCases/marker/sectionOperations/moveSection', () => ({
    moveSection: vi.fn(),
}));

vi.mock('../../../useCases/marker/sectionOperations/resizeSection', () => ({
    resizeSection: vi.fn(),
}));

vi.mock('../../../useCases/marker/sectionOperations/setSectionColor', () => ({
    setSectionColor: vi.fn(),
}));

vi.mock('../../../useCases/marker/sectionOperations/reorderSection', () => ({
    reorderSection: vi.fn(),
}));

vi.mock('../../../useCases/timelineQueries', () => ({
    getMarkerState: vi.fn(),
}));

import { moveMarker } from '../../../useCases/marker/markerOperations/moveMarker';
import { renameMarker } from '../../../useCases/marker/markerOperations/renameMarker';
import { moveSection } from '../../../useCases/marker/sectionOperations/moveSection';
import { reorderSection } from '../../../useCases/marker/sectionOperations/reorderSection';
import { resizeSection } from '../../../useCases/marker/sectionOperations/resizeSection';
import { setSectionColor } from '../../../useCases/marker/sectionOperations/setSectionColor';
import { getMarkerState } from '../../../useCases/timelineQueries';
import { handleMoveMarker } from '../handleMoveMarker';
import { handleMoveSection } from '../handleMoveSection';
import { handleRenameMarker } from '../handleRenameMarker';
import { handleReorderSection } from '../handleReorderSection';
import { handleResizeSection } from '../handleResizeSection';
import { handleSetSectionColor } from '../handleSetSectionColor';

const mockedGetMarkerState = vi.mocked(getMarkerState);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleRenameMarker', () => {
    it('executes the rename', () => {
        handleRenameMarker.execute({ type: 'renameMarker', payload: { markerId: 'm1', name: 'Bridge' } });
        expect(renameMarker).toHaveBeenCalledWith('m1', 'Bridge');
    });

    it('inverts onto the captured prior name', () => {
        mockedGetMarkerState.mockReturnValue({
            markers: [{ id: 'm1', beat: 8, name: 'Chorus', color: '#f00' }],
            sections: [],
        });
        const { inverseAction } = handleRenameMarker.describe({
            type: 'renameMarker',
            payload: { markerId: 'm1', name: 'Bridge' },
        });
        expect(inverseAction).toEqual({ type: 'renameMarker', payload: { markerId: 'm1', name: 'Chorus' } });
    });

    it('carries no inverse when the marker is gone', () => {
        mockedGetMarkerState.mockReturnValue({ markers: [], sections: [] });
        const { inverseAction } = handleRenameMarker.describe({
            type: 'renameMarker',
            payload: { markerId: 'm1', name: 'Bridge' },
        });
        expect(inverseAction).toBeNull();
    });
});

describe('handleMoveMarker', () => {
    it('executes the move', () => {
        handleMoveMarker.execute({ type: 'moveMarker', payload: { markerId: 'm1', beat: 15 } });
        expect(moveMarker).toHaveBeenCalledWith('m1', 15);
    });

    it('inverts onto the captured prior beat', () => {
        mockedGetMarkerState.mockReturnValue({
            markers: [{ id: 'm1', beat: 10, name: 'Intro', color: '#f00' }],
            sections: [],
        });
        const { inverseAction } = handleMoveMarker.describe({
            type: 'moveMarker',
            payload: { markerId: 'm1', beat: 15 },
        });
        expect(inverseAction).toEqual({ type: 'moveMarker', payload: { markerId: 'm1', beat: 10 } });
    });
});

describe('handleMoveSection', () => {
    it('executes the move', () => {
        handleMoveSection.execute({ type: 'moveSection', payload: { sectionId: 's1', startBeat: 4 } });
        expect(moveSection).toHaveBeenCalledWith('s1', 4);
    });

    it('inverts onto the captured prior start, which restores the whole section (duration is kept)', () => {
        mockedGetMarkerState.mockReturnValue({
            markers: [],
            sections: [{ id: 's1', startBeat: 0, endBeat: 16, name: 'Verse', color: '#111' }],
        });
        const { inverseAction } = handleMoveSection.describe({
            type: 'moveSection',
            payload: { sectionId: 's1', startBeat: 4 },
        });
        expect(inverseAction).toEqual({ type: 'moveSection', payload: { sectionId: 's1', startBeat: 0 } });
    });
});

describe('handleResizeSection', () => {
    it('executes the resize', () => {
        handleResizeSection.execute({ type: 'resizeSection', payload: { sectionId: 's1', startBeat: 2, endBeat: 20 } });
        expect(resizeSection).toHaveBeenCalledWith('s1', 2, 20);
    });

    it('inverts onto the captured prior range', () => {
        mockedGetMarkerState.mockReturnValue({
            markers: [],
            sections: [{ id: 's1', startBeat: 0, endBeat: 16, name: 'Verse', color: '#111' }],
        });
        const { inverseAction } = handleResizeSection.describe({
            type: 'resizeSection',
            payload: { sectionId: 's1', startBeat: 2, endBeat: 20 },
        });
        expect(inverseAction).toEqual({
            type: 'resizeSection',
            payload: { sectionId: 's1', startBeat: 0, endBeat: 16 },
        });
    });
});

describe('handleSetSectionColor', () => {
    it('executes the recolour', () => {
        handleSetSectionColor.execute({ type: 'setSectionColor', payload: { sectionId: 's1', color: '#222' } });
        expect(setSectionColor).toHaveBeenCalledWith('s1', '#222');
    });

    it('inverts onto the captured prior color', () => {
        mockedGetMarkerState.mockReturnValue({
            markers: [],
            sections: [{ id: 's1', startBeat: 0, endBeat: 16, name: 'Verse', color: '#111' }],
        });
        const { inverseAction } = handleSetSectionColor.describe({
            type: 'setSectionColor',
            payload: { sectionId: 's1', color: '#222' },
        });
        expect(inverseAction).toEqual({ type: 'setSectionColor', payload: { sectionId: 's1', color: '#111' } });
    });
});

describe('handleReorderSection', () => {
    const contiguousSections = [
        { id: 's1', startBeat: 0, endBeat: 16, name: 'Intro', color: '#111' },
        { id: 's2', startBeat: 16, endBeat: 32, name: 'Verse', color: '#222' },
    ];

    it('executes the reorder', () => {
        handleReorderSection.execute({ type: 'reorderSection', payload: { sectionId: 's1', direction: 'right' } });
        expect(reorderSection).toHaveBeenCalledWith('s1', 'right');
    });

    it('inverts a contiguous swap with the opposite-direction reorder', () => {
        mockedGetMarkerState.mockReturnValue({ markers: [], sections: contiguousSections });
        const { inverseAction } = handleReorderSection.describe({
            type: 'reorderSection',
            payload: { sectionId: 's1', direction: 'right' },
        });
        expect(inverseAction).toEqual({ type: 'reorderSection', payload: { sectionId: 's1', direction: 'left' } });
    });

    it('refuses the inverse when the pair is not contiguous — the opposite reorder would lose the gap', () => {
        mockedGetMarkerState.mockReturnValue({
            markers: [],
            sections: [
                { id: 's1', startBeat: 0, endBeat: 16, name: 'Intro', color: '#111' },
                { id: 's2', startBeat: 24, endBeat: 40, name: 'Verse', color: '#222' },
            ],
        });
        const { inverseAction } = handleReorderSection.describe({
            type: 'reorderSection',
            payload: { sectionId: 's1', direction: 'right' },
        });
        expect(inverseAction).toBeNull();
    });
});
