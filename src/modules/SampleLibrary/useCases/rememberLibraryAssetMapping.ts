import { inject } from '#/infra/di/inject';

import { isRootReady } from '../models/LibraryTypes';
import { createLibraryAssetMappings } from '../repositories/libraryAssetMappings';
import { libraryStore } from '../stores/libraryStore';

type RememberLibraryAssetMappingInput = {
    hash: string;
    sampleId: string;
    libraryRootId: string;
    relativePath: string;
    isCurrent: () => boolean;
};

const mappings = createLibraryAssetMappings();

export const rememberLibraryAssetMapping = inject({ libraryStore, mappings })(
    ({ libraryStore, mappings }) =>
        async function rememberLibraryAssetMapping(input: RememberLibraryAssetMappingInput): Promise<boolean> {
            const { hash, sampleId, libraryRootId, relativePath, isCurrent } = input;
            const root = libraryStore.value?.roots.find((candidate) => candidate.id === libraryRootId);
            const sample = libraryStore.value?.samples.find((candidate) => candidate.id === sampleId);
            if (
                !isCurrent() ||
                !root ||
                !isRootReady(root) ||
                !sample ||
                !sample.sync.exists ||
                sample.libraryRootId !== libraryRootId ||
                sample.relativePath !== relativePath
            ) {
                return false;
            }
            try {
                const remembered = await mappings.remember({ hash, sampleId, libraryRootId, relativePath }, isCurrent);
                return isCurrent() && remembered;
            } catch {
                // Optional local hints cannot roll back an import the project already committed.
                return false;
            }
        }
);
