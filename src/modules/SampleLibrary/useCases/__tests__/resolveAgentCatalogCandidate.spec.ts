import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FACTORY_LIBRARY_ROOT_ID } from '#/modules/FactorySynthesis/useCases';

import { type FileProviderKind, type LibraryRoot, type SampleRecord } from '../../models/LibraryTypes';
import { defaultLibraryState, libraryStore } from '../../stores/libraryStore';
import { resolveAgentCatalogCandidate } from '../resolveAgentCatalogCandidate';

const mocks = vi.hoisted(() => ({ resolveDroppedSampleFile: vi.fn() }));

vi.mock('../resolveDroppedSampleFile', () => ({ resolveDroppedSampleFile: mocks.resolveDroppedSampleFile }));

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
    exists?: boolean;
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
        tags: [],
        favorite: false,
    };
}

function seedLibrary(samples: SampleRecord[], roots: LibraryRoot[] = [factoryRoot, nativeRoot]): void {
    libraryStore.set({ ...defaultLibraryState, roots, samples, folderTrees: {} });
}

const CANDIDATE_FILE = new File([new Uint8Array([1, 2, 3])], 'brushed.wav');

function resolverReturnsFile(): void {
    mocks.resolveDroppedSampleFile.mockResolvedValue({
        status: 'resolved',
        provider: 'desktop',
        file: CANDIDATE_FILE,
    });
}

describe('resolveAgentCatalogCandidate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        seedLibrary([]);
    });

    afterEach(() => {
        seedLibrary([]);
    });

    describe('catalog admission', () => {
        it('should refuse an id no indexed record carries, without reading any file', async () => {
            seedLibrary([buildRecord({ id: 'snare-1', displayName: 'Brushed Snare' })]);

            const result = await resolveAgentCatalogCandidate({ candidateId: 'absent' });

            expect(result).toEqual({ status: 'rejected', reason: 'unknown-catalog-id' });
            expect(mocks.resolveDroppedSampleFile).not.toHaveBeenCalled();
        });

        it('should refuse a record the index reports as absent from disk', async () => {
            resolverReturnsFile();
            seedLibrary([buildRecord({ id: 'snare-1', displayName: 'Brushed Snare', exists: false })]);

            const result = await resolveAgentCatalogCandidate({ candidateId: 'snare-1' });

            expect(result).toEqual({ status: 'rejected', reason: 'unknown-catalog-id' });
            expect(mocks.resolveDroppedSampleFile).not.toHaveBeenCalled();
        });

        it('should refuse a record whose library root is no longer connected', async () => {
            resolverReturnsFile();
            seedLibrary([buildRecord({ id: 'snare-1', displayName: 'Brushed Snare' })], [factoryRoot]);

            const result = await resolveAgentCatalogCandidate({ candidateId: 'snare-1' });

            expect(result).toEqual({ status: 'rejected', reason: 'unknown-catalog-id' });
            expect(mocks.resolveDroppedSampleFile).not.toHaveBeenCalled();
        });
    });

    describe('file availability', () => {
        beforeEach(() => {
            seedLibrary([buildRecord({ id: 'snare-1', displayName: 'Brushed Snare' })]);
        });

        it('should report the file unavailable when the library cannot resolve it', async () => {
            mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'unresolved' });

            const result = await resolveAgentCatalogCandidate({ candidateId: 'snare-1' });

            expect(result).toEqual({ status: 'rejected', reason: 'file-unavailable' });
        });

        it('should report the file unavailable when reading it throws', async () => {
            mocks.resolveDroppedSampleFile.mockRejectedValue(new Error('permission revoked'));

            const result = await resolveAgentCatalogCandidate({ candidateId: 'snare-1' });

            expect(result).toEqual({ status: 'rejected', reason: 'file-unavailable' });
        });
    });

    describe('resolved candidate', () => {
        it('should hand back the resolver file itself and name the record the way the library reads it', async () => {
            resolverReturnsFile();
            seedLibrary([
                buildRecord({
                    id: 'snare-1',
                    displayName: 'Brushed Snare',
                    folder: 'snares',
                    relativePath: 'snares/brushed.wav',
                }),
            ]);

            const result = await resolveAgentCatalogCandidate({ candidateId: 'snare-1' });

            if (result.status !== 'resolved') {
                throw new Error(`Expected a resolved candidate, received "${result.reason}".`);
            }
            expect(result.file).toBe(CANDIDATE_FILE);
            expect(mocks.resolveDroppedSampleFile).toHaveBeenCalledWith({
                libraryRootId: NATIVE_ROOT_ID,
                relativePath: 'snares/brushed.wav',
                fallbackName: 'Brushed Snare.wav',
            });
        });

        it('should carry the connected root name and its user licensing', async () => {
            resolverReturnsFile();
            seedLibrary([buildRecord({ id: 'snare-1', displayName: 'Brushed Snare' })]);

            const result = await resolveAgentCatalogCandidate({ candidateId: 'snare-1' });

            if (result.status !== 'resolved') {
                throw new Error(`Expected a resolved candidate, received "${result.reason}".`);
            }
            expect(result.candidate.provenance.libraryRootName).toBe(nativeRoot.name);
            expect(result.candidate.provenance.origin).toBe('connected-library');
            expect(result.candidate.licensing.source).toBe('user-library');
        });

        it('should carry the factory root name and its bundled licensing', async () => {
            resolverReturnsFile();
            seedLibrary([
                buildRecord({ id: 'kick-1', displayName: 'Factory Kick', libraryRootId: FACTORY_LIBRARY_ROOT_ID }),
            ]);

            const result = await resolveAgentCatalogCandidate({ candidateId: 'kick-1' });

            if (result.status !== 'resolved') {
                throw new Error(`Expected a resolved candidate, received "${result.reason}".`);
            }
            expect(result.candidate.provenance.libraryRootName).toBe(factoryRoot.name);
            expect(result.candidate.provenance.origin).toBe('factory');
            expect(result.candidate.licensing.source).toBe('factory');
        });
    });
});
