import { describe, it, expect, vi } from 'vitest';
import { searchPresets } from '../searchPresets';

vi.mock('#/modules/AiRuntime/services/fuzzySearch', () => ({
    searchPresets: vi.fn(() => [
        {
            score: 150,
            preset: {
                id: 'p1',
                label: 'Best match',
                category: 'Global',
                isDestructive: false,
                buildAction: vi.fn(),
            },
        }
    ]),
}));

describe('searchPresets (aiRuntimeQueries)', () => {
    it('returns fuzzy search results mapped to the public PromptPreset type', () => {
        const results = searchPresets('best', {
            selectedTrackId: undefined,
            selectedClipId: undefined,
            selectedClipType: undefined,
            trackCount: 0,
        });

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            score: 150,
            preset: {
                id: 'p1',
                label: 'Best match',
                category: 'Global',
                isDestructive: false,
            },
        });
    });
});
