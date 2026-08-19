import { inject } from '#/infra/di/inject';
import { basename_from_path } from '#/utils/path-basename';

import { readNativeAudioFileBytes } from '../repositories/readNativeAudioFileBytes';

type ReadNativeLibrarySampleFileInput = {
    rootPath: string;
    relativePath: string;
    fallbackName: string;
};

type ReadNativeLibrarySampleFileOutput = Promise<File>;

export const readNativeLibrarySampleFile = inject({ readNativeAudioFileBytes })(
    ({ readNativeAudioFileBytes }) =>
        async function readNativeLibrarySampleFile({
            rootPath,
            relativePath,
            fallbackName,
        }: ReadNativeLibrarySampleFileInput): ReadNativeLibrarySampleFileOutput {
            const trimmedRootPath = rootPath.replace(/[\\/]+$/, '');
            const pathSeparator = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/';
            const normalizedRelativePath = relativePath.replace(/^[\\/]+/, '').replaceAll(/[\\/]+/g, pathSeparator);

            let absolutePath = trimmedRootPath;
            if (normalizedRelativePath.length > 0) {
                if (trimmedRootPath.length > 0) {
                    absolutePath = `${trimmedRootPath}${pathSeparator}${normalizedRelativePath}`;
                } else {
                    absolutePath = `${pathSeparator}${normalizedRelativePath}`;
                }
            }

            const bytes = await readNativeAudioFileBytes({ path: absolutePath });
            const fileName = basename_from_path(relativePath) || fallbackName;
            const fileBuffer = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(fileBuffer).set(bytes);

            return new File([fileBuffer], fileName);
        }
);
