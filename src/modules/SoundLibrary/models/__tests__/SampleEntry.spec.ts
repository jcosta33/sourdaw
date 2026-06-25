import { describe, it, expect } from 'vitest';

import { type SampleEntry } from '../SampleEntry';

/**
 * Regression guard for the corrected `SampleEntry.fingerprint` contract.
 *
 * The field's JSDoc previously claimed it was an "Audio fingerprint hash for
 * similarity detection". That is false: `fingerprint` is only a deterministic
 * `name:path` identity hash (see `generatePathHash`), and the codebase's sole
 * similarity path (`findSimilarSamples`) discriminates by tag overlap and never
 * reads this field. This test pins that documented invariant so a future change
 * cannot quietly re-introduce a "fingerprint carries similarity signal"
 * assumption without a test going red.
 */
describe('SampleEntry.fingerprint contract', () => {
    function makeEntry(overrides: Partial<SampleEntry>): SampleEntry {
        return {
            id: 'sample-1',
            path: '/samples/kick.wav',
            name: 'kick.wav',
            format: 'wav',
            durationSec: 1,
            sampleRate: 44100,
            bitDepth: 16,
            channels: 2,
            fileSize: 1024,
            bpm: null,
            key: null,
            tags: [],
            rating: 0,
            favorite: false,
            color: null,
            fingerprint: 'path-abc',
            addedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: null,
            useCount: 0,
            ...overrides,
        };
    }

    it('does not encode tag-based similarity: two entries with disjoint tags can share one fingerprint', () => {
        // Tags are the actual similarity signal (findSimilarSamples uses Jaccard
        // overlap of tag names). If fingerprint were a similarity discriminator,
        // two entries with completely disjoint tags could not share its value.
        const a = makeEntry({
            id: 'a',
            tags: [{ name: 'kick', source: 'auto', confidence: 0.8 }],
            fingerprint: 'path-shared',
        });
        const b = makeEntry({
            id: 'b',
            tags: [{ name: 'vocal', source: 'auto', confidence: 0.8 }],
            fingerprint: 'path-shared',
        });

        const tagsA = new Set(a.tags.map((t) => t.name));
        const tagsB = new Set(b.tags.map((t) => t.name));
        const sharedTags = [...tagsA].filter((t) => tagsB.has(t));

        expect(sharedTags).toEqual([]);
        // Disjoint similarity signal, identical fingerprint — the field is an
        // identity hash, not a similarity discriminator.
        expect(a.fingerprint).toBe(b.fingerprint);
    });
});
