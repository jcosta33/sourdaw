import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FACTORY_LIBRARY_ROOT_ID } from '#/modules/FactorySynthesis/useCases';

import { type AgentCatalogSearchResult } from '../../models/AgentCatalogTypes';
import {
    type Bpm,
    type FileProviderKind,
    type LibraryRoot,
    type SampleAnalysis,
    type SampleRecord,
    toBpm,
} from '../../models/LibraryTypes';
import { embeddingStore } from '../../stores/embeddingStore';
import { defaultLibraryState, libraryStore } from '../../stores/libraryStore';
import { searchAgentCatalog } from '../searchAgentCatalog';

const NATIVE_ROOT_ID = 'user-library';

function buildRoot(args: { id: string; name: string; provider: FileProviderKind }): LibraryRoot {
    return {
        id: args.id,
        name: args.name,
        provider: args.provider,
        rootRef: '',
        connectedAt: 0,
        status: 'ready',
        fileCount: 0,
        settings: { recursive: true },
    };
}

const factoryRoot = buildRoot({ id: FACTORY_LIBRARY_ROOT_ID, name: 'Factory Samples', provider: 'browser' });
const nativeRoot = buildRoot({ id: NATIVE_ROOT_ID, name: 'User Library', provider: 'desktop' });

function buildRecord(args: {
    id: string;
    displayName: string;
    libraryRootId?: string;
    folder?: string;
    relativePath?: string;
    tags?: string[];
    exists?: boolean;
    analysis?: SampleAnalysis;
}): SampleRecord {
    const folder = args.folder ?? 'drums';
    return {
        id: args.id,
        libraryRootId: args.libraryRootId ?? NATIVE_ROOT_ID,
        relativePath: args.relativePath ?? `${folder}/${args.id}.wav`,
        displayName: args.displayName,
        ext: 'wav',
        folder,
        sync: { exists: args.exists ?? true, status: 'indexed' },
        format: { durationSec: 1.5, sampleRate: 48000, channels: 2 },
        analysis: args.analysis,
        tags: args.tags ?? [],
        favorite: false,
    };
}

function seedLibrary(samples: SampleRecord[], roots: LibraryRoot[] = [factoryRoot, nativeRoot]): void {
    libraryStore.set({ ...defaultLibraryState, roots, samples, folderTrees: {} });
}

function seedEmbeddings(entries: [string, Float32Array][]): void {
    embeddingStore.set({ embeddings: new Map(entries), modelStatus: 'ready' });
}

function requireBpm(value: number): Bpm {
    const bpm = toBpm(value);
    if (bpm === undefined) {
        throw new Error(`Test fixture BPM is out of range: ${value}`);
    }
    return bpm;
}

/** Narrow an answer to its `results` branch, failing loudly when it was rejected. */
function expectResults(result: AgentCatalogSearchResult) {
    if (result.status !== 'results') {
        throw new Error(`Expected a results answer, received "${result.status}".`);
    }
    return result;
}

function buildKickPool(count: number): SampleRecord[] {
    const records: SampleRecord[] = [];
    for (let index = 1; index <= count; index++) {
        records.push(buildRecord({ id: `pool-${index}`, displayName: `Kick ${index}` }));
    }
    return records;
}

