import { type SampleRecord } from '../../models/LibraryTypes';

export function createSampleRecord(
    rootId: string,
    relativePath: string,
    filename: string,
    mtimeMs?: number
): SampleRecord {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const displayName = filename.replace(/\.[^.]+$/, '');
    const folder = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';

    return {
        // §139.4 — NUL separator is the one byte guaranteed not to appear
        // in a POSIX filename. The previous ":" delimiter collided when a
        // folder name legally contained a colon.
        id: `${rootId}\u0000${relativePath}`,
        libraryRootId: rootId,
        relativePath,
        displayName,
        ext,
        folder,
        sync: {
            exists: true,
            mtimeMs,
            status: 'discovered',
        },
        format: {},
        tags: [],
        favorite: false,
    };
}
