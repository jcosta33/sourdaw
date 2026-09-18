import {
    type AgentCatalogDescriptors,
    type AgentCatalogLicensing,
    type AgentCatalogProvenance,
} from '../../models/AgentCatalogTypes';
import { type LibraryRoot, type SampleRecord, type SpectralDescriptors } from '../../models/LibraryTypes';

/**
 * The indexed records an agent-facing answer may be built from, and the
 * provenance and licensing each one carries.
 *
 * Every agent workflow over the catalog — search, audition, placement — reads
 * the same admission rule and derives the same origin, so a record the search
 * refused to name cannot be reached by auditioning or applying it either.
 */

/** A record paired with the root that supplies its provenance. */
export type IndexedEntry = { record: SampleRecord; root: LibraryRoot };

/** The library fields the catalog reads, in model terms so this stays store-free. */
export type IndexedLibrarySnapshot = {
    readonly roots: readonly LibraryRoot[];
    readonly samples: readonly SampleRecord[];
};

/** What the catalog says about one entry, apart from why it was matched. */
export type CatalogEntryDescription = {
    readonly id: string;
    readonly displayName: string;
    readonly provenance: AgentCatalogProvenance;
    readonly licensing: AgentCatalogLicensing;
};

/**
 * Records the catalog may answer with: present on disk, and belonging to a root
 * still in the store. A record whose root is gone has no provenance to derive,
 * and provenance is never guessed.
 */
export function collectIndexedEntries(state: IndexedLibrarySnapshot | null): readonly IndexedEntry[] {
    if (state === null) {
        return [];
    }
    const rootsById = new Map(state.roots.map((root) => [root.id, root]));
    const entries: IndexedEntry[] = [];
    for (const record of state.samples) {
        if (!record.sync.exists) {
            continue;
        }
        const root = rootsById.get(record.libraryRootId);
        if (root === undefined) {
            continue;
        }
        entries.push({ record, root });
    }
    return entries;
}

/** The one entry a catalog id names, or null when the catalog cannot answer with it. */
export function findIndexedEntry(state: IndexedLibrarySnapshot | null, candidateId: string): IndexedEntry | null {
    return collectIndexedEntries(state).find((entry) => entry.record.id === candidateId) ?? null;
}

/**
 * How an entry names its file to the library's file resolvers. One definition,
 * so an entry auditioned and the same entry placed read the same bytes.
 */
export function describeIndexedEntryFile(entry: IndexedEntry): {
    libraryRootId: string;
    relativePath: string;
    fallbackName: string;
} {
    const { record } = entry;
    return {
        libraryRootId: record.libraryRootId,
        relativePath: record.relativePath,
        fallbackName: `${record.displayName}.${record.ext}`,
    };
}

/**
 * The factory root id is a caller argument rather than an import because
 * services stay free of other modules' contract barrels.
 */
function toOrigin(record: SampleRecord, factoryLibraryRootId: string): AgentCatalogProvenance['origin'] {
    return record.libraryRootId === factoryLibraryRootId ? 'factory' : 'connected-library';
}

function toLicensing(origin: AgentCatalogProvenance['origin']): AgentCatalogLicensing {
    if (origin === 'factory') {
        return { source: 'factory', rightsHolder: 'sourdaw', terms: 'bundled-with-sourdaw' };
    }
    return { source: 'user-library', rightsHolder: 'user', terms: 'as-licensed-to-the-user' };
}

function toSpectralDescriptors(descriptors: SpectralDescriptors | undefined): SpectralDescriptors | null {
    if (descriptors === undefined) {
        return null;
    }
    return structuredClone(descriptors);
}

export function toDescriptors(record: SampleRecord): AgentCatalogDescriptors {
    return {
        textual: {
            displayName: record.displayName,
            folder: record.folder,
            ext: record.ext,
            tags: [...record.tags],
        },
        measurable: {
            durationSec: record.format.durationSec ?? null,
            sampleRate: record.format.sampleRate ?? null,
            channels: record.format.channels ?? null,
            bpm: record.analysis?.bpm ?? null,
            key: record.analysis?.key ?? null,
            spectral: toSpectralDescriptors(record.analysis?.descriptors),
        },
    };
}

export function describeCatalogEntry(entry: IndexedEntry, factoryLibraryRootId: string): CatalogEntryDescription {
    const { record, root } = entry;
    const origin = toOrigin(record, factoryLibraryRootId);
    return {
        id: record.id,
        displayName: record.displayName,
        provenance: {
            origin,
            libraryRootId: record.libraryRootId,
            libraryRootName: root.name,
            provider: root.provider,
            relativePath: record.relativePath,
            indexStatus: record.sync.status,
        },
        licensing: toLicensing(origin),
    };
}
