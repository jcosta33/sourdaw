import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractGroove } from '../operations/extractGroove';

const { getAllTracksMock } = vi.hoisted(() => ({
    getAllTracksMock: vi.fn().mockReturnValue([]),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: getAllTracksMock,
}));

describe('extractGroove', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAllTracksMock.mockClear();
    });

    it('uses injected getAllTracks to resolve clip length', () => {
        const template = extractGroove('clip-a', 8);

        expect(getAllTracksMock).toHaveBeenCalled();
        expect(template.subdivisions).toBe(8);
        expect(template.offsets.length).toBe(8);
    });
});
