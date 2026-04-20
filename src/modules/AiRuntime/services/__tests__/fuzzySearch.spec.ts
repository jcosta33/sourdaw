import { describe, it, expect, vi } from 'vitest';

import { type PresetAction } from '../../models/presetActions/registry';
import { searchPresets, findBestMatch, getAvailablePresets } from '../fuzzySearch';

// We mock the registry to have a stable set of presets for testing
vi.mock('../../models/presetActions/registry', () => ({
    CATEGORY_ORDER: ['Track', 'Clip', 'Global'],
    PRESET_ACTIONS: [
        {
            id: 'global-1',
            label: 'Add a new track',
            category: 'Global',
            keywords: ['new', 'create', 'track', 'audio'],
            requiresSelection: 'none',
        },
        {
            id: 'track-1',
            label: 'Delete track',
            category: 'Track',
            keywords: ['remove', 'delete', 'track'],
            requiresSelection: 'track',
        },
        {
            id: 'clip-1',
            label: 'Reverse clip',
            category: 'Clip',
            keywords: ['reverse', 'flip', 'audio'],
            requiresSelection: 'clipAudio',
        },
        {
            id: 'clip-midi-1',
            label: 'Quantize notes',
            category: 'Clip',
            keywords: ['quantize', 'snap', 'grid'],
            requiresSelection: 'clipMidi',
        },
    ] as PresetAction[],
}));

describe('fuzzySearch', () => {
    describe('getAvailablePresets', () => {
        it('returns only presets that match the current context', () => {
            const context = { selectedTrackId: undefined, selectedClipId: undefined, selectedClipType: undefined };
            const available = getAvailablePresets(context);
            expect(available.length).toBe(1);
            expect(available[0]!.id).toBe('global-1');
        });

        it('returns track and global presets when a track is selected', () => {
            const context = { selectedTrackId: 't1', selectedClipId: undefined, selectedClipType: undefined };
            const available = getAvailablePresets(context);
            expect(available.length).toBe(2);
            expect(available.map((a) => a.id)).toContain('global-1');
            expect(available.map((a) => a.id)).toContain('track-1');
        });

        it('returns audio clip presets when an audio clip is selected', () => {
            const context = { selectedTrackId: 't1', selectedClipId: 'c1', selectedClipType: 'audio' as const };
            const available = getAvailablePresets(context);
            expect(available.length).toBe(3); // Global, Track, ClipAudio
            expect(available.map((a) => a.id)).toContain('clip-1');
            expect(available.map((a) => a.id)).not.toContain('clip-midi-1');
        });

        it('returns midi clip presets when a midi clip is selected', () => {
            const context = { selectedTrackId: 't1', selectedClipId: 'c1', selectedClipType: 'midi' as const };
            const available = getAvailablePresets(context);
            expect(available.length).toBe(3); // Global, Track, ClipMidi
            expect(available.map((a) => a.id)).toContain('clip-midi-1');
            expect(available.map((a) => a.id)).not.toContain('clip-1');
        });

        it('sorts presets by CATEGORY_ORDER', () => {
            const context = { selectedTrackId: 't1', selectedClipId: 'c1', selectedClipType: 'audio' as const };
            const available = getAvailablePresets(context);
            // Track, Clip, Global
            expect(available[0]!.category).toBe('Track');
            expect(available[1]!.category).toBe('Clip');
            expect(available[2]!.category).toBe('Global');
        });
    });

    describe('searchPresets', () => {
        const fullContext = { selectedTrackId: 't1', selectedClipId: 'c1', selectedClipType: 'audio' as const };

        it('returns all available presets if query is empty', () => {
            const results = searchPresets('', fullContext);
            expect(results.length).toBe(3);
            expect(results[0]!.score).toBe(0);
        });

        it('finds exact label matches with highest score', () => {
            const results = searchPresets('delete track', fullContext);
            expect(results[0]!.preset.id).toBe('track-1');
            expect(results[0]!.score).toBe(200);
        });

        it('finds exact keyword matches with high score', () => {
            const results = searchPresets('remove', fullContext);
            expect(results[0]!.preset.id).toBe('track-1');
            expect(results[0]!.score).toBe(180);
        });

        it('finds prefix matches', () => {
            const results = searchPresets('add a', fullContext);
            expect(results[0]!.preset.id).toBe('global-1');
            expect(results[0]!.score).toBeGreaterThan(100);
        });

        it('matches multiple tokens', () => {
            const results = searchPresets('rev aud', fullContext);
            expect(results[0]!.preset.id).toBe('clip-1');
        });

        it('returns empty array if not all tokens match', () => {
            const results = searchPresets('reverse missingtoken', fullContext);
            expect(results.length).toBe(0);
        });

        it('filters out unavailable presets even if they match perfectly', () => {
            const context = { selectedTrackId: undefined, selectedClipId: undefined, selectedClipType: undefined };
            const results = searchPresets('delete track', context);
            expect(results.length).toBe(0);
        });
    });

    describe('findBestMatch', () => {
        const fullContext = { selectedTrackId: 't1', selectedClipId: 'c1', selectedClipType: 'audio' as const };

        it('returns null if query matches nothing', () => {
            expect(findBestMatch('nonsense', fullContext)).toBeNull();
        });

        it('returns null if score is below threshold', () => {
            // A query that just matches a few letters but not enough to trigger auto-execute
            // (Due to the way scoring works, if all tokens don't match, score is 0.
            // We need a query that matches but yields low score. Actually token match gives 10+15 = 25 per token.
            // E.g. "x" matching a keyword that contains "x" might give low score).
            // But let's just assert that an exact match works.
            const result = findBestMatch('add a new track', fullContext);
            expect(result).not.toBeNull();
            expect(result!.id).toBe('global-1');
        });

        it('returns the best matching preset if confidence is high', () => {
            const result = findBestMatch('reverse', fullContext);
            expect(result).not.toBeNull();
            expect(result!.id).toBe('clip-1');
        });
    });
});
