/**
 * Database-style Sample Management
 *
 * Auto-tagging, similarity search, favorites, and categorization
 * for managing large sample libraries efficiently.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type SampleTag = {
    name: string;
    /** Auto-generated or user-provided */
    source: 'auto' | 'user';
    confidence: number;
};

export type SampleEntry = {
    id: string;
    /** File path or URL */
    path: string;
    /** Display name */
    name: string;
    /** File format */
    format: 'wav' | 'mp3' | 'flac' | 'ogg' | 'aiff';
    /** Duration in seconds */
    durationSec: number;
    /** Sample rate */
    sampleRate: number;
    /** Bit depth */
    bitDepth: number;
    /** Channels */
    channels: number;
    /** File size in bytes */
    fileSize: number;
    /** Auto-detected BPM (null if not detected) */
    bpm: number | null;
    /** Auto-detected key (null if not detected) */
    key: string | null;
    /** Category tags */
    tags: SampleTag[];
    /** User rating (0-5) */
    rating: number;
    /** Is favorited */
    favorite: boolean;
    /** Color label */
    color: string | null;
    /** Audio fingerprint hash for similarity detection */
    fingerprint: string;
    /** When this was added to the database */
    addedAt: string;
    /** When last used in a project */
    lastUsedAt: string | null;
    /** Usage count */
    useCount: number;
};

export type SampleCategory =
    | 'kicks'
    | 'snares'
    | 'hi-hats'
    | 'percussion'
    | 'bass'
    | 'synth'
    | 'vocals'
    | 'fx'
    | 'loops'
    | 'one-shots'
    | 'foley'
    | 'pads'
    | 'strings'
    | 'brass'
    | 'woodwinds'
    | 'guitar'
    | 'piano'
    | 'other';

export type SampleDatabaseState = {
    samples: SampleEntry[];
    /** Active search query */
    searchQuery: string;
    /** Active tag filters */
    activeFilters: string[];
    /** Active category filter */
    categoryFilter: SampleCategory | null;
    /** Sort field */
    sortBy: 'name' | 'bpm' | 'duration' | 'rating' | 'addedAt' | 'lastUsedAt' | 'useCount';
    /** Sort direction */
    sortDirection: 'asc' | 'desc';
    /** Show favorites only */
    favoritesOnly: boolean;
};

export const sampleDatabaseStore = new Store<SampleDatabaseState>(logger, {
    initialData: {
        samples: [],
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    },
});

let nextSampleId = 1;

// ── Auto-tagging ──────────────────────────────────────────────────────

const AUTO_TAG_RULES: Array<{ pattern: RegExp; tags: string[]; category: SampleCategory }> = [
    { pattern: /kick|bd|bass.?drum/i, tags: ['kick', 'drum', 'low-end'], category: 'kicks' },
    { pattern: /snare|sd|snr/i, tags: ['snare', 'drum', 'percussive'], category: 'snares' },
    { pattern: /hi.?hat|hh|hat/i, tags: ['hi-hat', 'drum', 'metallic'], category: 'hi-hats' },
    { pattern: /clap|cp/i, tags: ['clap', 'percussive'], category: 'percussion' },
    { pattern: /perc/i, tags: ['percussion', 'rhythmic'], category: 'percussion' },
    { pattern: /bass/i, tags: ['bass', 'low-end'], category: 'bass' },
    { pattern: /synth|lead/i, tags: ['synth', 'melodic'], category: 'synth' },
    { pattern: /vox|vocal|voice/i, tags: ['vocal', 'human'], category: 'vocals' },
    { pattern: /fx|effect|riser|sweep|impact/i, tags: ['fx', 'effect'], category: 'fx' },
    { pattern: /loop|bpm/i, tags: ['loop', 'rhythmic'], category: 'loops' },
    { pattern: /one.?shot|hit|stab/i, tags: ['one-shot', 'short'], category: 'one-shots' },
    { pattern: /foley|ambient|room/i, tags: ['foley', 'ambient'], category: 'foley' },
    { pattern: /pad/i, tags: ['pad', 'sustained', 'atmospheric'], category: 'pads' },
    { pattern: /string|violin|cello|viola/i, tags: ['strings', 'orchestral'], category: 'strings' },
    { pattern: /brass|trumpet|trombone|horn/i, tags: ['brass', 'orchestral'], category: 'brass' },
    { pattern: /flute|oboe|clarinet|sax/i, tags: ['woodwinds', 'orchestral'], category: 'woodwinds' },
    { pattern: /guitar|gtr/i, tags: ['guitar', 'plucked'], category: 'guitar' },
    { pattern: /piano|keys|organ|rhodes/i, tags: ['piano', 'keys'], category: 'piano' },
];

function autoTagSample(name: string, path: string): { tags: SampleTag[]; category: SampleCategory } {
    const tags: SampleTag[] = [];
    let category: SampleCategory = 'other';
    const fullText = `${name} ${path}`;

    for (const rule of AUTO_TAG_RULES) {
        if (rule.pattern.test(fullText)) {
            for (const tag of rule.tags) {
                if (!tags.some((t) => t.name === tag)) {
                    tags.push({ name: tag, source: 'auto', confidence: 0.8 });
                }
            }
            if (category === 'other') {
                category = rule.category;
            }
        }
    }

    // Duration-based tags would go here with actual audio analysis
    return { tags, category };
}

// ── CRUD ──────────────────────────────────────────────────────────────

