import { type DocumentBundle } from '../../models/CrdtDocumentTypes';

import { FORMAT_VERSION, SDAW_MAGIC } from './helpers';

/**
 * Encode a document bundle into the .sdaw binary format.
 *
 * Format:
 *   4B magic "SDAW"
 *   2B format version (little-endian)
 *   2B document count (little-endian)
 *   Per document:
 *     4B DocId string length (little-endian)
 *     N  DocId string bytes (UTF-8)
 *     4B Automerge binary length (little-endian)
 *     N  Automerge save() bytes
 */
export const encodeSdawFile = (bundle: DocumentBundle): Uint8Array => {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];

    // Magic
    chunks.push(SDAW_MAGIC);

    // Version
    const version = new Uint8Array(2);
    new DataView(version.buffer).setUint16(0, FORMAT_VERSION, true);
    chunks.push(version);

    // Document count
    const count = new Uint8Array(2);
    new DataView(count.buffer).setUint16(0, bundle.size, true);
    chunks.push(count);

    // Documents
    for (const [docId, data] of bundle) {
        const idBytes = encoder.encode(docId);

        // DocId length
        const idLen = new Uint8Array(4);
        new DataView(idLen.buffer).setUint32(0, idBytes.length, true);
        chunks.push(idLen);

        // DocId
        chunks.push(idBytes);

        // Data length
        const dataLen = new Uint8Array(4);
        new DataView(dataLen.buffer).setUint32(0, data.length, true);
        chunks.push(dataLen);

        // Data
        chunks.push(data);
    }

    // Concatenate all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
};
