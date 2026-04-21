import { unzipSync, strFromU8 } from 'fflate';

export type DawProjectZipContents = {
    projectXml: string;
    metadataXml: string | null;
    audioAssets: Map<string, Uint8Array>;
};

const textDecoder = new TextDecoder('utf-8');

export function readDawProjectZip(buffer: ArrayBuffer): DawProjectZipContents {
    const bytes = new Uint8Array(buffer);
    const entries = unzipSync(bytes);

    const entryKey = Object.keys(entries).find((name) => /^\/?project\.xml$/i.test(name));
    const projectEntry = entryKey ? entries[entryKey] : undefined;
    if (!projectEntry) {
        const available = Object.keys(entries).join(', ') || '<empty>';
        throw new Error(`DAWproject archive is missing project.xml at its root. Found: ${available}`);
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
        return strFromU8(data.subarray(3));
    }
    return textDecoder.decode(data);
}
