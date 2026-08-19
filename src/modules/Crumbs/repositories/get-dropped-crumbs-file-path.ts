import { basename_from_path } from '#/utils/path-basename';
import { writeFileBytes } from '#/utils/desktopBridge';

const CRUMBS_DROP_TEMP_DIR = 'crumbs-drops';
const FALLBACK_FILE_NAME = 'audio-file';

type GetDroppedCrumbsFilePathInput = {
    file: File;
};

type GetDroppedCrumbsFilePathOutput = Promise<string | null>;

function getSafeDroppedFileName(fileName: string): string {
    const basename = basename_from_path(fileName).trim();
    const safeName = basename
        .replaceAll(/[^a-zA-Z0-9._-]/g, '_')
        .replaceAll('..', '.')
        .replaceAll(/^\.+/g, '');

    if (safeName.length === 0 || safeName === '.' || safeName === '..') {
        return FALLBACK_FILE_NAME;
    }

    return safeName;
}

function createUniqueCrumbsDropPath(fileName: string): string {
    const uniqueSegment = globalThis.crypto.randomUUID();
    const safeFileName = getSafeDroppedFileName(fileName);
    return `${CRUMBS_DROP_TEMP_DIR}/${uniqueSegment}/${safeFileName}`;
}

export async function getDroppedCrumbsFilePath({
    file,
}: GetDroppedCrumbsFilePathInput): GetDroppedCrumbsFilePathOutput {
    const desktopPath = 'path' in file && typeof file.path === 'string' ? file.path : '';
    if (desktopPath.length > 0) {
        return desktopPath;
    }

    const path = createUniqueCrumbsDropPath(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());

    await writeFileBytes({ path, bytes });

    return path;
}
