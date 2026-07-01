import { inject } from '#/infra/di/inject';

import { readBrowserLibrarySampleFile } from '../repositories/readBrowserLibrarySampleFile';
import { libraryStore } from '../stores/libraryStore';

import { isNativeSampleLibraryRuntimeAvailable } from './isNativeSampleLibraryRuntimeAvailable';
import { readTauriLibrarySampleFile } from './readTauriLibrarySampleFile';

type ResolveDroppedSampleFileInput = {
    libraryRootId: string;
    relativePath: string;
    fallbackName: string;
};

type ResolveDroppedSampleFileOutput = Promise<
    | {
          status: 'resolved';
          provider: 'browser' | 'tauri';
          file: File;
      }
    | {
          status: 'unresolved';
      }
>;

export const resolveDroppedSampleFile = inject({
    libraryStore,
    isNativeSampleLibraryRuntimeAvailable,
    readTauriLibrarySampleFile,
    readBrowserLibrarySampleFile,
})(
    ({
        libraryStore,
        isNativeSampleLibraryRuntimeAvailable,
        readTauriLibrarySampleFile,
        readBrowserLibrarySampleFile,
    }) =>
        async function resolveDroppedSampleFile({
            libraryRootId,
            relativePath,
            fallbackName,
        }: ResolveDroppedSampleFileInput): ResolveDroppedSampleFileOutput {
            const root = libraryStore.value?.roots.find((candidate) => candidate.id === libraryRootId);
            if (!root) {
                return { status: 'unresolved' };
            }

            const nativeRuntimeAvailable = isNativeSampleLibraryRuntimeAvailable();
            if (nativeRuntimeAvailable && root.provider === 'tauri' && root.rootRef) {
                const file = await readTauriLibrarySampleFile({
                    rootPath: root.rootRef,
                    relativePath,
                    fallbackName,
                });
                return { status: 'resolved', provider: 'tauri', file };
            }

            if (!nativeRuntimeAvailable && root.provider === 'browser' && root.handle) {
                const file = await readBrowserLibrarySampleFile({
                    rootHandle: root.handle,
                    relativePath,
                });
                return { status: 'resolved', provider: 'browser', file };
            }

            return { status: 'unresolved' };
        }
);
