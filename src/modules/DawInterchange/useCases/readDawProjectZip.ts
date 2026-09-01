import { ZipArchiveError } from '#/infra/archive/extractGuardedZip';

import { DAW_PROJECT_ZIP_LIMITS } from './dawProjectZipLimits';
import { extractDawProjectZipEntries } from './extractDawProjectZipEntries';
import { metadataXmlPath, projectXmlPath } from './runDawProjectZipWorkerRequest';

export type DawProjectZipContents = {
    projectXml: string;
    metadataXml: string | null;
    readAudioAssets: () => Promise<Map<string, Uint8Array>>;
};

const textDecoder = new TextDecoder('utf-8');

export async function readDawProjectZip(buffer: ArrayBuffer): Promise<DawProjectZipContents> {
    rejectOversizedArchive(buffer);

    const header = await extractDawProjectZipEntries({
        bytes: copyArchiveBytes(buffer),
        phase: 'header',
        restrictLimits: DAW_PROJECT_ZIP_LIMITS,
    });

    const projectPath = Object.keys(header.entries).find((path) => projectXmlPath.test(path));
    if (!projectPath) {
        throw new Error('DAWproject archive did not extract project.xml');
    }
    const projectEntry = header.entries[projectPath];
    if (!projectEntry) {
        throw new Error('DAWproject archive did not extract project.xml');
    }

    const metadataPath = Object.keys(header.entries).find((path) => metadataXmlPath.test(path));
    const metadataEntry = metadataPath ? header.entries[metadataPath] : null;

    return {
        projectXml: decodeUtf8(projectEntry),
        metadataXml: metadataEntry ? decodeUtf8(metadataEntry) : null,
        readAudioAssets: async () => {
            const audio = await extractDawProjectZipEntries({
                bytes: copyArchiveBytes(buffer),
                phase: 'audio',
                restrictLimits: DAW_PROJECT_ZIP_LIMITS,
            });
            return new Map(Object.entries(audio.entries));
        },
    };
}

/**
 * `extractDawProjectZipEntries` transfers its `bytes` buffer to the worker,
 * detaching it. The header and audio phases run against the same caller
 * buffer, so each phase needs its own copy — the caller's `buffer` must
 * never be detached, and the header phase's buffer must not be detached out
 * from under the later `readAudioAssets` call. `rejectOversizedArchive`
 * enforces the archive byte cap before either phase copies, so a copy is
 * only ever taken once the buffer is known to be within
 * `DAW_PROJECT_ZIP_LIMITS.maxArchiveBytes`.
 */
function copyArchiveBytes(buffer: ArrayBuffer): Uint8Array {
    return new Uint8Array(buffer.slice(0));
}

/**
 * `extractGuardedZip`'s own archive-byte-limit check runs inside the worker,
 * after `copyArchiveBytes` has already allocated a duplicate of `buffer` on
 * the main thread. For an oversized archive that second allocation can fail
 * before the guard ever gets to refuse it (issue #3317). Mirror the guard's
 * check here, against the un-copied buffer, so an oversized archive is
 * refused before either phase copies it.
 */
function rejectOversizedArchive(buffer: ArrayBuffer): void {
    const maxArchiveBytes = DAW_PROJECT_ZIP_LIMITS.maxArchiveBytes;
    if (maxArchiveBytes !== undefined && buffer.byteLength > maxArchiveBytes) {
        throw new ZipArchiveError(`ZIP archive byte limit exceeds ${String(maxArchiveBytes)}`);
    }
}

function decodeUtf8(data: Uint8Array): string {
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
        return textDecoder.decode(data.subarray(3));
    }
    return textDecoder.decode(data);
}