describe('searchAgentCatalog', () => {
    beforeEach(() => {
        seedLibrary([]);
        seedEmbeddings([]);
    });

    afterEach(() => {
        seedLibrary([]);
        seedEmbeddings([]);
    });

    describe('query admission', () => {
        it('should reject a query carrying neither text nor an anchor', () => {
            expect(searchAgentCatalog({})).toEqual({ status: 'rejected', reason: 'empty-query' });
        });

        it('should reject text that trims to nothing', () => {
            expect(searchAgentCatalog({ text: '   ' })).toEqual({ status: 'rejected', reason: 'empty-query' });
        });

        it('should reject a limit below the admitted range', () => {
            expect(searchAgentCatalog({ text: 'kick', limit: 0 })).toEqual({
                status: 'rejected',
                reason: 'limit-out-of-range',
            });
        });

        it('should reject a limit above the admitted range', () => {
            expect(searchAgentCatalog({ text: 'kick', limit: 25 })).toEqual({
                status: 'rejected',
                reason: 'limit-out-of-range',
            });
        });

        it('should reject a fractional limit', () => {
            expect(searchAgentCatalog({ text: 'kick', limit: 2.5 })).toEqual({
                status: 'rejected',
                reason: 'limit-out-of-range',
            });
        });

        it('should reject an anchor that names no record in the store', () => {
            seedLibrary(buildKickPool(3));

            expect(searchAgentCatalog({ similarTo: 'no-such-id' })).toEqual({
                status: 'rejected',
                reason: 'unknown-catalog-id',
            });
        });

        it('should reject an anchor whose backing file no longer exists', () => {
            seedLibrary([
                buildRecord({ id: 'anchor-gone', displayName: 'Anchor Gone', exists: false }),
                buildRecord({ id: 'neighbour-1', displayName: 'Closed Hat' }),
            ]);
            seedEmbeddings([
                ['anchor-gone', new Float32Array([1, 0])],
                ['neighbour-1', new Float32Array([0.9, 0.1])],
            ]);

            expect(searchAgentCatalog({ similarTo: 'anchor-gone' })).toEqual({
                status: 'rejected',
                reason: 'unknown-catalog-id',
            });
        });

        it('should reject an anchor whose library root is no longer connected', () => {
            seedLibrary(
                [
                    buildRecord({ id: 'anchor-orphan', displayName: 'Anchor Orphan', libraryRootId: 'detached-root' }),
                    buildRecord({ id: 'neighbour-1', displayName: 'Closed Hat' }),
                ],
                [nativeRoot]
            );
            seedEmbeddings([
                ['anchor-orphan', new Float32Array([1, 0])],
                ['neighbour-1', new Float32Array([0.9, 0.1])],
            ]);

            expect(searchAgentCatalog({ similarTo: 'anchor-orphan' })).toEqual({
                status: 'rejected',
                reason: 'unknown-catalog-id',
            });
        });
    });

    describe('bounding', () => {
        it('should answer with the default page while reporting the full match count', () => {
            seedLibrary(buildKickPool(30));

            const result = expectResults(searchAgentCatalog({ text: 'kick' }));

            expect(result.items).toHaveLength(8);
            expect(result.total).toBe(30);
            expect(result.truncated).toBe(true);
        });

        it('should still truncate at the maximum limit when more records match', () => {
            seedLibrary(buildKickPool(30));

            const result = expectResults(searchAgentCatalog({ text: 'kick', limit: 24 }));

            expect(result.items).toHaveLength(24);
            expect(result.truncated).toBe(true);
        });

        it('should report no truncation when the matches fit inside the limit', () => {
            seedLibrary(buildKickPool(10));

            const result = expectResults(searchAgentCatalog({ text: 'kick', limit: 24 }));

            expect(result.items).toHaveLength(10);
            expect(result.truncated).toBe(false);
        });

        it('should report no truncation when the match count exactly equals the default limit', () => {
            seedLibrary(buildKickPool(8));

            const result = expectResults(searchAgentCatalog({ text: 'kick' }));

            expect(result.items).toHaveLength(8);
            expect(result.total).toBe(8);
            expect(result.truncated).toBe(false);
        });

        it('should echo the schema and the effective limit', () => {
            seedLibrary(buildKickPool(10));

            const defaulted = expectResults(searchAgentCatalog({ text: 'kick' }));
            const explicit = expectResults(searchAgentCatalog({ text: 'kick', limit: 5 }));

            expect(defaulted.schema).toBe('sourdaw.agent-catalog-search');
            expect(defaulted.schemaVersion).toBe(1);
            expect(defaulted.query).toEqual({ text: 'kick', similarTo: null, limit: 8 });
            expect(explicit.query.limit).toBe(5);
            expect(explicit.items).toHaveLength(5);
        });
    });

    describe('provenance and licensing', () => {
        beforeEach(() => {
            seedLibrary([
                buildRecord({
                    id: 'factory-kick',
                    displayName: 'Factory Kick',
                    libraryRootId: FACTORY_LIBRARY_ROOT_ID,
                }),
                buildRecord({ id: 'native-kick', displayName: 'Native Kick' }),
            ]);
        });

        it('should mark a factory-root record as bundled factory content', () => {
            const result = expectResults(searchAgentCatalog({ text: 'kick' }));
            const factoryItem = result.items.find((item) => item.id === 'factory-kick');

            expect(factoryItem?.provenance.origin).toBe('factory');
            expect(factoryItem?.licensing.source).toBe('factory');
            expect(factoryItem?.licensing.rightsHolder).toBe('sourdaw');
        });

        it('should carry the full licensing object matching each origin', () => {
            const result = expectResults(searchAgentCatalog({ text: 'kick' }));
            const factoryItem = result.items.find((item) => item.id === 'factory-kick');
            const nativeItem = result.items.find((item) => item.id === 'native-kick');

            expect(factoryItem?.licensing).toEqual({
                source: 'factory',
                rightsHolder: 'sourdaw',
                terms: 'bundled-with-sourdaw',
            });
            expect(nativeItem?.licensing).toEqual({
                source: 'user-library',
                rightsHolder: 'user',
                terms: 'as-licensed-to-the-user',
            });
        });

        it("should mark a connected-root record with the root's own provider", () => {
            const result = expectResults(searchAgentCatalog({ text: 'kick' }));
            const nativeItem = result.items.find((item) => item.id === 'native-kick');

            expect(nativeItem?.provenance.origin).toBe('connected-library');
            expect(nativeItem?.licensing.source).toBe('user-library');
            expect(nativeItem?.provenance.provider).toBe(nativeRoot.provider);
        });

        it('should answer only with licensed entries that exist in the store', () => {
            const result = expectResults(searchAgentCatalog({ text: 'kick' }));
            const storedIds = new Set((libraryStore.value?.samples ?? []).map((record) => record.id));

            expect(result.items.length).toBeGreaterThan(0);
            for (const item of result.items) {
                expect(['factory', 'user-library']).toContain(item.licensing.source);
                expect(storedIds.has(item.id)).toBe(true);
            }
        });
    });

    describe('candidate pool', () => {
        it('should omit a record whose backing file no longer exists', () => {
            seedLibrary([
                buildRecord({ id: 'present-kick', displayName: 'Kick Present' }),
                buildRecord({ id: 'absent-kick', displayName: 'kick missing', exists: false }),
            ]);

            const result = expectResults(searchAgentCatalog({ text: 'kick' }));

            expect(result.items.map((item) => item.id)).toEqual(['present-kick']);
            expect(result.total).toBe(1);
        });

        it('should omit a record whose library root is no longer connected', () => {
            seedLibrary(
                [
                    buildRecord({ id: 'rooted-kick', displayName: 'Kick Rooted' }),
                    buildRecord({ id: 'orphan-kick', displayName: 'Kick Orphan', libraryRootId: 'detached-root' }),
                ],
                [nativeRoot]
            );

            const result = expectResults(searchAgentCatalog({ text: 'kick' }));

            expect(result.items.map((item) => item.id)).toEqual(['rooted-kick']);
        });

        it('should answer with no items when the library store holds no state', () => {
            libraryStore.clear();

            const result = expectResults(searchAgentCatalog({ text: 'kick' }));

            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
            expect(result.truncated).toBe(false);
        });
    });

    describe('text evidence', () => {
        it('should rank a name match above a tag-only match and report each match', () => {
            seedLibrary([
                buildRecord({
                    id: 'named-hit',
                    displayName: 'Snare Tight',
                    folder: 'kits',
                    relativePath: 'kits/tight-01.wav',
                }),
                buildRecord({
                    id: 'tagged-hit',
                    displayName: 'Rimshot',
                    folder: 'kits',
                    relativePath: 'kits/rim-02.wav',
                    tags: ['snare'],
                }),
            ]);

            const result = expectResults(searchAgentCatalog({ text: 'snare' }));

            expect(result.items.map((item) => item.id)).toEqual(['named-hit', 'tagged-hit']);
            expect(result.items[0]?.evidence).toEqual([{ kind: 'name', term: 'snare', matched: 'Snare Tight' }]);
            expect(result.items[1]?.evidence).toEqual([{ kind: 'tag', term: 'snare', matched: 'snare' }]);
        });

        it('should rank a tag match above a path-only match and score each', () => {
            seedLibrary([
                buildRecord({ id: 'tag-hit', displayName: 'Kick Only', tags: ['thump'] }),
                buildRecord({ id: 'path-hit', displayName: 'Kick Also', folder: 'thump-kit' }),
            ]);

            const result = expectResults(searchAgentCatalog({ text: 'thump' }));

            expect(result.items.map((item) => item.id)).toEqual(['tag-hit', 'path-hit']);
            expect(result.items[0]?.score).toBe(2);
            expect(result.items[1]?.score).toBe(1);
        });

        it('should order equal-score matches alphabetically by display name', () => {
            seedLibrary([
                buildRecord({ id: 'k-b', displayName: 'Kick Charlie' }),
                buildRecord({ id: 'k-c', displayName: 'Kick Alpha' }),
                buildRecord({ id: 'k-a', displayName: 'Kick Bravo' }),
            ]);

            const result = expectResults(searchAgentCatalog({ text: 'kick' }));

            expect(result.items.map((item) => item.displayName)).toEqual(['Kick Alpha', 'Kick Bravo', 'Kick Charlie']);
        });

        it('should report a measured figure and a null where the record has none', () => {
            seedLibrary([
                buildRecord({
                    id: 'tempo-kick',
                    displayName: 'Kick Tempo',
                    analysis: { bpm: requireBpm(120) },
                }),
            ]);

            const result = expectResults(searchAgentCatalog({ text: 'kick' }));

            expect(result.items[0]?.descriptors.measurable.bpm).toBe(120);
            expect(result.items[0]?.descriptors.measurable.key).toBeNull();
        });
    });

    describe('similarity evidence', () => {
        beforeEach(() => {
            seedLibrary([
                buildRecord({ id: 'anchor-1', displayName: 'Anchor Loop' }),
                buildRecord({ id: 'neighbour-1', displayName: 'Closed Hat' }),
                buildRecord({ id: 'neighbour-2', displayName: 'Ride Bell' }),
            ]);
        });

        it('should answer with the ranked neighbours and never the anchor', () => {
            seedEmbeddings([
                ['anchor-1', new Float32Array([1, 0])],
                ['neighbour-1', new Float32Array([0.9, 0.1])],
                ['neighbour-2', new Float32Array([0, 1])],
            ]);

            const result = expectResults(searchAgentCatalog({ similarTo: 'anchor-1' }));

            expect(result.items.map((item) => item.id)).toEqual(['neighbour-1', 'neighbour-2']);
            expect(result.items[0]?.evidence).toEqual([{ kind: 'similar-to', anchorId: 'anchor-1', rank: 1 }]);
            expect(result.items[1]?.evidence).toEqual([{ kind: 'similar-to', anchorId: 'anchor-1', rank: 2 }]);
        });

        it('should score similarity evidence by rank distance from the limit ceiling', () => {
            seedEmbeddings([
                ['anchor-1', new Float32Array([1, 0])],
                ['neighbour-1', new Float32Array([0.9, 0.1])],
                ['neighbour-2', new Float32Array([0, 1])],
            ]);

            const result = expectResults(searchAgentCatalog({ similarTo: 'anchor-1' }));

            expect(result.items[0]?.score).toBe(24);
            expect(result.items[1]?.score).toBe(23);
        });

        it('should keep only the neighbours that also match the text, merging both evidences', () => {
            seedEmbeddings([
                ['anchor-1', new Float32Array([1, 0])],
                ['neighbour-1', new Float32Array([0.9, 0.1])],
                ['neighbour-2', new Float32Array([0, 1])],
            ]);

            const result = expectResults(searchAgentCatalog({ similarTo: 'anchor-1', text: 'hat' }));

            expect(result.items.map((item) => item.id)).toEqual(['neighbour-1']);
            expect(result.items[0]?.evidence).toEqual([
                { kind: 'name', term: 'hat', matched: 'Closed Hat' },
                { kind: 'similar-to', anchorId: 'anchor-1', rank: 1 },
            ]);
        });

        it('should warn rather than invent matches when no embedding backs the anchor', () => {
            const result = expectResults(searchAgentCatalog({ similarTo: 'anchor-1' }));

            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
            expect(result.warnings).toEqual(['similarity-unavailable']);
        });
    });

    describe('store isolation', () => {
        it('should leave the store untouched and hand back copies of its records', () => {
            seedLibrary(buildKickPool(3));
            const snapshot = structuredClone(libraryStore.value?.samples ?? []);

            const result = expectResults(searchAgentCatalog({ text: 'kick' }));

            expect(libraryStore.value?.samples).toEqual(snapshot);
            const storedRecord = libraryStore.value?.samples.find((record) => record.id === result.items[0]?.id);
            expect(storedRecord).toBeDefined();
            expect(result.items[0]).not.toBe(storedRecord);
            expect(result.items[0]?.descriptors.textual.tags).not.toBe(storedRecord?.tags);
        });
    });
});
