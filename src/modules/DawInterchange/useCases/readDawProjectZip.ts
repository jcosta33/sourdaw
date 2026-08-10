import { extractGuardedZip } from '#/infra/archive/extractGuardedZip';

export type DawProjectZipContents = {
    projectXml: string;
    metadataXml: string | null;
    audioAssets: Map<string, Uint8Array>;
};

const textDecoder = new TextDecoder('utf-8');
const projectXmlPath = /^project\.xml$/i;

export function readDawProjectZip(buffer: ArrayBuffer): DawProjectZipContents {
    const bytes = new Uint8Array(buffer);
    const entries = extractGuardedZip({
        bytes,
        include: (path) => projectXmlPath.test(path) || isMetadataPath(path) || path.startsWith('audio/'),
    });

    const entryKey = Object.keys(entries).find((name) => projectXmlPath.test(name));
    const projectEntry = entryKey ? entries[entryKey] : undefined;
    if (!projectEntry) {
        const selectedEntries = Object.keys(entries).join(', ') || '<empty>';
        throw new Error(`DAWproject archive is missing project.xml at its root. Selected entries: ${selectedEntries}`);
    }

    const metadataEntry = entries['metadata.xml'] ?? entries['Metadata.xml'] ?? null;

    const audioAssets = new Map<string, Uint8Array>();
    for (const [path, data] of Object.entries(entries)) {
        if (path === 'project.xml' || path === 'metadata.xml') {
            continue;
        }
        if (!path.startsWith('audio/')) {
            continue;
        }
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

function isMetadataPath(path: string): boolean {
    return path === 'metadata.xml' || path === 'Metadata.xml';
}
