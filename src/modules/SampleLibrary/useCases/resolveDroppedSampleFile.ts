import { inject } from '#/infra/di/inject';

import { readBrowserLibrarySampleFile } from '../repositories/readBrowserLibrarySampleFile';
import { libraryStore } from '../stores/libraryStore';

import { isNativeSampleLibraryRuntimeAvailable } from './isNativeSampleLibraryRuntimeAvailable';
import { readNativeLibrarySampleFile } from './readNativeLibrarySampleFile';

type ResolveDroppedSampleFileInput = {
    libraryRootId: string;
    relativePath: string;
    fallbackName: string;
};

type ResolveDroppedSampleFileOutput = Promise<
    | {
          status: 'resolved';
          provider: 'browser' | 'desktop';
          file: File;
      }
    | {
          status: 'unresolved';
      }
>;

export const resolveDroppedSampleFile = inject({
    libraryStore,
    isNativeSampleLibraryRuntimeAvailable,
    readNativeLibrarySampleFile,
    readBrowserLibrarySampleFile,
})(
    ({
        libraryStore,
        isNativeSampleLibraryRuntimeAvailable,
        readNativeLibrarySampleFile,
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
            if (nativeRuntimeAvailable && root.provider === 'desktop' && root.rootRef) {
                const file = await readNativeLibrarySampleFile({
                    rootPath: root.rootRef,
                    relativePath,
                    fallbackName,
                });
                return { status: 'resolved', provider: 'desktop', file };
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
