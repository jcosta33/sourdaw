import { extractGuardedZip } from '#/infra/archive/extractGuardedZip';

export type DawProjectZipContents = {
    projectXml: string;
    metadataXml: string | null;
    readAudioAssets: () => Map<string, Uint8Array>;
};

const textDecoder = new TextDecoder('utf-8');
const projectXmlPath = /^project\.xml$/i;
const metadataXmlPath = /^metadata\.xml$/i;

export function readDawProjectZip(buffer: ArrayBuffer): DawProjectZipContents {
    const bytes = new Uint8Array(buffer);
    const headerEntries = extractGuardedZip({
        bytes,
        include: (path) => projectXmlPath.test(path) || metadataXmlPath.test(path),
        validateInventory: validateDawProjectRootInventory,
    });
    const projectPath = Object.keys(headerEntries).find((path) => projectXmlPath.test(path));
    if (!projectPath) {
        throw new Error('DAWproject archive did not extract project.xml');
    }
    const projectEntry = headerEntries[projectPath];
    if (!projectEntry) {
        throw new Error('DAWproject archive did not extract project.xml');
    }

    const metadataPath = Object.keys(headerEntries).find((path) => metadataXmlPath.test(path));
    const metadataEntry = metadataPath ? headerEntries[metadataPath] : null;

    return {
        projectXml: decodeUtf8(projectEntry),
        metadataXml: metadataEntry ? decodeUtf8(metadataEntry) : null,
        readAudioAssets: () => {
            const audioEntries = extractGuardedZip({
                bytes,
                include: (path) => path.startsWith('audio/'),
            });
            const audioAssets = new Map<string, Uint8Array>();
            for (const [path, data] of Object.entries(audioEntries)) {
                if (!path.endsWith('/')) {
                    audioAssets.set(path, data);
                }
            }
            return audioAssets;
        },
    };
}

function decodeUtf8(data: Uint8Array): string {
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
        return textDecoder.decode(data.subarray(3));
    }
    return textDecoder.decode(data);
}

function validateDawProjectRootInventory(paths: readonly string[]): void {
    const projectRoots = paths.filter((path) => projectXmlPath.test(path));
    if (projectRoots.length === 0) {
        throw new Error('DAWproject archive is missing project.xml at its root');
    }
    if (projectRoots.length > 1) {
        throw new Error('DAWproject archive contains duplicate project.xml roots');
    }
    const metadataRoots = paths.filter((path) => metadataXmlPath.test(path));
    if (metadataRoots.length > 1) {
        throw new Error('DAWproject archive contains duplicate metadata.xml roots');
    }
}
