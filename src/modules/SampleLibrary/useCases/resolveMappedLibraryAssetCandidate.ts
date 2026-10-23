import { inject } from '#/infra/di/inject';

import { isRootReady, type LibraryRoot, type SampleRecord } from '../models/LibraryTypes';
import { createLibraryAssetMappings } from '../repositories/libraryAssetMappings';
import { libraryStore } from '../stores/libraryStore';

import { resolveDroppedSampleFile } from './resolveDroppedSampleFile';

type ResolveMappedLibraryAssetCandidateInput = { hash: string; isCurrent: () => boolean };

const mappings = createLibraryAssetMappings();

function isRelativeFilePath(path: string): boolean {
    return (
        path.length > 0 &&
        !/^[\\/]|^[a-z]:|\0/i.test(path) &&
        path.split(/[\\/]/).every((part) => part.length > 0 && part !== '.' && part !== '..')
    );
}

function matchesLibraryReadSource(
    root: LibraryRoot | undefined,
    sample: SampleRecord | undefined,
    expectedRoot: Pick<LibraryRoot, 'id' | 'provider' | 'rootRef' | 'handle'>,
    relativePath: string
): boolean {
    if (
        !root ||
        !isRootReady(root) ||
        root.provider !== expectedRoot.provider ||
        root.rootRef !== expectedRoot.rootRef ||
        root.handle !== expectedRoot.handle
    ) {
        return false;
    }
    return sample?.libraryRootId === expectedRoot.id && sample.relativePath === relativePath && sample.sync.exists;
}

export const resolveMappedLibraryAssetCandidate = inject({ libraryStore, mappings, resolveDroppedSampleFile })(
    ({ libraryStore, mappings, resolveDroppedSampleFile }) =>
        async function resolveMappedLibraryAssetCandidate({
            hash,
            isCurrent,
        }: ResolveMappedLibraryAssetCandidateInput): Promise<File | null> {
            try {
                if (!isCurrent()) {
                    return null;
                }
                const binding = await mappings.find(hash, isCurrent);
                if (!binding || !isCurrent() || !isRelativeFilePath(binding.relativePath)) {
                    return null;
                }
                const root = libraryStore.value?.roots.find((candidate) => candidate.id === binding.libraryRootId);
                const sample = libraryStore.value?.samples.find((candidate) => candidate.id === binding.sampleId);
                if (
                    !root ||
                    !isRootReady(root) ||
                    !sample ||
                    !sample.sync.exists ||
                    sample.libraryRootId !== root.id ||
                    sample.relativePath !== binding.relativePath
                ) {
                    return null;
                }
                const { provider, rootRef, handle } = root;
                const result = await resolveDroppedSampleFile({
                    libraryRootId: root.id,
                    relativePath: sample.relativePath,
                    fallbackName: sample.displayName,
                });
                const currentRoot = libraryStore.value?.roots.find((candidate) => candidate.id === root.id);
                const currentSample = libraryStore.value?.samples.find((candidate) => candidate.id === sample.id);
                if (
                    !isCurrent() ||
                    !matchesLibraryReadSource(
                        currentRoot,
                        currentSample,
                        { id: root.id, provider, rootRef, handle },
                        binding.relativePath
                    ) ||
                    result.status !== 'resolved'
                ) {
                    return null;
                }
                return result.file;
            } catch {
                return null;
            }
        }
);
