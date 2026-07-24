import { describe, it, expect, vi, beforeEach } from 'vitest';

import { detectAndApplySongStructure } from '../detectAndApplySongStructure';
import { type DetectedSection } from '../songStructureDetection';

type MockSection = { id: string; startBeat: number; endBeat: number; name: string; color: string };
type MarkerHolder = { value: { sections: MockSection[] } | null };

const mocks = vi.hoisted(() => {
    const holder: MarkerHolder = { value: { sections: [] } };
    return {
        detectSongStructure: vi.fn<(trackId?: string) => DetectedSection[]>(),
        markerStoreValue: holder,
        markerStoreSet: vi.fn(),
    };
});

vi.mock('../detectSongStructure', () => ({
    detectSongStructure: mocks.detectSongStructure,
}));

vi.mock('../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
        set: mocks.markerStoreSet,
    },
}));

describe('detectAndApplySongStructure', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns an empty array and writes nothing when detection finds no sections', () => {
        mocks.detectSongStructure.mockReturnValue([]);

        const result = detectAndApplySongStructure('t1');

        expect(result).toEqual([]);
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });

    it('returns the detected sections without writing when the marker store has not loaded', () => {
        const detected: DetectedSection[] = [
            { startBeat: 0, endBeat: 16, name: 'Intro', color: '#aaa', confidence: 0.9 },
        ];
        mocks.detectSongStructure.mockReturnValue(detected);
        mocks.markerStoreValue.value = null;

        const result = detectAndApplySongStructure('t1');

        expect(result).toBe(detected);
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });

    it('appends the detected sections to the marker store, preserving existing ones', () => {
        const detected: DetectedSection[] = [
            { startBeat: 0, endBeat: 16, name: 'Intro', color: '#intro', confidence: 0.9 },
            { startBeat: 16, endBeat: 32, name: 'Verse', color: '#verse', confidence: 0.8 },
        ];
        mocks.detectSongStructure.mockReturnValue(detected);
        const existing = { id: 'old', startBeat: 0, endBeat: 4, name: 'Old', color: '#old' };
        mocks.markerStoreValue.value = { sections: [existing] };

        const result = detectAndApplySongStructure();

        expect(result).toBe(detected);
        const setCall = mocks.markerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected markerStore.set to be called');
        }
        const newState = setCall[0];
        // existing section preserved, two new appended with detected colors
        expect(newState.sections).toHaveLength(3);
        expect(newState.sections[0]).toEqual(existing);
        expect(newState.sections[1]).toMatchObject({
            startBeat: 0,
            endBeat: 16,
            name: 'Intro',
            color: '#intro',
        });
        expect(newState.sections[2]).toMatchObject({
            startBeat: 16,
            endBeat: 32,
            name: 'Verse',
            color: '#verse',
        });
        // each new section gets a stable id prefix from createSection
        expect(newState.sections[1].id).toMatch(/^section-/);
        expect(newState.sections[2].id).toMatch(/^section-/);
    });
});
