import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/marker/sectionOperations/removeSection', () => ({
    removeSection: vi.fn(),
}));

vi.mock('../../../useCases/timelineQueries', () => ({
    getMarkerState: vi.fn(),
}));

import { removeSection } from '../../../useCases/marker/sectionOperations/removeSection';
import { getMarkerState } from '../../../useCases/timelineQueries';
import { handleRemoveSection } from '../handleRemoveSection';

const mockedRemove = vi.mocked(removeSection);
const mockedGetState = vi.mocked(getMarkerState);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleRemoveSection — execute', () => {
    it('calls removeSection with sectionId', () => {
        mockedRemove.mockReturnValue(true);
        handleRemoveSection.execute({ type: 'removeSection', payload: { sectionId: 's1' } });
        expect(mockedRemove).toHaveBeenCalledWith('s1');
    });

    it('returns no-write when section not found', () => {
        mockedRemove.mockReturnValue(false);
        const result = handleRemoveSection.execute({ type: 'removeSection', payload: { sectionId: 's1' } });
        expect(result).toEqual({ status: 'no-write' });
    });
});

describe('handleRemoveSection — describe', () => {
    it('returns detailed label with section name and beat range when found', () => {
        mockedGetState.mockReturnValue({
            markers: [],
            sections: [{ id: 's1', name: 'Verse', startBeat: 0, endBeat: 16, color: '#fff' }],
        });
        const result = handleRemoveSection.describe({ type: 'removeSection', payload: { sectionId: 's1' } });
        expect(result.label).toContain('Verse');
        expect(result.label).toContain('0');
        expect(result.label).toContain('16');
    });

    it('returns generic label when section not found', () => {
        mockedGetState.mockReturnValue({ markers: [], sections: [] });
        const result = handleRemoveSection.describe({ type: 'removeSection', payload: { sectionId: 's1' } });
        expect(result.label).toBe('Remove section');
        expect(result.inverseAction).toBeNull();
    });

    it('returns inverse addSection with section data when found', () => {
        mockedGetState.mockReturnValue({
            markers: [],
            sections: [{ id: 's1', name: 'Chorus', startBeat: 8, endBeat: 24, color: '#0f0' }],
        });
        const result = handleRemoveSection.describe({ type: 'removeSection', payload: { sectionId: 's1' } });
        expect(result.inverseAction?.type).toBe('addSection');
        const payload = (
            result.inverseAction as {
                payload: { name: string; startBeat: number; endBeat: number; sectionId: string; color: string };
            }
        ).payload;
        expect(payload.name).toBe('Chorus');
        expect(payload.startBeat).toBe(8);
        expect(payload.endBeat).toBe(24);
        expect(payload.sectionId).toBe('s1');
    });
});
