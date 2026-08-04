import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/marker/markerOperations/addMarker', () => ({
    addMarker: vi.fn(),
}));

vi.mock('../../../useCases/marker/sectionOperations/addSection', () => ({
    addSection: vi.fn(),
}));

vi.mock('../../../useCases/timelineQueries', () => ({
    getMarkerState: vi.fn(),
}));

import { addMarker } from '../../../useCases/marker/markerOperations/addMarker';
import { addSection } from '../../../useCases/marker/sectionOperations/addSection';
import { getMarkerState } from '../../../useCases/timelineQueries';
import { handleAddMarker } from '../handleAddMarker';
import { handleAddSection } from '../handleAddSection';

const mockedAddMarker = vi.mocked(addMarker);
const mockedAddSection = vi.mocked(addSection);
const mockedGetMarkerState = vi.mocked(getMarkerState);

beforeEach(() => {
    vi.clearAllMocks();
    mockedGetMarkerState.mockReturnValue({ markers: [], sections: [] });
});

describe('handleAddMarker — execute', () => {
    it('calls addMarker with beat, name, generated id, and color', () => {
        mockedAddMarker.mockReturnValue(true);
        const action = {
            type: 'addMarker' as const,
            payload: { beat: 8, name: 'Verse', color: '#ff0000' },
        };
        handleAddMarker.execute(action);
        expect(mockedAddMarker).toHaveBeenCalledTimes(1);
        const [beat, name, id, color] = mockedAddMarker.mock.calls[0]!;
        expect(beat).toBe(8);
        expect(name).toBe('Verse');
        expect(id).toMatch(/^marker-/);
        expect(color).toBe('#ff0000');
    });

    it('uses explicit markerId when provided', () => {
        mockedAddMarker.mockReturnValue(true);
        handleAddMarker.execute({
            type: 'addMarker',
            payload: { beat: 0, name: 'X', markerId: 'm1' },
        });
        expect(mockedAddMarker.mock.calls[0]?.[2]).toBe('m1');
    });
});

describe('handleAddMarker — describe', () => {
    it('returns label with marker name and inverse removeMarker', () => {
        const result = handleAddMarker.describe({
            type: 'addMarker',
            payload: { beat: 4, name: 'Chorus', markerId: 'm1' },
        });
        expect(result.label).toBe('Add marker "Chorus"');
        expect(result.inverseAction?.type).toBe('removeMarker');
        expect((result.inverseAction as { payload: { markerId: string } }).payload.markerId).toBe('m1');
    });
});

describe('handleAddMarker — isNoop', () => {
    it('returns false when no markerId provided', () => {
        expect(handleAddMarker.isNoop!({ type: 'addMarker', payload: { beat: 0, name: 'X' } })).toBe(false);
    });

    it('returns false when markerId does not exist', () => {
        mockedGetMarkerState.mockReturnValue({ markers: [{ id: 'other' }], sections: [] } as never);
        expect(handleAddMarker.isNoop!({ type: 'addMarker', payload: { beat: 0, name: 'X', markerId: 'm1' } })).toBe(
            false
        );
    });

    it('returns true when markerId already exists', () => {
        mockedGetMarkerState.mockReturnValue({ markers: [{ id: 'm1' }], sections: [] } as never);
        expect(handleAddMarker.isNoop!({ type: 'addMarker', payload: { beat: 0, name: 'X', markerId: 'm1' } })).toBe(
            true
        );
    });
});

describe('handleAddSection — execute', () => {
    it('calls addSection with startBeat, endBeat, name, generated id, color', () => {
        mockedAddSection.mockReturnValue(true);
        const action = {
            type: 'addSection' as const,
            payload: { startBeat: 0, endBeat: 16, name: 'Verse 1', color: '#00ff00' },
        };
        handleAddSection.execute(action);
        expect(mockedAddSection).toHaveBeenCalledTimes(1);
        const args = mockedAddSection.mock.calls[0]!;
        expect(args[0]).toBe(0);
        expect(args[1]).toBe(16);
        expect(args[2]).toBe('Verse 1');
        expect(args[3]).toMatch(/^section-/);
        expect(args[4]).toBe('#00ff00');
    });

    it('returns no-write when addSection returns false', () => {
        mockedAddSection.mockReturnValue(false);
        const result = handleAddSection.execute({
            type: 'addSection',
            payload: { startBeat: 0, endBeat: 16, name: 'V', sectionId: 's1' },
        });
        expect(result).toEqual({ status: 'no-write' });
    });
});

describe('handleAddSection — describe', () => {
    it('returns label with name and beat range', () => {
        const result = handleAddSection.describe({
            type: 'addSection',
            payload: { startBeat: 0, endBeat: 32, name: 'Bridge', sectionId: 's1' },
        });
        expect(result.label).toBe('Add section "Bridge" from beat 0 to beat 32');
        expect(result.inverseAction?.type).toBe('removeSection');
    });
});

describe('handleAddSection — isNoop', () => {
    it('returns false when no sectionId provided', () => {
        expect(handleAddSection.isNoop!({ type: 'addSection', payload: { startBeat: 0, endBeat: 4, name: 'X' } })).toBe(
            false
        );
    });

    it('returns true when sectionId already exists', () => {
        mockedGetMarkerState.mockReturnValue({ markers: [], sections: [{ id: 's1' }] } as never);
        expect(
            handleAddSection.isNoop!({
                type: 'addSection',
                payload: { startBeat: 0, endBeat: 4, name: 'X', sectionId: 's1' },
            })
        ).toBe(true);
    });
});