export function addSample(
    path: string,
    name: string,
    format: SampleEntry['format'],
    durationSec: number,
    sampleRate: number = 44100,
    bitDepth: number = 16,
    channels: number = 2,
    fileSize: number = 0
): SampleEntry {
    const state = sampleDatabaseStore.value;
    if (!state) {
        throw new Error('Sample database not initialized');
    }

    const { tags } = autoTagSample(name, path);

    const sample: SampleEntry = {
        id: `sample-${nextSampleId++}`,
        path,
        name,
        format,
        durationSec,
        sampleRate,
        bitDepth,
        channels,
        fileSize,
        bpm: null,
        key: null,
        tags,
        rating: 0,
        favorite: false,
        color: null,
        fingerprint: generateFingerprint(name, path),
        addedAt: new Date().toISOString(),
        lastUsedAt: null,
        useCount: 0,
    };

    sampleDatabaseStore.set({
        ...state,
        samples: [...state.samples, sample],
    });

    return sample;
}

export function removeSample(sampleId: string): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.filter((s) => s.id !== sampleId),
    });
}

export function toggleFavorite(sampleId: string): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.map((s) =>
            s.id === sampleId ? { ...s, favorite: !s.favorite } : s
        ),
    });
}

export function rateSample(sampleId: string, rating: number): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.map((s) =>
            s.id === sampleId ? { ...s, rating: Math.max(0, Math.min(5, rating)) } : s
        ),
    });
}

export function addUserTag(sampleId: string, tagName: string): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.map((s) =>
            s.id === sampleId
                ? {
                      ...s,
                      tags: [...s.tags, { name: tagName, source: 'user' as const, confidence: 1 }],
                  }
                : s
        ),
    });
}

export function recordUsage(sampleId: string): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.map((s) =>
            s.id === sampleId
                ? { ...s, useCount: s.useCount + 1, lastUsedAt: new Date().toISOString() }
                : s
        ),
    });
}

// ── Search & Filter ───────────────────────────────────────────────────

export function searchSamples(query: string): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({ ...state, searchQuery: query });
}

export function setTagFilter(tags: string[]): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({ ...state, activeFilters: tags });
}

export function setCategoryFilter(category: SampleCategory | null): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({ ...state, categoryFilter: category });
}

export function toggleFavoritesOnly(): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({ ...state, favoritesOnly: !state.favoritesOnly });
}

export function setSortBy(sortBy: SampleDatabaseState['sortBy'], direction?: 'asc' | 'desc'): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        sortBy,
        sortDirection: direction ?? (state.sortBy === sortBy && state.sortDirection === 'asc' ? 'desc' : 'asc'),
    });
}

/**
 * Get filtered, sorted samples.
 */
export function getFilteredSamples(): SampleEntry[] {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return [];
    }

    let results = [...state.samples];

    // Text search
    if (state.searchQuery.trim()) {
        const q = state.searchQuery.toLowerCase();
        results = results.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.path.toLowerCase().includes(q) ||
                s.tags.some((t) => t.name.toLowerCase().includes(q))
        );
    }

    // Tag filters
    if (state.activeFilters.length > 0) {
        results = results.filter((s) =>
            state.activeFilters.every((f) => s.tags.some((t) => t.name === f))
        );
    }

    // Category filter
    if (state.categoryFilter) {
        const catTags = AUTO_TAG_RULES.filter((r) => r.category === state.categoryFilter)
            .flatMap((r) => r.tags);
        results = results.filter((s) => s.tags.some((t) => catTags.includes(t.name)));
    }

    // Favorites filter
    if (state.favoritesOnly) {
        results = results.filter((s) => s.favorite);
    }

    // Sort
    results.sort((a, b) => {
        const dir = state.sortDirection === 'asc' ? 1 : -1;
        switch (state.sortBy) {
            case 'name':
                return a.name.localeCompare(b.name) * dir;
            case 'bpm':
                return ((a.bpm ?? 0) - (b.bpm ?? 0)) * dir;
            case 'duration':
                return (a.durationSec - b.durationSec) * dir;
            case 'rating':
                return (a.rating - b.rating) * dir;
            case 'addedAt':
                return a.addedAt.localeCompare(b.addedAt) * dir;
            case 'lastUsedAt':
                return (a.lastUsedAt ?? '').localeCompare(b.lastUsedAt ?? '') * dir;
            case 'useCount':
                return (a.useCount - b.useCount) * dir;
            default:
                return 0;
        }
    });

    return results;
}

/**
 * Find similar samples by fingerprint or tag overlap.
 */
export function findSimilarSamples(sampleId: string, limit: number = 10): SampleEntry[] {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return [];
    }

    const target = state.samples.find((s) => s.id === sampleId);
    if (!target) {
        return [];
    }

    const targetTags = new Set(target.tags.map((t) => t.name));

    return state.samples
        .filter((s) => s.id !== sampleId)
        .map((s) => {
            const sampleTags = new Set(s.tags.map((t) => t.name));
            const overlap = [...targetTags].filter((t) => sampleTags.has(t)).length;
            const total = new Set([...targetTags, ...sampleTags]).size || 1;
            return { sample: s, similarity: overlap / total };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .map((r) => r.sample);
}

// ── Helpers ──────────────────────────────────────────────────────────

function generateFingerprint(name: string, path: string): string {
    // Simple hash — in production this would be an audio perceptual hash
    let hash = 0;
    const str = `${name}:${path}`;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0;
    }
    return `fp-${Math.abs(hash).toString(36)}`;
}

export function getSampleCount(): number {
    return sampleDatabaseStore.value?.samples.length ?? 0;
}

export function getAllTags(): string[] {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return [];
    }
    const tagSet = new Set<string>();
    for (const sample of state.samples) {
        for (const tag of sample.tags) {
            tagSet.add(tag.name);
        }
    }
    return [...tagSet].sort();
}
