import { resolveFileHandle } from './resolveFileHandle';
import { MODELS_DIRECTORY } from './storageConstants';
import { type ModelPath } from './storageTypes';
import { toOpfsPath } from './toOpfsPath';

/**
 * Open a main-thread writable stream for a model file, creating intermediate
 * directories as needed. Callers stream chunks straight to OPFS instead of
 * accumulating the whole model in memory first.
 *
 * Use `createWritable` for main-thread writes (no sync access handles on main thread).
 */
export async function createModelWritable({ family, modelId }: ModelPath): Promise<FileSystemWritableFileStream> {
    const root = await navigator.storage.getDirectory();
    const modelsDir = await root.getDirectoryHandle(MODELS_DIRECTORY, { create: true });
    const fileHandle = await resolveFileHandle({
        opfsRoot: modelsDir,
        relativePath: toOpfsPath({ family, modelId }),
        create: true,
    });
    return fileHandle.createWritable();
}
