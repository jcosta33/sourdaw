/**
 * Module-wide test factory for SoundLibrary sample fixtures.
 *
 * Produces a fully-typed {@link SampleEntry} with sensible defaults so specs can
 * override only the fields a given behaviour cares about. The previous store
 * spec hand-rolled a partial, illegally-shaped sample (a non-existent `category`
 * field, missing required keys, and `!` assertions); this factory makes that
 * impossible — every produced object satisfies the real `SampleEntry` type.
 */

import { type SampleEntry, type SampleTag } from '../models/SampleEntry';

let seq = 0;

export function createTestSample(overrides: Partial<SampleEntry> = {}): SampleEntry {
    seq += 1;
    const id = overrides.id ?? `test-sample-${seq}`;
    const tags: SampleTag[] = overrides.tags ?? [];
    return {
        id,
        path: `/samples/${id}.wav`,
        name: id,
        format: 'wav',
        durationSec: 1,
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        fileSize: 1024,
        bpm: null,
        key: null,
        rating: 0,
        favorite: false,
        color: null,
        fingerprint: `fp-${id}`,
        addedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        useCount: 0,
        ...overrides,
        tags,
    };
}

/** Convenience builder for a `SampleTag` with `source: 'auto'` by default. */
export function createTestTag(name: string, overrides: Partial<SampleTag> = {}): SampleTag {
    return { name, source: 'auto', confidence: 0.8, ...overrides };
}
