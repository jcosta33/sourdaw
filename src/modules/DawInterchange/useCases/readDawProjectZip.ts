import { extractGuardedZip } from '#/infra/archive/extractGuardedZip';

export type DawProjectZipContents = {
    projectXml: string;
    metadataXml: string | null;
    audioAssets: Map<string, Uint8Array>;
};

const textDecoder = new TextDecoder('utf-8');
const projectXmlPath = /^project\.xml$/i;
const metadataXmlPath = /^metadata\.xml$/i;

export function readDawProjectZip(buffer: ArrayBuffer): DawProjectZipContents {
    const bytes = new Uint8Array(buffer);
    const headerEntries = extractGuardedZip({
        bytes,
        include: (path) => projectXmlPath.test(path) || metadataXmlPath.test(path),
    });
    const projectPaths = Object.keys(headerEntries).filter((path) => projectXmlPath.test(path));
    if (projectPaths.length === 0) {
        const selectedEntries = Object.keys(headerEntries).join(', ') || '<empty>';
        throw new Error(`DAWproject archive is missing project.xml at its root. Selected entries: ${selectedEntries}`);
    }
    if (projectPaths.length > 1) {
        throw new Error('DAWproject archive contains duplicate project.xml roots');
    }
    const projectPath = projectPaths[0];
    if (!projectPath) {
        throw new Error('DAWproject archive is missing project.xml at its root');
    }
    const projectEntry = headerEntries[projectPath];
    if (!projectEntry) {
        throw new Error('DAWproject archive did not extract project.xml');
    }

    const metadataPaths = Object.keys(headerEntries).filter((path) => metadataXmlPath.test(path));
    if (metadataPaths.length > 1) {
        throw new Error('DAWproject archive contains duplicate metadata.xml roots');
    }
    const metadataPath = metadataPaths[0];
    const metadataEntry = metadataPath ? headerEntries[metadataPath] : null;

    const audioEntries = extractGuardedZip({
        bytes,
        include: (path) => path.startsWith('audio/'),
    });

    const audioAssets = new Map<string, Uint8Array>();
    for (const [path, data] of Object.entries(audioEntries)) {
        if (path.endsWith('/')) {
            continue;
        }
        audioAssets.set(path, data);
    }

    return {
        projectXml: decodeUtf8(projectEntry),
        metadataXml: metadataEntry ? decodeUtf8(metadataEntry) : null,
        audioAssets,
    };
}

function decodeUtf8(data: Uint8Array): string {
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
        return textDecoder.decode(data.subarray(3));
    }
    return textDecoder.decode(data);
}
