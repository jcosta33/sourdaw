import { inject } from '#/infra/di/inject';
import { basename_from_path } from '#/utils/path-basename';

import { readTauriAudioFileBytes } from '../repositories/readTauriAudioFileBytes';

type ReadTauriLibrarySampleFileInput = {
    rootPath: string;
    relativePath: string;
    fallbackName: string;
};

type ReadTauriLibrarySampleFileOutput = Promise<File>;

export const readTauriLibrarySampleFile = inject({ readTauriAudioFileBytes })(
    ({ readTauriAudioFileBytes }) =>
        async function readTauriLibrarySampleFile({
            rootPath,
            relativePath,
            fallbackName,
        }: ReadTauriLibrarySampleFileInput): ReadTauriLibrarySampleFileOutput {
            const trimmedRootPath = rootPath.replace(/[\\/]+$/, '');
            const pathSeparator = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/';
            const normalizedRelativePath = relativePath.replace(/^[\\/]+/, '').replace(/[\\/]+/g, pathSeparator);

            let absolutePath = trimmedRootPath;
            if (normalizedRelativePath.length > 0) {
                if (trimmedRootPath.length > 0) {
                    absolutePath = `${trimmedRootPath}${pathSeparator}${normalizedRelativePath}`;
                } else {
                    absolutePath = `${pathSeparator}${normalizedRelativePath}`;
                }
            }

            const bytes = await readTauriAudioFileBytes({ path: absolutePath });
            const fileName = basename_from_path(relativePath) || fallbackName;
            const fileBuffer = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(fileBuffer).set(bytes);

            return new File([fileBuffer], fileName);
        }
);
