import { describe, it, expect } from 'vitest';

import { matchSoundDesignRecipe, tryCompoundFastPath, isComplexPrompt } from '../parsing';

const ctx = {
    tracks: [{ id: 't1', name: 'Drums', kind: 'audio', clips: [] }],
    selectedTrackId: 't1',
    selectedClipId: null,
    tempo: 120,
    scale: 'major',
    key: 'C',
} as never;

describe('matchSoundDesignRecipe', () => {
    it('matches warm/warmth', () => {
        const result = matchSoundDesignRecipe('make it warmer', 't1');
        expect(result).not.toBeNull();
        expect(result!.length).toBeGreaterThan(0);
        expect(result!.every((a) => a.type === 'addDevice')).toBe(true);
    });

    it('matches punch/punchier', () => {
        const result = matchSoundDesignRecipe('make it punchier', 't1');
        expect(result).not.toBeNull();
    });

    it('matches radio/telephone', () => {
        const result = matchSoundDesignRecipe('radio effect', 't1');
        expect(result).not.toBeNull();
    });

    it('matches lo-fi', () => {
        const result = matchSoundDesignRecipe('lo-fi vibe', 't1');
        expect(result).not.toBeNull();
        expect(result!.length).toBeGreaterThanOrEqual(3);
    });

    it('matches lofi without hyphen', () => {
        const result = matchSoundDesignRecipe('add lofi', 't1');
        expect(result).not.toBeNull();
    });

    it('matches underwater', () => {
        const result = matchSoundDesignRecipe('underwater sound', 't1');
        expect(result).not.toBeNull();
    });

    it('returns null for unrecognized', () => {
        expect(matchSoundDesignRecipe('just play', 't1')).toBeNull();
    });

    it('all recipe actions target the provided trackId', () => {
        const result = matchSoundDesignRecipe('make it warm', 'my-track');
        expect(result).not.toBeNull();
        for (const action of result!) {
            expect((action.payload as { trackId: string }).trackId).toBe('my-track');
        }
    });
});

describe('tryCompoundFastPath', () => {
    it('returns null for simple single action', () => {
        expect(tryCompoundFastPath('add a drum beat', ctx)).toBeNull();
    });
});

describe('isComplexPrompt edge cases', () => {
    it('returns false for empty string', () => {
        expect(isComplexPrompt('')).toBe(false);
    });
    it('returns false for single word', () => {
        expect(isComplexPrompt('play')).toBe(false);
    });
    it('returns true for "X then Y"', () => {
        expect(isComplexPrompt('add drums then add bass')).toBe(true);
    });
});
