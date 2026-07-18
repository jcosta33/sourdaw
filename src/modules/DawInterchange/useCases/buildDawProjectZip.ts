import { strToU8, zipSync } from 'fflate';

export type BuildDawProjectZipInput = {
    projectXml: string;
    metadataXml: string;
    audioFiles: Map<string, Uint8Array>;
};

/**
 * fflate checks `instanceof Uint8Array` against its own realm. `TextEncoder`-
 * backed Uint8Arrays from jsdom can fail that check, which makes zipSync treat
 * the byte stream as a nested directory. Copy into a fresh Uint8Array so the
 * instance matches fflate's realm.
 */
function toUint8(source: Uint8Array): Uint8Array {
    const out = new Uint8Array(source.byteLength);
    out.set(source);
    return out;
}

export function buildDawProjectZip(input: BuildDawProjectZipInput): Uint8Array {
    const entries: Record<string, Uint8Array> = {
        'project.xml': toUint8(strToU8(input.projectXml)),
        'metadata.xml': toUint8(strToU8(input.metadataXml)),
    };
    for (const [path, bytes] of input.audioFiles) {
        entries[path] = toUint8(bytes);
    }
    return zipSync(entries, { level: 0 });
}
