import { type DocumentBundle } from '../models/CrdtDocumentTypes';
import { createSdawFormatError } from '../errors/SdawFormatError';

/** Magic bytes identifying an .sdaw file. */
const SDAW_MAGIC = new Uint8Array([0x53, 0x44, 0x41, 0x57]); // "SDAW"

/** Current format version. */
const FORMAT_VERSION = 1;

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

/**
 * Decode an .sdaw binary into a document bundle.
 */
export const decodeSdawFile = (bytes: Uint8Array): DocumentBundle => {
    const decoder = new TextDecoder();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;

    // Verify magic
    if (bytes.length < 8) {
        throw createSdawFormatError('Invalid .sdaw file: too short');
    }

    for (let i = 0; i < 4; i++) {
        if (bytes[offset + i] !== SDAW_MAGIC[i]) {
            throw createSdawFormatError('Invalid .sdaw file: bad magic bytes');
        }
    }
    offset += 4;

    // Read version
    const version = view.getUint16(offset, true);
    offset += 2;
    if (version !== FORMAT_VERSION) {
        throw createSdawFormatError(`Unsupported .sdaw version: ${version} (expected ${FORMAT_VERSION})`);
    }

    // Read document count
    const docCount = view.getUint16(offset, true);
    offset += 2;

    const bundle: DocumentBundle = new Map();

    for (let i = 0; i < docCount; i++) {
        // Read DocId
        if (offset + 4 > bytes.length) {
            throw createSdawFormatError(`Truncated at document ${i} DocId length`);
        }
        const idLen = view.getUint32(offset, true);
        offset += 4;

        if (offset + idLen > bytes.length) {
            throw createSdawFormatError(`Truncated at document ${i} DocId`);
        }
        const docId = decoder.decode(bytes.subarray(offset, offset + idLen));
        offset += idLen;

        // Read data
        if (offset + 4 > bytes.length) {
            throw createSdawFormatError(`Truncated at document ${i} data length`);
        }
        const dataLen = view.getUint32(offset, true);
        offset += 4;

        if (offset + dataLen > bytes.length) {
            throw createSdawFormatError(`Truncated at document ${i} data`);
        }
        const data = bytes.slice(offset, offset + dataLen);
        offset += dataLen;

        bundle.set(docId, data);
    }

    return bundle;
};
