/**
 * Sample database store — manages sample library state.
 *
 * Extracted from sampleDatabaseUseCases.ts — stores should live in stores/.
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
