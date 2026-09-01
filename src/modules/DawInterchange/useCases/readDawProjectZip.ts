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
    const bytes = new Uint8Array(buffer);
    const header = await extractDawProjectZipEntries({
        bytes,
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
                bytes,
                phase: 'audio',
                restrictLimits: DAW_PROJECT_ZIP_LIMITS,
            });
            return new Map(Object.entries(audio.entries));
        },
    };
}

function decodeUtf8(data: Uint8Array): string {
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
        return textDecoder.decode(data.subarray(3));
    }
    return textDecoder.decode(data);
}
